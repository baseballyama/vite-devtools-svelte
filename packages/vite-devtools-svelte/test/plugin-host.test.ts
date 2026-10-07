// What the plugin wires into its devframe host and MCP server: every data
// source must read the live dev server / collector it belongs to.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import type { Plugin } from 'vite'
import { afterAll, describe, it, expect, vi } from 'vitest'

import * as mcpServerModule from '../src/mcp/server.js'
import type { McpDeps } from '../src/mcp/server.js'
import { SessionStore } from '../src/mcp/sessions.js'
import { svelteDevtools } from '../src/plugin.js'
import { callHook, resolvePlugins } from './helpers.js'

const editor = vi.hoisted(() => ({ launchEditor: vi.fn() }))
vi.mock('devframe/utils/launch-editor', () => editor)

const kit = vi.hoisted(() => ({
  createPluginFromDevframe: vi.fn((def: any) => ({
    devtools: { setup: (ctx: unknown) => def.setup(ctx) },
  })),
}))
vi.mock('@vitejs/devtools-kit/node', () => kit)

vi.mock('../src/mcp/server.js', async importOriginal => {
  const real = await importOriginal<typeof mcpServerModule>()
  return { ...real, buildMcpServer: vi.fn(real.buildMcpServer) }
})

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures')
const PAGE = path.join(FIXTURES, 'src/routes/+page.svelte')
const COUNTER = path.join(FIXTURES, 'src/lib/components/Counter.svelte')

type Handler = (...args: any[]) => any
const graphModule = (file: string, imports: string[] = []) => ({
  file,
  importedModules: imports.map(f => ({ file: f })),
})

function setup(serverOverrides: Record<string, unknown> = {}) {
  const plugins: Plugin[] = svelteDevtools()
  resolvePlugins(plugins, {
    root: FIXTURES,
    base: '/app/',
    plugins: [{ name: 'vite:devtools' }],
  })
  const listeners = new Map<string, Handler>()
  const routes: Array<[string, Handler]> = []
  // an unlistened http.Server: the plugin only reads its events and address
  const httpServer = Object.assign(http.createServer(), { address: () => null })
  const server = {
    hot: {
      on: (event: string, fn: Handler) => listeners.set(event, fn),
      off: vi.fn(),
      send: vi.fn(),
    },
    middlewares: { use: (p: string, fn: Handler) => routes.push([p, fn]) },
    httpServer,
    config: { server: {}, logger: { info: vi.fn(), error: vi.fn() } },
    environments: {} as Record<string, unknown>,
    transformRequest: vi.fn((_file: string) => Promise.resolve({ code: 'compiled', map: null })),
    resolvedUrls: { local: [] as string[], network: [] as string[] },
    ...serverOverrides,
  }
  const emit = (event: string, payload: unknown) =>
    listeners.get(`svelte-devtools:${event}`)!(payload, { send: vi.fn() })
  return {
    plugins,
    server,
    httpServer,
    emit,
    configure: () => callHook(plugins[0]!.configureServer, server),
    mcp: () => routes.find(([p]) => p === '/__svelte-devtools/mcp')![1],
    token: () => (plugins[0]!.api as { getDevtoolsToken: () => string }).getDevtoolsToken(),
  }
}

async function hub(plugins: Plugin[]) {
  const handlers = new Map<string, Handler>()
  await (plugins[0]!.devtools as any).setup({
    scope: () => ({
      rpc: { register: (fn: any) => handlers.set(fn.name, fn.handler) },
    }),
  })
  return (name: string, ...args: unknown[]) => handlers.get(name)!(...args)
}

describe('devframe host wiring', () => {
  it('module graph: every environment of the current server, none before / after it', async () => {
    const s = setup({
      environments: {
        client: { moduleGraph: { idToModuleMap: new Map([['a', graphModule(PAGE, [COUNTER])]]) } },
        ssr: { moduleGraph: { idToModuleMap: new Map([['b', graphModule(COUNTER)]]) } },
        // an environment without a module graph is skipped
        other: {},
      },
    })
    const call = await hub(s.plugins)
    expect((await call('get-module-graph')).modules).toEqual([])
    s.configure()
    const graph = await call('get-module-graph')
    expect(graph.modules.map((m: { file: string }) => m.file).toSorted()).toEqual(
      [COUNTER, PAGE].toSorted(),
    )
    s.httpServer.emit('close')
    expect((await call('get-module-graph')).modules).toEqual([])
  })

  it('module graph: falls back to the legacy single graph', async () => {
    const s = setup({
      moduleGraph: { idToModuleMap: new Map([['a', graphModule(PAGE)]]) },
    })
    s.configure()
    const graph = await (await hub(s.plugins))('get-module-graph')
    expect(graph.modules.map((m: { file: string }) => m.file)).toEqual([PAGE])
  })

  it('inspect-file compiles through the live server, and not after it closed', async () => {
    const s = setup()
    const call = await hub(s.plugins)
    s.configure()
    const result = await call('inspect-file', { file: 'src/routes/+page.svelte' })
    expect(s.server.transformRequest).toHaveBeenCalledWith(PAGE)
    expect(result.compiled).toBe('compiled')
    expect(result.source.length).toBeGreaterThan(0)
    s.httpServer.emit('close')
    expect((await call('inspect-file', { file: 'src/routes/+page.svelte' })).compiled).toBe('')
  })

  it('open-in-editor opens the root-resolved file at the line', async () => {
    const s = setup()
    s.configure()
    await (
      await hub(s.plugins)
    )('open-in-editor', { file: 'src/routes/+page.svelte', line: 3 })
    expect(editor.launchEditor).toHaveBeenCalledWith(`${PAGE}:3`)
  })

  it('assets are served under the configured Vite base', async () => {
    const s = setup()
    s.configure()
    const assets = await (await hub(s.plugins))('get-assets')
    expect(assets.length).toBeGreaterThan(0)
    for (const a of assets) expect(a.url.startsWith('/app/')).toBe(true)
  })

  describe('send-api-request: the dev server origins are allowed', () => {
    const local = http.createServer((_req, res) => {
      res.end('hello')
    })
    afterAll(
      () =>
        new Promise<void>(resolve => {
          local.close(() => resolve())
        }),
    )

    it('reaches its own server, and only once it knows its URLs', async () => {
      await new Promise<void>(resolve => {
        local.listen(0, '127.0.0.1', resolve)
      })
      const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}/api`
      const s = setup()
      const call = await hub(s.plugins)
      const request = { url, method: 'GET', headers: '', body: '' }
      // before configureServer: no origins, a loopback URL is refused (SSRF guard)
      expect((await call('send-api-request', request)).status).toBe(0)
      s.server.resolvedUrls = { local: [`${new URL(url).origin}/`], network: [] }
      s.configure()
      const res = await call('send-api-request', request)
      expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: 'hello' })
    })
  })
})

/** The deps the endpoint builds its MCP server from (captured on one request). */
async function mcpDeps(s: ReturnType<typeof setup>): Promise<McpDeps> {
  const build = vi.mocked(mcpServerModule.buildMcpServer)
  build.mockClear()
  build.mockImplementationOnce(
    () => ({ connect: () => Promise.reject(new Error('x')), close: async () => {} }) as never,
  )
  const res = { statusCode: 200, headersSent: false, setHeader: vi.fn(), end: vi.fn() }
  s.mcp()({ headers: { 'x-svelte-devtools-token': s.token() } }, res)
  s.emit('state-timeline', { epoch: 'e1', reset: true, changes: [] }) // activation snapshot
  await vi.waitFor(() => expect(build).toHaveBeenCalledOnce())
  return build.mock.calls[0]![0]
}

describe('MCP server wiring', () => {
  it('every getter reads the live collector / project', async () => {
    const s = setup()
    s.configure()
    const deps = await mcpDeps(s)
    const component = { id: 1, file: PAGE, name: 'Page', parentId: null, mounted: true }
    s.emit('components', { epoch: 'e1', components: [component] })
    s.emit('profiles', { epoch: 'e1', profiles: [{ id: 1, renders: 2 }] })
    s.emit('fps', { timestamp: 1, fps: 60 })
    s.emit('state-timeline', {
      epoch: 'e1',
      changes: [
        { id: 'n', name: 'n', componentFile: PAGE, oldValue: 0, newValue: 1, timestamp: 2 },
      ],
    })
    callHook(s.plugins.find(p => p.name.endsWith(':load-profile'))!.configureServer, {})
    ;(globalThis as any).__svelte_devtools_record_load('/', PAGE, 'server', 1, 2)

    expect(deps.getLiveSnapshot().components).toEqual([component])
    expect(deps.getLiveSnapshot()).toMatchObject({ epoch: 'e1', total: 1 })
    expect(deps.getRenderProfiles()).toEqual([{ id: 1, renders: 2 }])
    expect(deps.getFpsSamples()).toEqual([{ timestamp: 1, fps: 60 }])
    expect(deps.getLoadProfiles()).toMatchObject([{ route: '/', file: PAGE }])
    expect(deps.getStateTimelineDelta().changes.map(c => c.id)).toEqual(['n'])
    expect(deps.getCaptureInfo().liveComponents?.total).toBe(1)
    expect(deps.getProject().routesDir).toBe(path.join(FIXTURES, 'src/routes'))
    expect(deps.getRoutes().length).toBeGreaterThan(0)
    expect(deps.getComponentRelations().length).toBeGreaterThan(0)
    expect(deps.sessions).toBeInstanceOf(SessionStore)
  })

  it('sessions measure the live collector', async () => {
    const s = setup()
    s.configure()
    const { sessions } = await mcpDeps(s)
    callHook(s.plugins.find(p => p.name.endsWith(':load-profile'))!.configureServer, {})
    const profile = { componentId: 1, file: PAGE, name: 'Page', renderCount: 0, totalRenderTime: 0 }
    s.emit('profiles', { epoch: 'e1', profiles: [profile] })
    sessions.start('run', false)
    s.emit('fps', { timestamp: 1, fps: 20 })
    ;(globalThis as any).__svelte_devtools_record_load('/', PAGE, 'server', 5, 2)
    s.emit('profiles', {
      epoch: 'e1',
      profiles: [{ ...profile, renderCount: 2, totalRenderTime: 4 }],
    })
    const delta = sessions.deltaOf(sessions.end('discard'))
    expect(delta.fps).toMatchObject({ samples: 1, min: 20, drops: 1 })
    expect(delta.loadProfiles).toMatchObject({ count: 1, avgDuration: 5 })
    expect(delta.components).toMatchObject([{ componentId: 1, renderCountDelta: 2 }])
  })

  it('graph and summary pulls go to the runtime over the hot channel', async () => {
    const s = setup()
    s.configure()
    const deps = await mcpDeps(s)
    s.emit('components', { epoch: 'e1', components: [{ id: 1, parentId: null }] })
    const lastRequest = (event: string) =>
      s.server.hot.send.mock.calls.findLast(([e]) => e === `svelte-devtools:${event}`)![1]

    const graph = deps.getReactiveGraph()
    s.emit('reactive-graph', {
      requestId: lastRequest('request-reactive-graph').requestId,
      epoch: 'e1',
      nodes: [{ id: '1:a' }],
      edges: [],
    })
    expect((await graph).nodes).toEqual([{ id: '1:a' }])

    const scoped = deps.getReactiveScope({ componentId: 1 })
    expect(lastRequest('request-reactive-graph')).toMatchObject({ componentId: 1 })
    s.emit('reactive-graph', {
      requestId: lastRequest('request-reactive-graph').requestId,
      epoch: 'e1',
      nodes: [],
      edges: [],
    })
    expect((await scoped).stale).toBeFalsy()

    const summary = deps.getReactiveSummary({ topK: 5 })
    s.emit('reactive-summary', {
      requestId: lastRequest('request-reactive-summary').requestId,
      epoch: 'e1',
      rows: [],
    })
    expect((await summary).stale).toBeFalsy()
  })
})
