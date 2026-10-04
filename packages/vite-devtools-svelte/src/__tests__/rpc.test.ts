import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createRpcFunctions,
  createSvelteDevframe,
  DEVFRAME_BASE,
  DEVFRAME_ID,
} from '../devframe.js'
import { createTestHost, rpcHandlers } from './helpers.js'

vi.mock('node:dns/promises', () => ({
  default: { lookup: async () => [{ address: '93.184.215.14', family: 4 }] },
}))

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')
const COUNTER = path.join(FIXTURES_DIR, 'src/lib/components/Counter.svelte')

describe('devframe definition', () => {
  it('is a dev-only, host-agnostic tool mounted at /.svelte-devtools/', () => {
    const def = createSvelteDevframe(createTestHost(FIXTURES_DIR))
    expect(def.id).toBe(DEVFRAME_ID)
    expect(def.basePath).toBe(DEVFRAME_BASE)
    expect(def.capabilities).toEqual({ dev: true, build: false })
    expect(def.packageName).toBe('vite-devtools-svelte')
    expect(String(def.clientAssets)).toMatch(/client$/)
  })

  it('registers every RPC under the svelte-devtools scope with bare names', async () => {
    const registered: string[] = []
    const def = createSvelteDevframe(createTestHost(FIXTURES_DIR))
    await def.setup({
      scope: (id: string) => ({
        rpc: { register: (fn: { name: string }) => registered.push(`${id}:${fn.name}`) },
      }),
    } as any)
    expect(registered).toContain('svelte-devtools:get-project')
    expect(registered).toContain('svelte-devtools:get-state-timeline-delta')
    expect(
      registered.every(n => n.startsWith('svelte-devtools:') && n.split(':').length === 2),
    ).toBe(true)
  })

  it('marks reads as query, mutations as action, all JSON-serializable', () => {
    const fns = createRpcFunctions(createTestHost(FIXTURES_DIR))
    const shape = (fn: (typeof fns)[number]) => ({
      name: fn.name,
      jsonSerializable: fn.jsonSerializable,
      type: fn.type,
    })
    expect(fns.map(shape)).toEqual(
      fns.map(fn => ({
        name: fn.name,
        jsonSerializable: true,
        type: /^(get-|inspect-)/.test(fn.name) && fn.name !== 'get-og-preview' ? 'query' : 'action',
      })),
    )
  })
})

describe('project analysis RPCs', () => {
  const rpc = rpcHandlers(createTestHost(FIXTURES_DIR, { publicBase: () => '/base/' }))

  it('get-project / get-routes / get-component-relations / get-svelte-files', async () => {
    expect((await rpc.get('svelte-devtools:get-project')!()).name).toBeTruthy()
    expect((await rpc.get('svelte-devtools:get-routes')!()).length).toBeGreaterThan(0)
    expect((await rpc.get('svelte-devtools:get-component-relations')!()).length).toBeGreaterThan(0)
    const files = await rpc.get('svelte-devtools:get-svelte-files')!()
    expect(files[0]).toEqual({ file: expect.any(String), name: expect.any(String) })
  })

  it('get-assets returns a previewable public URL under the Vite base', async () => {
    const assets = await rpc.get('svelte-devtools:get-assets')!()
    const logo = assets.find((a: any) => a.name === 'logo.svg')
    expect(logo.url).toBe('/base/logo.svg')
    const nested = assets.find((a: any) => a.relativePath.includes(path.sep))
    expect(nested.url).toBe('/base/' + nested.relativePath.split(path.sep).join('/'))
  })

  it('get-api-endpoints detects exported HTTP methods', async () => {
    const endpoints = await rpc.get('svelte-devtools:get-api-endpoints')!()
    expect(endpoints.length).toBeGreaterThan(0)
    for (const e of endpoints) expect(e.methods.length).toBeGreaterThan(0)
  })

  it('get-build-analysis is empty without build output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-empty-'))
    const result = await rpcHandlers(createTestHost(root)).get(
      'svelte-devtools:get-build-analysis',
    )!()
    expect(result.chunks).toEqual([])
  })
})

describe('collector-backed RPCs', () => {
  it('live components meta reports truncation', async () => {
    const host = createTestHost(FIXTURES_DIR)
    host.collector.ingestComponents({
      components: Array.from({ length: 60_000 }, (_, i) => ({ id: i })),
    })
    const meta = await rpcHandlers(host).get('svelte-devtools:get-live-components-meta')!()
    expect(meta).toEqual({
      total: 60_000,
      kept: 50_000,
      truncated: true,
      epoch: '(legacy)',
      epochs: 1,
    })
  })

  it('set-active leases and releases per client', () => {
    const host = createTestHost(FIXTURES_DIR)
    const rpc = rpcHandlers(host)
    rpc.get('svelte-devtools:set-active')!({ client: 'tab1', active: true })
    expect(host.collector.subscription).toEqual({ active: true, componentDeltas: true })
    rpc.get('svelte-devtools:set-active')!({ client: 'tab1', active: false })
    expect(host.collector.subscription).toEqual({ active: false, componentDeltas: true })
  })

  it('timeline delta and versions', async () => {
    const host = createTestHost(FIXTURES_DIR)
    const rpc = rpcHandlers(host)
    host.collector.ingestStateTimeline({
      changes: [{ id: 'a', name: 'a', componentFile: '', oldValue: 0, newValue: 1, timestamp: 1 }],
    })
    const d = await rpc.get('svelte-devtools:get-state-timeline-delta')!({})
    expect(d.reset).toBe(true)
    // seq is opaque and monotonic (seeded per process, §6.4 D2); the cursor is the newest seq
    expect(d.changes).toHaveLength(1)
    expect(d.cursor).toBe(d.changes[0].seq)
    const next = await rpc.get('svelte-devtools:get-state-timeline-delta')!({ since: d.cursor })
    expect(next).toEqual({ cursor: d.cursor, reset: false, changes: [] })
    expect((await rpc.get('svelte-devtools:get-versions')!()).stateTimeline).toBeGreaterThan(0)
  })

  it('clear RPCs empty their buffers', async () => {
    const host = createTestHost(FIXTURES_DIR)
    const rpc = rpcHandlers(host)
    host.collector.recordLoadProfile({ route: '/' } as any)
    host.collector.ingestRuntimeError({ message: 'x' } as any)
    host.collector.ingestFps({ fps: 1 } as any)
    await rpc.get('svelte-devtools:clear-load-profiles')!()
    await rpc.get('svelte-devtools:clear-errors')!()
    await rpc.get('svelte-devtools:clear-fps')!()
    expect(await rpc.get('svelte-devtools:get-load-profiles')!()).toEqual([])
    expect(await rpc.get('svelte-devtools:get-runtime-errors')!()).toEqual([])
    expect(await rpc.get('svelte-devtools:get-fps')!()).toEqual([])
  })
})

describe('file access sandbox', () => {
  const host = createTestHost(FIXTURES_DIR)
  const rpc = rpcHandlers(host)

  it('inspect-file refuses paths outside the root (absolute and traversal)', async () => {
    expect((await rpc.get('svelte-devtools:inspect-file')!({ file: '/etc/passwd' })).source).toBe(
      '',
    )
    expect(
      (await rpc.get('svelte-devtools:inspect-file')!({ file: '../../../etc/passwd' })).source,
    ).toBe('')
  })

  it('inspect-file refuses symlinks escaping the root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-link-'))
    fs.symlinkSync('/etc', path.join(root, 'escape'))
    const r = rpcHandlers(createTestHost(root))
    expect((await r.get('svelte-devtools:inspect-file')!({ file: 'escape/hosts' })).source).toBe('')
  })

  it('inspect-file returns source, and compiled output + map from the dev server', async () => {
    const transformRequest = vi.fn(async () => ({
      code: 'compiled',
      map: JSON.stringify({ mappings: 'AAAA', sources: ['Counter.svelte'] }),
    }))
    const r = rpcHandlers(createTestHost(FIXTURES_DIR, { transformRequest }))
    const result = await r.get('svelte-devtools:inspect-file')!({
      file: 'src/lib/components/Counter.svelte',
    })
    expect(result.source).toContain('$state')
    expect(result).toMatchObject({
      compiled: 'compiled',
      mappings: 'AAAA',
      sources: ['Counter.svelte'],
    })
    expect(transformRequest).toHaveBeenCalledWith(fs.realpathSync(COUNTER))
  })

  it('inspect-file reports transform failures without throwing', async () => {
    const r = rpcHandlers(
      createTestHost(FIXTURES_DIR, {
        transformRequest: async () => Promise.reject(new Error('x')),
      }),
    )
    const result = await r.get('svelte-devtools:inspect-file')!({ file: COUNTER })
    expect(result.compiled).toBe('// Transform failed')
  })

  it('open-in-editor resolves inside the root and passes file:line to the editor', async () => {
    await rpc.get('svelte-devtools:open-in-editor')!({ file: COUNTER, line: 3 })
    expect(host.opened.at(-1)).toBe(`${fs.realpathSync(COUNTER)}:3`)
    expect(() => rpc.get('svelte-devtools:open-in-editor')!({ file: '/etc/passwd' })).toThrow(
      /outside/,
    )
    expect(() => rpc.get('svelte-devtools:open-in-editor')!({ file: 'nope.svelte' })).toThrow(
      /not found/,
    )
  })

  it('open-reactive-in-editor jumps to the declaration line', async () => {
    await rpc.get('svelte-devtools:open-reactive-in-editor')!({
      file: COUNTER,
      name: 'count',
      type: 'state',
    })
    const line =
      fs
        .readFileSync(COUNTER, 'utf-8')
        .split('\n')
        .findIndex(l => /let\s+count\b/.test(l)) + 1
    expect(host.opened.at(-1)).toBe(`${fs.realpathSync(COUNTER)}:${line}`)
    expect(() =>
      rpc.get('svelte-devtools:open-reactive-in-editor')!({
        file: '/etc/hosts',
        name: 'x',
        type: 'state',
      }),
    ).toThrow(/outside/)
  })
})

describe('module graph RPC', () => {
  const file = (rel: string) => path.join(FIXTURES_DIR, rel)
  const mod = (rel: string, imports: any[] = []) => ({
    file: file(rel),
    importedModules: new Set(imports),
  })

  it('builds project-local nodes, edges, types and cycles from the dev server graph', async () => {
    const a = mod('src/a.ts')
    const b = mod('src/b.svelte')
    const c = mod('src/c.js')
    const css = mod('src/s.css')
    const dep = { file: '/x/node_modules/dep/index.js', importedModules: new Set() }
    a.importedModules = new Set([b, css, dep])
    b.importedModules = new Set([c])
    c.importedModules = new Set([a])
    // duplicate across environments (client + ssr) must be deduplicated
    const modules = [a, b, c, css, dep, { ...a }]
    const r = rpcHandlers(createTestHost(FIXTURES_DIR, { modules: () => modules }))
    const graph = await r.get('svelte-devtools:get-module-graph')!()
    const ids = graph.modules.map((m: any) => m.id).sort()
    expect(ids).toEqual(['src/a.ts', 'src/b.svelte', 'src/c.js', 'src/s.css'])
    const byId = Object.fromEntries(graph.modules.map((m: any) => [m.id, m]))
    expect(byId['src/a.ts'].type).toBe('ts')
    expect(byId['src/b.svelte'].type).toBe('svelte')
    expect(byId['src/s.css'].type).toBe('css')
    expect(byId['src/a.ts'].imports).toEqual(['src/b.svelte', 'src/s.css'])
    expect(byId['src/b.svelte'].importedBy).toEqual(['src/a.ts'])
    expect(graph.cycles).toHaveLength(1)
    expect(byId['src/c.js'].isCyclic).toBe(true)
    expect(byId['src/s.css'].isCyclic).toBeUndefined()
  })

  it('is empty without a dev server', async () => {
    const graph = await rpcHandlers(createTestHost(FIXTURES_DIR)).get(
      'svelte-devtools:get-module-graph',
    )!()
    expect(graph).toEqual({ modules: [], cycles: [] })
  })
})

describe('send-api-request', () => {
  it('blocks private targets but allows the dev server origin, without following redirects', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200, headers: { 'x-a': '1' } }))
    const r = rpcHandlers(
      createTestHost(FIXTURES_DIR, { serverOrigins: () => ['http://localhost:5173'] }),
    )
    const send = r.get('svelte-devtools:send-api-request')!
    const blocked = await send({
      url: 'http://169.254.169.254/',
      method: 'GET',
      headers: '',
      body: '',
    })
    expect(blocked.status).toBe(0)
    expect(blocked.statusText).toMatch(/Blocked/)
    const other = await send({
      url: 'http://localhost:6379/',
      method: 'GET',
      headers: '',
      body: '',
    })
    expect(other.status).toBe(0)

    const own = await send({
      url: 'http://localhost:5173/api/hello',
      method: 'POST',
      headers: '{"a":"b"}',
      body: 'x',
    })
    expect(own).toMatchObject({ status: 200, body: 'ok', headers: { 'x-a': '1' } })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/api/hello',
      expect.objectContaining({ method: 'POST', body: 'x', redirect: 'manual' }),
    )
    fetchMock.mockRestore()
  })
})
