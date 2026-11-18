import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';

import {
  analyzeApiEndpoints,
  collectExports,
  MAX_DEPTH,
  MAX_MODULE_BYTES,
  moduleExports,
  resolveRelative,
  serverResolver,
} from '../src/analyzers/api.js';
import type { ResolveFile } from '../src/analyzers/api.js';
import type { RouteInfo } from '../src/types.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-api-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

let n = 0;
function endpointRoute(code: string | null, ext = 'ts'): RouteInfo {
  const dir = path.join(tmp, `r${n++}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, `+server.${ext}`);
  if (code !== null) fs.writeFileSync(file, code);
  return {
    id: `r${n}`,
    path: `/r${n}`,
    pattern: `/r${n}`,
    segments: [],
    hasPage: false,
    hasLayout: false,
    hasServerPage: false,
    hasServerLayout: false,
    hasEndpoint: true,
    hasPageLoad: false,
    hasLayoutLoad: false,
    params: [],
    files: [{ type: 'endpoint', path: file }],
  };
}

const ALL = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function project(files: Record<string, string>): string {
  const dir = path.join(tmp, `p${n++}`);
  for (const [rel, code] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), code);
  }
  return dir;
}

async function methodsOf(code: string, ext = 'ts') {
  const [endpoint] = await analyzeApiEndpoints([endpointRoute(code, ext)]);
  return endpoint!;
}

describe('analyzeApiEndpoints: exported methods', () => {
  it.each<[label: string, code: string, methods: string[]]>([
    // SvelteKit answers HEAD with the GET handler
    ['function', 'export function GET() {}', ['GET', 'HEAD']],
    ['async function', 'export async function POST() {}', ['POST']],
    ['const arrow', 'export const PUT = () => new Response()', ['PUT']],
    [
      'typed const',
      "import type { RequestHandler } from './$types'\nexport const PATCH: RequestHandler = async () => new Response()",
      ['PATCH'],
    ],
    ['multiple declarators', 'export const DELETE = h, OPTIONS = h', ['DELETE', 'OPTIONS']],
    ['export list', 'function GET() {}\nexport { GET }', ['GET', 'HEAD']],
    [
      'renamed export',
      'const handler = () => {}\nexport { handler as POST, handler as HEAD }',
      ['POST', 'HEAD'],
    ],
    ['string export name', "const h = 1\nexport { h as 'PUT' }", ['PUT']],
    ['re-export', "export { GET } from './shared'", ['GET', 'HEAD']],
    [
      'display order, not source order',
      'export const OPTIONS = h\nexport const GET = h',
      ['GET', 'HEAD', 'OPTIONS'],
    ],
    ['fallback answers every method', 'export const fallback = h', ALL],
    ['fallback with GET', 'export const GET = h\nexport async function fallback() {}', ALL],
    // destructuring, in every pattern form
    ['object destructuring', 'export const { GET } = handlers', ['GET', 'HEAD']],
    ['renamed in the pattern', 'export const { a: POST, b: PUT = h } = handlers', ['POST', 'PUT']],
    ['object rest', 'export const { a, ...DELETE } = handlers', ['DELETE']],
    ['nested pattern', 'export const { a: { PATCH } } = handlers', ['PATCH']],
    [
      'array destructuring',
      'export const [GET, , POST = h, ...OPTIONS] = handlers',
      ['GET', 'POST', 'HEAD', 'OPTIONS'],
    ],
    ['class', 'export class PUT {}', ['PUT']],
    // false positives of a substring match
    ['prefix name', 'export const GETTER = 1\nexport function POSTED() {}', []],
    ['commented out', '// export function GET() {}\n/* export const POST = 1 */', []],
    ['inside a string', "const s = 'export function GET() {}'", []],
    ['lowercase', 'export function get() {}', []],
    ['not exported', 'function GET() {}', []],
    ['default export', 'export default function GET() {}', []],
    // a namespace object is not a handler SvelteKit can call
    ['namespace re-export', "export * as GET from './handlers'", []],
    ['namespace re-export, string name', "export * as 'PUT' from './handlers'", []],
    ['empty file', '', []],
    // type-only exports have no runtime value
    ['type-only export list', 'type GET = 1\nexport type { GET }', []],
    ['type-only specifier', 'const POST = h\ntype GET = 1\nexport { type GET, POST }', ['POST']],
    // oxc marks `export declare` as a type-only export
    ['declared const (type-only)', 'export declare const GET: () => Response', []],
  ])('%s', async (_label, code, methods) => {
    expect(await methodsOf(code)).toMatchObject({ methods, complete: true });
  });

  it('parses .js endpoints as JavaScript', async () => {
    expect((await methodsOf('export async function GET() {}', 'js')).methods).toEqual([
      'GET',
      'HEAD',
    ]);
    // TS-only syntax is not JavaScript
    expect(await methodsOf('export const GET: number = 1', 'js')).toMatchObject({
      methods: [],
      complete: false,
    });
  });

  it('reports unparsable and unreadable endpoints as incomplete instead of throwing', async () => {
    expect(await methodsOf('export function GET( {')).toMatchObject({
      methods: [],
      complete: false,
    });
    const route = endpointRoute(null);
    expect(await analyzeApiEndpoints([route])).toEqual([
      {
        route: route.id,
        path: route.path,
        url: route.path,
        methods: [],
        complete: false,
        file: route.files[0]!.path,
      },
    ]);
  });

  it('puts the URL under the dev server base', async () => {
    const route = { ...endpointRoute('export const GET = h'), path: '/api/items/:id' };
    for (const base of ['/app/', '/app']) {
      const [endpoint] = await analyzeApiEndpoints([route], base);
      expect(endpoint).toMatchObject({ path: '/api/items/:id', url: '/app/api/items/:id' });
    }
    expect((await analyzeApiEndpoints([route]))[0]!.url).toBe('/api/items/:id');
  });

  it('skips routes without an endpoint file', async () => {
    const route = endpointRoute('export const GET = 1');
    expect(await analyzeApiEndpoints([{ ...route, files: [{ type: 'page', path: 'x' }] }])).toEqual(
      [],
    );
  });

  it('uses the given resolver for export *', async () => {
    const dir = project({ 'lib/handlers.ts': 'export const POST = h' });
    const route = endpointRoute("export * from '$lib/handlers'");
    const resolve = vi.fn<ResolveFile>(() => Promise.resolve(path.join(dir, 'lib/handlers.ts')));
    const [endpoint] = await analyzeApiEndpoints([route], '/', resolve);
    expect(endpoint).toMatchObject({ methods: ['POST'], complete: true });
    expect(resolve).toHaveBeenCalledWith('$lib/handlers', route.files[0]!.path);
  });
});

/** m0 → m1 → … → m{hops}, each `export *` from the next; m1 exports POST, the last GET. */
function chain(hops: number): string {
  const files: Record<string, string> = {};
  for (let i = 0; i < hops; i++) files[`m${i}.ts`] = `export * from './m${i + 1}'`;
  files['m1.ts'] += '\nexport const POST = h';
  files[`m${hops}.ts`] = 'export const GET = h';
  return path.join(project(files), 'm0.ts');
}

describe('collectExports: export * from', () => {
  it('follows stars through relative modules, recursively', async () => {
    const dir = project({
      'routes/+server.ts': "export * from './a'\nexport const GET = h",
      'routes/a.ts': "export * from './b.js'\nexport const POST = h",
      'routes/b.ts': "export * from '../shared/index.js'",
      // '../shared/index.js' resolves to the TypeScript source
      'shared/index.ts': 'export function DELETE() {}',
    });
    const result = await collectExports(path.join(dir, 'routes/+server.ts'), resolveRelative);
    expect(result).toEqual({ names: new Set(['GET', 'POST', 'DELETE']), complete: true });
  });

  it('survives cycles', async () => {
    const dir = project({
      'a.ts': "export * from './b'\nexport const GET = h",
      'b.ts': "export * from './a'\nexport const POST = h",
    });
    expect(await collectExports(path.join(dir, 'a.ts'), resolveRelative)).toEqual({
      names: new Set(['GET', 'POST']),
      complete: true,
    });
  });

  it.each([
    ['a package', "export * from 'handlers-pkg'"],
    ['an alias without a resolver', "export * from '$lib/handlers'"],
    ['a missing file', "export * from './missing'"],
    ['an unparsable module', "export * from './broken'"],
  ])('is incomplete when a star leads to %s, keeping what it knows', async (_label, star) => {
    const dir = project({
      '+server.ts': `${star}\nexport const GET = h`,
      'broken.ts': 'export {',
    });
    expect(await collectExports(path.join(dir, '+server.ts'), resolveRelative)).toEqual({
      names: new Set(['GET']),
      complete: false,
    });
  });

  it('treats a type-only star as no export at all', async () => {
    const dir = project({
      '+server.ts': "export type * from './types'",
      'types.ts': 'export const GET = h',
    });
    expect(await collectExports(path.join(dir, '+server.ts'), resolveRelative)).toEqual({
      names: new Set(),
      complete: true,
    });
  });

  it('keeps going when the resolver throws, marking the star unknown', async () => {
    const dir = project({ '+server.ts': "export * from 'x'\nexport const GET = h" });
    const resolve = vi.fn<ResolveFile>(() => Promise.reject(new Error('plugin failed')));
    expect(await collectExports(path.join(dir, '+server.ts'), resolve)).toEqual({
      names: new Set(['GET']),
      complete: false,
    });
  });

  it('follows a chain of MAX_DEPTH stars, and gives up past it keeping what it read', async () => {
    expect(await collectExports(chain(MAX_DEPTH), resolveRelative)).toEqual({
      names: new Set(['POST', 'GET']),
      complete: true,
    });
    expect(await collectExports(chain(MAX_DEPTH + 1), resolveRelative)).toEqual({
      names: new Set(['POST']),
      complete: false,
    });
  });

  it.each([
    ['a package', 'node_modules/cjs-pkg/index.js'],
    ['a workspace package (resolved to its real path)', 'packages/handlers/index.cjs'],
  ])('is incomplete when a star leads to CommonJS in %s', async (_label, file) => {
    const dir = project({
      '+server.ts': "export * from 'pkg'\nexport const POST = h",
      [file]: 'exports.GET = () => new Response()',
    });
    const target = path.join(dir, file);
    expect(
      await collectExports(path.join(dir, '+server.ts'), () => Promise.resolve(target)),
    ).toEqual({ names: new Set(['POST']), complete: false });
  });

  it('follows ESM in node_modules, and an empty endpoint is complete', async () => {
    const dir = project({
      '+server.ts': "export * from 'pkg'",
      'node_modules/pkg/index.js': 'export const GET = h',
      'empty/+server.ts': '',
    });
    const pkg = path.join(dir, 'node_modules/pkg/index.js');
    expect(await collectExports(path.join(dir, '+server.ts'), () => Promise.resolve(pkg))).toEqual({
      names: new Set(['GET']),
      complete: true,
    });
    expect(await collectExports(path.join(dir, 'empty/+server.ts'), resolveRelative)).toEqual({
      names: new Set(),
      complete: true,
    });
  });

  it('does not read a module over MAX_MODULE_BYTES', async () => {
    const dir = project({
      '+server.ts': "export * from './big'\nexport const POST = h",
      'big.ts': `export const GET = h\n${' '.repeat(MAX_MODULE_BYTES)}`,
    });
    expect(await collectExports(path.join(dir, '+server.ts'), resolveRelative)).toEqual({
      names: new Set(['POST']),
      complete: false,
    });
  });

  it('reads a module shared by many endpoints once per analysis', async () => {
    const dir = project({ 'shared.ts': 'export const GET = h' });
    const shared = path.join(dir, 'shared.ts');
    const routes = [1, 2, 3].map(() => endpointRoute("export * from 'shared'"));
    const read = vi.spyOn(fs.promises, 'readFile');
    const endpoints = await analyzeApiEndpoints(routes, '/', () => Promise.resolve(shared));
    for (const e of endpoints)
      expect(e).toMatchObject({ methods: ['GET', 'HEAD'], complete: true });
    expect(read.mock.calls.filter(([file]) => file === shared)).toHaveLength(1);
  });

  it('resolveRelative finds index files and ignores directories', async () => {
    const dir = project({ 'lib/index.js': '', 'dir.ts/x.ts': '' });
    const importer = path.join(dir, 'x.ts');
    expect(await resolveRelative('./lib', importer)).toBe(path.join(dir, 'lib/index.js'));
    expect(await resolveRelative('./dir', importer)).toBeNull();
  });

  it('serverResolver asks the dev server, and only for files', async () => {
    const dir = project({ 'x.ts': '' });
    const answers: Record<string, { id: string; external: boolean } | null> = {
      '$lib/a': { id: '/abs/real.ts', external: false },
      ext: { id: '/abs/ext.js', external: true },
      virtual: { id: '\0virtual', external: false },
      none: null,
    };
    const resolveId = vi.fn((id: string, _importer?: string) => Promise.resolve(answers[id]));
    const holder: { server?: { environments: Record<string, unknown> } } = {};
    const resolve = serverResolver(() => holder.server);
    // No server yet: relative resolution.
    expect(await resolve('./x', path.join(dir, 'y.ts'))).toBe(path.join(dir, 'x.ts'));
    // nor without an SSR environment
    holder.server = { environments: {} };
    expect(await resolve('./x', path.join(dir, 'y.ts'))).toBe(path.join(dir, 'x.ts'));
    holder.server = { environments: { ssr: { pluginContainer: { resolveId } } } };
    expect(await resolve('$lib/a', '/abs/+server.ts')).toBe('/abs/real.ts');
    expect(resolveId).toHaveBeenCalledWith('$lib/a', '/abs/+server.ts');
    for (const id of ['ext', 'virtual', 'none']) expect(await resolve(id, '/abs/i.ts')).toBeNull();
  });

  it('moduleExports returns null for unparsable code', () => {
    expect(moduleExports('export {', 'x.ts')).toBeNull();
    expect(moduleExports("export const a = 1, b = 2\nexport * from './c'", 'x.ts')).toEqual({
      names: new Set(['a', 'b']),
      stars: ['./c'],
      esm: true,
    });
    expect(moduleExports('exports.GET = 1', 'x.js')).toMatchObject({ esm: false });
  });
});
