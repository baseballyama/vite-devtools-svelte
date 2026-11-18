import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { getRpcHandler } from 'devframe/rpc';
import { describe, it, expect, vi } from 'vitest';

import type { ResolveFile } from '../src/analyzers/api.js';
import { transport } from '../src/analyzers/http.js';
import { HOT_EVENTS } from '../src/server/collector.js';
import type { HotChannel, HotClient } from '../src/server/collector.js';
import {
  createRpcFunctions,
  createSvelteDevframe,
  DEVFRAME_BASE,
  DEVFRAME_ID,
  PICK_BROADCAST,
} from '../src/server/devframe.js';
import { createTestHost, rpcHandlers } from './helpers.js';

vi.mock('node:dns/promises', () => ({
  default: { lookup: () => Promise.resolve([{ address: '93.184.215.14', family: 4 }]) },
}));

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures');
const COUNTER = path.join(FIXTURES_DIR, 'src/lib/components/Counter.svelte');

/** Reads (get-*, inspect-*) are queries, except the outbound OG fetch. */
function expectedRpcType(name: string): 'query' | 'action' {
  if (name === 'get-og-preview') return 'action';
  return /^(get-|inspect-)/.test(name) ? 'query' : 'action';
}

describe('devframe definition', () => {
  it('is a dev-only, host-agnostic tool mounted at /.svelte-devtools/', () => {
    const def = createSvelteDevframe(createTestHost(FIXTURES_DIR));
    expect(def.id).toBe(DEVFRAME_ID);
    expect(def.basePath).toBe(DEVFRAME_BASE);
    expect(def.capabilities).toEqual({ dev: true, build: false });
    expect(def.packageName).toBe('@sveltejs/vite-devtools-svelte');
    expect(def.clientAssets).toMatch(/client$/);
  });

  it('registers every RPC under the svelte-devtools scope with bare names', async () => {
    const registered: string[] = [];
    const def = createSvelteDevframe(createTestHost(FIXTURES_DIR));
    await def.setup({
      scope: (id: string) => ({
        rpc: { register: (fn: { name: string }) => registered.push(`${id}:${fn.name}`) },
      }),
    } as any);
    expect(registered).toContain('svelte-devtools:get-project');
    expect(registered).toContain('svelte-devtools:get-state-timeline-delta');
    expect(registered.filter(n => !/^svelte-devtools:[^:]+$/.test(n))).toEqual([]);
  });

  it('marks reads as query, mutations as action, all JSON-serializable', () => {
    const fns = createRpcFunctions(createTestHost(FIXTURES_DIR));
    const shape = (fn: (typeof fns)[number]) => ({
      name: fn.name,
      jsonSerializable: fn.jsonSerializable,
      type: fn.type,
    });
    expect(fns.map(shape)).toEqual(
      fns.map(fn => ({
        name: fn.name,
        jsonSerializable: true,
        type: expectedRpcType(fn.name),
      })),
    );
  });
});

describe('project analysis RPCs', () => {
  const rpc = rpcHandlers(createTestHost(FIXTURES_DIR, { publicBase: () => '/base/' }));

  it('get-project / get-routes / get-component-relations / get-svelte-files', async () => {
    expect((await rpc.get('svelte-devtools:get-project')!()).name).toBeTruthy();
    expect((await rpc.get('svelte-devtools:get-routes')!()).length).toBeGreaterThan(0);
    expect((await rpc.get('svelte-devtools:get-component-relations')!()).length).toBeGreaterThan(0);
    const files = await rpc.get('svelte-devtools:get-svelte-files')!();
    expect(files[0]).toEqual({ file: expect.any(String), name: expect.any(String) });
  });

  it('get-assets returns a previewable public URL under the Vite base', async () => {
    const assets = await rpc.get('svelte-devtools:get-assets')!();
    const logo = assets.find((a: any) => a.name === 'logo.svg');
    expect(logo.url).toBe('/base/logo.svg');
    const nested = assets.find((a: any) => a.relativePath.includes(path.sep));
    expect(nested.url).toBe('/base/' + nested.relativePath.split(path.sep).join('/'));
  });

  it('get-api-endpoints detects exported HTTP methods', async () => {
    const endpoints = await rpc.get('svelte-devtools:get-api-endpoints')!();
    expect(endpoints.find((e: any) => e.path === '/api/hello')).toMatchObject({
      methods: ['GET', 'POST', 'HEAD'],
      complete: true,
    });
    // the host's base reaches the endpoints' URLs
    for (const e of endpoints) expect(e.url).toBe(`/base${e.path}`);
    // without the host's resolver, a `$lib` re-export cannot be followed
    expect(endpoints.find((e: any) => e.path === '/api/items')).toMatchObject({
      methods: [],
      complete: false,
    });
  });

  it("get-api-endpoints follows re-exports through the host's resolver", async () => {
    const items = path.join(FIXTURES_DIR, 'src/lib/server/items.ts');
    // the fixture's only `export *` is the one under test
    const resolveFile = vi.fn<ResolveFile>().mockResolvedValue(items);
    const endpoints = await rpcHandlers(createTestHost(FIXTURES_DIR, { resolveFile })).get(
      'svelte-devtools:get-api-endpoints',
    )!();
    expect(endpoints.find((e: any) => e.path === '/api/items')).toMatchObject({
      methods: ['GET', 'PUT', 'HEAD'],
      complete: true,
    });
    expect(resolveFile).toHaveBeenCalledWith(
      '$lib/server/items',
      path.join(FIXTURES_DIR, 'src/routes/api/items/+server.ts'),
    );
  });

  it('get-build-analysis is empty without build output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-empty-'));
    const result = await rpcHandlers(createTestHost(root)).get(
      'svelte-devtools:get-build-analysis',
    )!();
    expect(result.chunks).toEqual([]);
  });
});

describe('collector-backed RPCs', () => {
  it('live components meta reports truncation', async () => {
    const host = createTestHost(FIXTURES_DIR);
    host.collector.ingestComponents({
      components: Array.from({ length: 60_000 }, (_, i) => ({ id: i })),
    });
    const meta = await rpcHandlers(host).get('svelte-devtools:get-live-components-meta')!();
    expect(meta).toEqual({
      total: 60_000,
      kept: 50_000,
      truncated: true,
      root: fs.realpathSync.native(FIXTURES_DIR).split(path.sep).join('/'),
      epoch: '(legacy)',
      epochs: 1,
    });
  });

  it('set-active leases and releases per client', () => {
    const host = createTestHost(FIXTURES_DIR);
    const rpc = rpcHandlers(host);
    rpc.get('svelte-devtools:set-active')!({ client: 'tab1', active: true });
    expect(host.collector.subscription).toEqual({ active: true, componentDeltas: true });
    rpc.get('svelte-devtools:set-active')!({ client: 'tab1', active: false });
    expect(host.collector.subscription).toEqual({ active: false, componentDeltas: true });
  });

  it('timeline delta and versions', async () => {
    const host = createTestHost(FIXTURES_DIR);
    const rpc = rpcHandlers(host);
    host.collector.ingestStateTimeline({
      changes: [{ id: 'a', name: 'a', componentFile: '', oldValue: 0, newValue: 1, timestamp: 1 }],
    });
    const d = await rpc.get('svelte-devtools:get-state-timeline-delta')!({});
    expect(d.reset).toBe(true);
    // seq is opaque and monotonic (seeded per process); the cursor is the newest seq
    expect(d.changes).toHaveLength(1);
    expect(d.cursor).toBe(d.changes[0].seq);
    const next = await rpc.get('svelte-devtools:get-state-timeline-delta')!({ since: d.cursor });
    expect(next).toEqual({ cursor: d.cursor, reset: false, changes: [] });
    expect((await rpc.get('svelte-devtools:get-versions')!()).stateTimeline).toBeGreaterThan(0);
  });

  it('clear RPCs empty their buffers', async () => {
    const host = createTestHost(FIXTURES_DIR);
    const rpc = rpcHandlers(host);
    host.collector.recordLoadProfile({ route: '/' } as any);
    host.collector.ingestRuntimeError({ message: 'x' } as any);
    host.collector.ingestFps({ fps: 1 } as any);
    await rpc.get('svelte-devtools:clear-load-profiles')!();
    await rpc.get('svelte-devtools:clear-errors')!();
    await rpc.get('svelte-devtools:clear-fps')!();
    expect(await rpc.get('svelte-devtools:get-load-profiles')!()).toEqual([]);
    expect(await rpc.get('svelte-devtools:get-runtime-errors')!()).toEqual([]);
    expect(await rpc.get('svelte-devtools:get-fps')!()).toEqual([]);
  });
});

describe('file access sandbox', () => {
  const host = createTestHost(FIXTURES_DIR);
  const rpc = rpcHandlers(host);

  it('inspect-file refuses paths outside the root (absolute and traversal)', async () => {
    expect((await rpc.get('svelte-devtools:inspect-file')!({ file: '/etc/passwd' })).source).toBe(
      '',
    );
    expect(
      (await rpc.get('svelte-devtools:inspect-file')!({ file: '../../../etc/passwd' })).source,
    ).toBe('');
  });

  it('inspect-file refuses symlinks escaping the root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-link-'));
    fs.symlinkSync('/etc', path.join(root, 'escape'));
    const r = rpcHandlers(createTestHost(root));
    expect((await r.get('svelte-devtools:inspect-file')!({ file: 'escape/hosts' })).source).toBe(
      '',
    );
  });

  it('inspect-file returns source, and compiled output + map from the dev server', async () => {
    const transformRequest = vi.fn(() =>
      Promise.resolve({
        code: 'compiled',
        map: JSON.stringify({ mappings: 'AAAA', sources: ['Counter.svelte'] }),
      }),
    );
    const r = rpcHandlers(createTestHost(FIXTURES_DIR, { transformRequest }));
    const result = await r.get('svelte-devtools:inspect-file')!({
      file: 'src/lib/components/Counter.svelte',
    });
    expect(result.source).toContain('$state');
    expect(result).toMatchObject({
      compiled: 'compiled',
      mappings: 'AAAA',
      sources: ['Counter.svelte'],
    });
    expect(transformRequest).toHaveBeenCalledWith(fs.realpathSync(COUNTER));
  });

  it('inspect-file reports transform failures without throwing', async () => {
    const r = rpcHandlers(
      createTestHost(FIXTURES_DIR, {
        transformRequest: () => Promise.reject(new Error('x')),
      }),
    );
    const result = await r.get('svelte-devtools:inspect-file')!({ file: COUNTER });
    expect(result.compiled).toBe('// Transform failed');
  });

  it('open-in-editor resolves inside the root and passes file:line to the editor', async () => {
    await rpc.get('svelte-devtools:open-in-editor')!({ file: COUNTER, line: 3 });
    expect(host.opened.at(-1)).toBe(`${fs.realpathSync(COUNTER)}:3`);
    expect(() => rpc.get('svelte-devtools:open-in-editor')!({ file: '/etc/passwd' })).toThrow(
      /outside/,
    );
    expect(() => rpc.get('svelte-devtools:open-in-editor')!({ file: 'nope.svelte' })).toThrow(
      /not found/,
    );
  });

  it('open-reactive-in-editor jumps to the declaration line', async () => {
    await rpc.get('svelte-devtools:open-reactive-in-editor')!({
      file: COUNTER,
      name: 'count',
      type: 'state',
    });
    const line =
      fs
        .readFileSync(COUNTER, 'utf-8')
        .split('\n')
        .findIndex(l => /let\s+count\b/.test(l)) + 1;
    expect(host.opened.at(-1)).toBe(`${fs.realpathSync(COUNTER)}:${line}`);
    expect(() =>
      rpc.get('svelte-devtools:open-reactive-in-editor')!({
        file: '/etc/hosts',
        name: 'x',
        type: 'state',
      }),
    ).toThrow(/outside/);
  });
});

const fixtureFile = (rel: string) => path.join(FIXTURES_DIR, rel);
const mod = (rel: string, imports: any[] = []) => ({
  file: fixtureFile(rel),
  importedModules: new Set(imports),
});

describe('module graph RPC', () => {
  it('builds project-local nodes, edges, types and cycles from the dev server graph', async () => {
    const a = mod('src/a.ts');
    const b = mod('src/b.svelte');
    const c = mod('src/c.js');
    const css = mod('src/s.css');
    const dep = { file: '/x/node_modules/dep/index.js', importedModules: new Set() };
    a.importedModules = new Set([b, css, dep]);
    b.importedModules = new Set([c]);
    c.importedModules = new Set([a]);
    // duplicate across environments (client + ssr) must be deduplicated
    const modules = [a, b, c, css, dep, { ...a }];
    const r = rpcHandlers(createTestHost(FIXTURES_DIR, { modules: () => modules }));
    const graph = await r.get('svelte-devtools:get-module-graph')!();
    const ids = graph.modules.map((m: any) => m.id).toSorted();
    expect(ids).toEqual(['src/a.ts', 'src/b.svelte', 'src/c.js', 'src/s.css']);
    const byId = Object.fromEntries(graph.modules.map((m: any) => [m.id, m]));
    expect(byId['src/a.ts'].type).toBe('ts');
    expect(byId['src/b.svelte'].type).toBe('svelte');
    expect(byId['src/s.css'].type).toBe('css');
    expect(byId['src/a.ts'].imports).toEqual(['src/b.svelte', 'src/s.css']);
    expect(byId['src/b.svelte'].importedBy).toEqual(['src/a.ts']);
    expect(graph.cycles).toHaveLength(1);
    expect(byId['src/c.js'].isCyclic).toBe(true);
    expect(byId['src/s.css'].isCyclic).toBeUndefined();
  });

  it('is empty without a dev server', async () => {
    const graph = await rpcHandlers(createTestHost(FIXTURES_DIR)).get(
      'svelte-devtools:get-module-graph',
    )!();
    expect(graph).toEqual({ modules: [], cycles: [] });
  });
});

function projectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-rpc-'));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'rpc-app', version: '2.0.0' }),
    'src/routes/+page.svelte':
      "<script>\n  import C from '$lib/C.svelte'\n  let n = $state(0)\n</script>",
    'src/routes/api/+server.ts': 'export const GET = () => new Response()',
    'src/lib/C.svelte': '<p>c</p>',
    'static/a.txt': 'a',
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

async function validated(host: ReturnType<typeof createTestHost>) {
  const map = new Map<string, (...args: any[]) => Promise<any>>();
  for (const fn of createRpcFunctions(host)) map.set(fn.name, await getRpcHandler(fn as any, {}));
  return map;
}

describe('every RPC with valid input', () => {
  it('answers JSON-serializable data for each registered function', async () => {
    const root = projectRoot();
    const fetchMock = vi.spyOn(transport, 'get').mockImplementation(() =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: Readable.from([Buffer.from('<title>t</title>')]),
      }),
    );
    const host = createTestHost(root, { serverOrigins: () => ['http://localhost:5173'] });
    const rpc = await validated(host);
    const calls: Record<string, [args: unknown[], check: (r: any) => void]> = {
      'get-project': [[], r => expect(r).toMatchObject({ name: 'rpc-app', version: '2.0.0' })],
      'get-routes': [[], r => expect(r.map((x: any) => x.id).toSorted()).toEqual(['/', 'api'])],
      'get-assets': [[], r => expect(r.map((a: any) => a.url)).toEqual(['/a.txt'])],
      'get-component-relations': [[], r => expect(r).toHaveLength(2)],
      'get-svelte-files': [
        [],
        r => expect(r.map((f: any) => f.name).toSorted()).toEqual(['+page', 'C']),
      ],
      'get-live-components': [[], r => expect(r).toEqual([])],
      'get-live-components-meta': [
        [],
        r => expect(r).toMatchObject({ total: 0, kept: 0, truncated: false }),
      ],
      'set-active': [[{ client: 'c', active: false }], r => expect(r).toBeUndefined()],
      'open-in-editor': [
        [{ file: 'src/lib/C.svelte', line: 2 }],
        () => expect(host.opened.at(-1)).toMatch(/C\.svelte:2$/),
      ],
      'get-recent-element-pick': [[], r => expect(r).toBeNull()],
      'open-reactive-in-editor': [
        [{ file: 'src/routes/+page.svelte', name: 'n', type: 'state' }],
        () => expect(host.opened.at(-1)).toMatch(/\+page\.svelte:3$/),
      ],
      'get-render-profiles': [[], r => expect(r).toEqual([])],
      'get-reactive-graph': [[], r => expect(r).toMatchObject({ nodes: [], edges: [] })],
      'get-reactive-summary': [[{ topK: 1 }], r => expect(r).toBeTypeOf('object')],
      'get-capture-info': [[], r => expect(r).toBeTypeOf('object')],
      'get-load-profiles': [[], r => expect(r).toEqual([])],
      'clear-load-profiles': [[], () => {}],
      'get-state-timeline': [[], r => expect(r).toEqual([])],
      'get-state-timeline-delta': [[{}], r => expect(r).toMatchObject({ changes: [] })],
      'get-versions': [[], r => expect(r).toBeTypeOf('object')],
      'clear-state-timeline': [[], () => {}],
      'get-api-endpoints': [
        [],
        r =>
          expect(r).toEqual([expect.objectContaining({ route: 'api', methods: ['GET', 'HEAD'] })]),
      ],
      'get-compiler-warnings': [[], r => expect(r).toEqual([])],
      'get-runtime-errors': [[], r => expect(r).toEqual([])],
      'clear-errors': [[], () => {}],
      'inspect-file': [
        [{ file: 'src/lib/C.svelte' }],
        r => expect(r).toEqual({ source: '<p>c</p>', compiled: '', file: 'src/lib/C.svelte' }),
      ],
      'get-module-graph': [[], r => expect(r).toEqual({ modules: [], cycles: [] })],
      'get-og-preview': [[{ url: 'http://localhost:5173/' }], r => expect(r.title).toBe('t')],
      'get-build-analysis': [[], r => expect(r.chunks).toEqual([])],
      'get-fps': [[], r => expect(r).toEqual([])],
      'clear-fps': [[], () => {}],
    };
    expect(Object.keys(calls).toSorted()).toEqual([...rpc.keys()].toSorted());
    for (const [name, [args, check]] of Object.entries(calls)) {
      const result = await rpc.get(name)!(...args);
      expect(jsonRoundTrip(result)).toEqual(result);
      check(result);
    }
    // only the OG preview fetches on the server
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

const long = (n: number) => 'x'.repeat(n);
/** The value after a JSON round trip (`undefined`, an action's void, stays as is). */
const jsonRoundTrip = (v: unknown): unknown =>
  v === undefined ? v : JSON.parse(JSON.stringify(v));

describe('RPC input validation', () => {
  const host = createTestHost(FIXTURES_DIR);
  it.each<[name: string, args: unknown[]]>([
    ['set-active', [{ client: '', active: true }]],
    ['set-active', [{ client: long(65), active: true }]],
    ['set-active', [{ client: 'c', active: 'yes' }]],
    ['set-active', [undefined]],
    ['open-in-editor', [{ file: '' }]],
    ['open-in-editor', [{ file: long(4097) }]],
    ['open-in-editor', [{ file: 'a', line: -1 }]],
    ['open-in-editor', [{ file: 'a', line: 1.5 }]],
    ['open-in-editor', [{ file: 1 }]],
    ['open-reactive-in-editor', [{ file: 'a', name: long(257), type: 'state' }]],
    ['open-reactive-in-editor', [{ file: 'a', name: 'x', type: long(33) }]],
    ['open-reactive-in-editor', [{ file: 'a', type: 'state' }]],
    ['get-reactive-graph', [{ componentId: -1 }]],
    ['get-reactive-graph', [{ componentId: 1.5 }]],
    ['get-reactive-graph', [{ epoch: long(201) }]],
    ['get-reactive-graph', [{ maxNodes: 0 }]],
    ['get-reactive-graph', [{ maxEdges: -5 }]],
    ['get-reactive-summary', [{ topK: 0 }]],
    ['get-reactive-summary', [{ windowMs: 1.5 }]],
    ['get-state-timeline-delta', [{ since: -1 }]],
    ['get-state-timeline-delta', [{ since: 0.5 }]],
    ['get-state-timeline-delta', [undefined]],
    ['inspect-file', [{ file: '' }]],
    ['inspect-file', [{}]],
    ['get-og-preview', [{ url: long(8193) }]],
    ['get-og-preview', [{ url: 5 }]],
  ])('%s rejects %j before the handler runs', async (name, args) => {
    const fetchMock = vi.spyOn(transport, 'get');
    const rpc = await validated(host);
    const opened = host.opened.length;
    await expect(rpc.get(name)!(...args)).rejects.toThrow(/invalid argument/);
    expect(host.opened.length).toBe(opened);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it.each<[name: string, args: unknown[]]>([
    ['set-active', [{ client: long(64), active: true }]],
    ['open-in-editor', [{ file: 'src/lib/components/Counter.svelte', line: 0 }]],
    ['get-reactive-graph', [undefined]],
    ['get-reactive-graph', [{ componentId: 0, epoch: long(200), maxNodes: 1, maxEdges: 1 }]],
    ['get-reactive-summary', [undefined]],
    ['get-state-timeline-delta', [{ since: 0 }]],
  ])('%s accepts the boundary %j', async (name, args) => {
    const rpc = await validated(host);
    await expect(rpc.get(name)!(...args)).resolves.not.toThrow();
  });
});

describe('RPC behaviour details', () => {
  it('open-in-editor without a line (or line 0) opens just the file', () => {
    const host = createTestHost(FIXTURES_DIR);
    const rpc = rpcHandlers(host);
    rpc.get('svelte-devtools:open-in-editor')!({ file: COUNTER, line: 0 });
    rpc.get('svelte-devtools:open-in-editor')!({ file: COUNTER });
    expect(host.opened).toEqual([fs.realpathSync(COUNTER), fs.realpathSync(COUNTER)]);
  });

  it.each([
    ['a missing declaration', COUNTER, 'nope'],
    ['an empty name', COUNTER, ''],
    ['a directory (unreadable as a file)', path.join(FIXTURES_DIR, 'src/lib'), 'count'],
  ])('open-reactive-in-editor with %s opens the file without a line', (_label, file, name) => {
    const host = createTestHost(FIXTURES_DIR);
    rpcHandlers(host).get('svelte-devtools:open-reactive-in-editor')!({
      file,
      name,
      type: 'state',
    });
    expect(host.opened).toEqual([fs.realpathSync(file)]);
  });

  it('get-reactive-graph / get-reactive-summary forward the request (empty when omitted)', async () => {
    const host = createTestHost(FIXTURES_DIR);
    const graph = vi.spyOn(host.collector, 'requestReactiveGraph');
    const summary = vi.spyOn(host.collector, 'requestReactiveSummary');
    const rpc = rpcHandlers(host);
    await rpc.get('svelte-devtools:get-reactive-graph')!();
    await rpc.get('svelte-devtools:get-reactive-graph')!({ componentId: 2, epoch: 'e' });
    await rpc.get('svelte-devtools:get-reactive-summary')!();
    await rpc.get('svelte-devtools:get-reactive-summary')!({ topK: 3 });
    expect(graph.mock.calls).toEqual([[{}], [{ componentId: 2, epoch: 'e' }]]);
    expect(summary.mock.calls).toEqual([[{}], [{ topK: 3 }]]);
  });

  it.each<[label: string, result: any, expected: Record<string, unknown>]>([
    ['null result', null, { compiled: '', mappings: undefined, sources: undefined }],
    ['no map', { code: 'c' }, { compiled: 'c', mappings: undefined, sources: undefined }],
    [
      'object map',
      { code: 'c', map: { mappings: 'AA', sources: ['a'] } },
      { mappings: 'AA', sources: ['a'] },
    ],
    [
      'JSON string map',
      { code: 'c', map: '{"mappings":"AB","sources":["s"]}' },
      { mappings: 'AB', sources: ['s'] },
    ],
    [
      'JSON map with bad fields',
      { code: 'c', map: '{"mappings":1,"sources":[1]}' },
      { compiled: 'c', mappings: undefined, sources: undefined },
    ],
    [
      'JSON non-object map',
      { code: 'c', map: '5' },
      { compiled: 'c', mappings: undefined, sources: undefined },
    ],
    ['invalid JSON map', { code: 'c', map: '{oops' }, { compiled: '// Transform failed' }],
  ])('inspect-file with a transform giving %s', async (_label, result, expected) => {
    const r = rpcHandlers(
      createTestHost(FIXTURES_DIR, { transformRequest: () => Promise.resolve(result) }),
    );
    const out = await r.get('svelte-devtools:inspect-file')!({ file: COUNTER });
    expect(out.source).toContain('$state');
    expect(out).toMatchObject(expected);
  });

  it('inspect-file of a missing file is empty', async () => {
    const r = rpcHandlers(createTestHost(FIXTURES_DIR));
    expect(await r.get('svelte-devtools:inspect-file')!({ file: 'nope.svelte' })).toEqual({
      source: '',
      compiled: '',
      file: 'nope.svelte',
    });
  });
});

function hotChannel() {
  const listeners = new Map<string, (payload: unknown, client: HotClient) => void>();
  const hot: HotChannel = {
    send: () => {},
    on: (event, listener) => void listeners.set(event, listener),
  };
  const emit = (event: string, payload: unknown) =>
    listeners.get(event)!(payload, { send: () => {} });
  return { hot, emit };
}

/** A devframe set up over a fake scoped context that records broadcasts. */
async function setUp(host = createTestHost(FIXTURES_DIR)) {
  const broadcasts: unknown[] = [];
  const def = createSvelteDevframe(host);
  const ctx = {
    scope: () => ({
      rpc: {
        register: () => {},
        broadcast: (options: unknown) => {
          broadcasts.push(options);
          return Promise.resolve();
        },
      },
    }),
  };
  await def.setup(ctx as any);
  const channel = hotChannel();
  host.collector.attach(channel.hot);
  return { host, def, ctx, broadcasts, ...channel };
}

describe('element picker', () => {
  const pick = { epoch: 'e1', componentId: 4 };

  it('forwards a valid pick to every DevTools UI', async () => {
    const { broadcasts, emit } = await setUp();
    emit(HOT_EVENTS.elementPicked, pick);
    expect(broadcasts).toEqual([
      { method: PICK_BROADCAST, args: [pick], event: true, optional: true },
    ]);
  });

  it.each([
    ['not an object', 'pick'],
    ['no epoch', { ...pick, epoch: '' }],
    ['a long epoch', { ...pick, epoch: 'e'.repeat(201) }],
    ['a negative id', { ...pick, componentId: -1 }],
    ['a fractional id', { ...pick, componentId: 1.5 }],
    ['a string id', { ...pick, componentId: '4' }],
  ])('drops a pick with %s', async (_, payload) => {
    const { broadcasts, emit } = await setUp();
    emit(HOT_EVENTS.elementPicked, payload);
    expect(broadcasts).toEqual([]);
  });

  it('a UI connecting right after a pick can still read it', async () => {
    const { host, emit } = await setUp();
    const recent = rpcHandlers(host).get('svelte-devtools:get-recent-element-pick')!;
    expect(await recent()).toBeNull();
    emit(HOT_EVENTS.elementPicked, pick);
    expect(await recent()).toEqual(pick);
  });

  it('inside the Vite DevTools dock, a pick switches the dock to this tool', async () => {
    const host = createTestHost(FIXTURES_DIR);
    const activated: string[] = [];
    const def = createSvelteDevframe(host);
    const ctx = {
      scope: () => ({
        rpc: { register: () => {}, broadcast: () => Promise.reject(new Error('x')) },
      }),
      docks: { activate: (id: string) => activated.push(id) },
    };
    await def.setup(ctx as any);
    const channel = hotChannel();
    host.collector.attach(channel.hot);
    // a failed broadcast (no UI connected) is not an error
    channel.emit(HOT_EVENTS.elementPicked, pick);
    await Promise.resolve();
    expect(activated).toEqual([DEVFRAME_ID]);
  });

  it('a second setup (dev-server restart) replaces the subscription', async () => {
    const { def, ctx, broadcasts, emit } = await setUp();
    await def.setup(ctx as any);
    emit(HOT_EVENTS.elementPicked, pick);
    expect(broadcasts).toHaveLength(1);
  });
});
