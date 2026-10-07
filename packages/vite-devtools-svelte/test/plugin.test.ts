import http from 'node:http'

import type { Plugin } from 'vite'
import { describe, it, expect, vi } from 'vitest'

import { svelteDevtools } from '../src/plugin.js'
import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from '../src/runtime/index.js'
import { callHook, resolvePlugins } from './helpers.js'

// =====================================================================
// Plugin Factory: svelteDevtools()
// =====================================================================

describe('svelteDevtools factory', () => {
  it('should return an array of 6 plugins', () => {
    const plugins = svelteDevtools()
    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBe(6)
  })

  it('should return plugins with correct names', () => {
    const plugins = svelteDevtools()
    const names = plugins.map(p => p.name)
    expect(names).toContain('vite-devtools-svelte')
    expect(names).toContain('vite-devtools-svelte:tracking')
    expect(names).toContain('vite-devtools-svelte:load-profile')
    expect(names).toContain('vite-devtools-svelte:load-profile-server')
    expect(names).toContain('vite-devtools-svelte:sveltekit-template-injector')
    expect(names).toContain('vite-devtools-svelte:warning-capture')
  })

  it('should NOT include effect-tracking plugin (removed)', () => {
    const plugins = svelteDevtools()
    const names = plugins.map(p => p.name)
    expect(names).not.toContain('vite-devtools-svelte:effect-tracking')
  })

  it('should have correct enforce order', () => {
    const plugins = svelteDevtools()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    const tracking = plugins.find(p => p.name === 'vite-devtools-svelte:tracking')!
    const loadProfile = plugins.find(p => p.name === 'vite-devtools-svelte:load-profile')!
    const warningCapture = plugins.find(p => p.name === 'vite-devtools-svelte:warning-capture')!

    expect(mainPlugin.enforce).toBe('pre')
    expect(tracking.enforce).toBe('post')
    expect(loadProfile.enforce).toBe('post')
    expect(warningCapture.enforce).toBe('post')
  })

  it('main plugin should come before tracking plugin', () => {
    const plugins = svelteDevtools()
    const mainIdx = plugins.findIndex(p => p.name === 'vite-devtools-svelte')
    const trackingIdx = plugins.findIndex(p => p.name === 'vite-devtools-svelte:tracking')
    expect(mainIdx).toBeLessThan(trackingIdx)
  })

  it('should accept empty options', () => {
    expect(() => svelteDevtools({})).not.toThrow()
  })

  it('should accept componentTracking option', () => {
    expect(() => svelteDevtools({ componentTracking: false })).not.toThrow()
    expect(() => svelteDevtools({ componentTracking: true })).not.toThrow()
  })

  it('should default componentTracking to true', () => {
    const plugins = svelteDevtools()
    resolvePlugins(plugins)
    const trackingPlugin = plugins.find(p => p.name === 'vite-devtools-svelte:tracking')!
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = callHook(trackingPlugin.transform, code, '/test/src/lib/Counter.svelte')
    expect(result).not.toBeNull()
  })
})

// =====================================================================
// Virtual Module Resolution (runtime + wrapper)
// =====================================================================

function getMainPlugin(): Plugin {
  const plugins = svelteDevtools()
  const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
  resolvePlugins([plugin])
  return plugin
}

describe('mainPlugin virtual module resolution', () => {
  // Runtime virtual module
  it('should resolve the runtime virtual module ID', () => {
    const plugin = getMainPlugin()
    const resolved = callHook(plugin.resolveId, RUNTIME_MODULE_ID)
    expect(resolved).toBe(RESOLVED_RUNTIME_ID)
  })

  it('should load the runtime code for the resolved ID', () => {
    const plugin = getMainPlugin()
    const loaded = callHook(plugin.load, RESOLVED_RUNTIME_ID)
    expect(loaded).toBe(runtimeCode)
  })

  // svelte/internal/client wrapper
  it('should intercept svelte/internal/client from user code', () => {
    const plugin = getMainPlugin()
    const resolved = callHook(
      plugin.resolveId,
      'svelte/internal/client',
      '/test/src/lib/Counter.svelte',
    )
    expect(resolved).toBe(WRAPPER_MODULE_ID)
  })

  it('should NOT intercept svelte/internal/client from node_modules', () => {
    const plugin = getMainPlugin()
    const resolved = callHook(
      plugin.resolveId,
      'svelte/internal/client',
      '/test/node_modules/svelte/src/index.js',
    )
    expect(resolved).toBeNull()
  })

  it('should NOT intercept svelte/internal/client from virtual modules (\\0 prefix)', () => {
    const plugin = getMainPlugin()
    const resolved = callHook(
      plugin.resolveId,
      'svelte/internal/client',
      '\0svelte-devtools:wrapped-client',
    )
    expect(resolved).toBeNull()
  })

  it('should NOT intercept svelte/internal/client without importer', () => {
    const plugin = getMainPlugin()
    const resolved = callHook(plugin.resolveId, 'svelte/internal/client')
    expect(resolved).toBeNull()
  })

  it('should NOT intercept svelte/internal/client in build mode', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    resolvePlugins([plugin], { command: 'build' })
    const resolved = callHook(
      plugin.resolveId,
      'svelte/internal/client',
      '/test/src/lib/Counter.svelte',
    )
    expect(resolved).toBeNull()
  })

  it('should NOT intercept svelte/internal/client when componentTracking is disabled', () => {
    const plugins = svelteDevtools({ componentTracking: false })
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    resolvePlugins([plugin])
    const resolved = callHook(
      plugin.resolveId,
      'svelte/internal/client',
      '/test/src/lib/Counter.svelte',
    )
    expect(resolved).toBeNull()
  })

  it('should load the wrapper code for the wrapper module ID', () => {
    const plugin = getMainPlugin()
    const loaded = callHook(plugin.load, WRAPPER_MODULE_ID)
    expect(loaded).toBe(wrapperCode)
  })

  it('should return null (defer) for other module IDs', () => {
    const plugin = getMainPlugin()
    expect(callHook(plugin.resolveId, 'some-other-module')).toBeNull()
    expect(callHook(plugin.load, 'some-other-id')).toBeNull()
  })
})

// =====================================================================
// HTML Injection (transformIndexHtml)
// =====================================================================

describe('mainPlugin transformIndexHtml', () => {
  it('should inject runtime script in serve mode', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    resolvePlugins([plugin])
    const hook = plugin.transformIndexHtml as { order: string; handler: () => any }
    // before Vite's HTML processing, which rewrites the inline bare import
    expect(hook.order).toBe('pre')
    const result = hook.handler()
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0].tag).toBe('script')
    expect(result[0].attrs.type).toBe('module')
    expect(result[0].children).toContain(RUNTIME_MODULE_ID)
    expect(result[0].injectTo).toBe('head-prepend')
  })

  it('should not inject anything in build mode', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    resolvePlugins([plugin], { command: 'build' })
    const result = (plugin.transformIndexHtml as { handler: () => any }).handler()
    expect(result).toEqual([])
  })
})

// =====================================================================
// Vite DevTools (hub) integration via the devtools hook
// =====================================================================

const kit = vi.hoisted(() => ({
  createPluginFromDevframe: vi.fn((def: any, options: any) => ({
    name: `devframe:${def.id}`,
    devtools: { setup: (ctx: any) => def.setup(ctx), options },
  })),
}))
vi.mock('@vitejs/devtools-kit/node', () => kit)

// Observe devframe instances without running real transports (host.test.ts covers the real stack).
const initiate = vi.hoisted(() => ({
  initDevframe: vi.fn((_def: unknown, _options: unknown) => ({
    nodeMiddleware: vi.fn(),
    close: vi.fn(async () => {}),
  })),
}))
vi.mock('devframe/initiate', () => initiate)

const FIXTURES = new URL('fixtures', import.meta.url).pathname

/** Run the hub path: devtools.setup → createPluginFromDevframe → def.setup(ctx). */
async function hubHandlers(plugins: Plugin[]) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const main = plugins.find(p => p.name === 'vite-devtools-svelte')!
  await (main.devtools as any).setup({
    scope: (id: string) => ({
      rpc: { register: (fn: any) => handlers.set(`${id}:${fn.name}`, fn.handler) },
    }),
  })
  return handlers
}

function resolve(plugins: Plugin[], config: Record<string, unknown> = {}) {
  return resolvePlugins(plugins, { root: FIXTURES, ...config })
}

function mockServer() {
  const middlewares: Array<(...args: any[]) => any> = []
  // An unlistened http.Server: emits 'close' like the dev server's own.
  const httpServer = Object.assign(http.createServer(), { address: () => null })
  return {
    middlewares,
    httpServer,
    server: {
      hot: { on: vi.fn(), off: vi.fn(), send: vi.fn() },
      middlewares: { use: (...args: any[]) => middlewares.push(args.at(-1)) },
      httpServer,
      config: { server: {}, logger: { info: () => {}, error: () => {} } },
      environments: {},
    } as any,
  }
}

describe('mainPlugin devtools hook (Vite DevTools)', () => {
  it('is dev-only and declares no build capability', () => {
    const main = svelteDevtools().find(p => p.name === 'vite-devtools-svelte')!
    expect(main.apply).toBe('serve')
    expect((main.devtools as any).capabilities).toEqual({ dev: true, build: false })
  })

  it('mounts the portable devframe through the kit at /.svelte-devtools/', async () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    const handlers = await hubHandlers(plugins)
    expect(kit.createPluginFromDevframe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'svelte-devtools', basePath: '/.svelte-devtools/' }),
      { base: '/.svelte-devtools/' },
    )
    const expected = [
      'get-project',
      'get-routes',
      'get-live-components',
      'get-module-graph',
      'send-api-request',
    ]
    expect(expected.filter(name => !handlers.has(`svelte-devtools:${name}`))).toEqual([])
    expect((await handlers.get('svelte-devtools:get-project')!()).name).toBeTruthy()
  })
})

describe('mount selection', () => {
  it('mounts standalone when @vitejs/devtools is absent', () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    const m = mockServer()
    callHook(plugins[0]!.configureServer, m.server)
    // [standalone devframe middleware, MCP middleware]
    expect(m.middlewares).toHaveLength(2)
  })

  it('does not mount standalone when the Vite DevTools hub is present (it calls our devtools hook)', () => {
    const plugins = svelteDevtools()
    resolve(plugins, { plugins: [{ name: 'vite:devtools' }] })
    const m = mockServer()
    callHook(plugins[0]!.configureServer, m.server)
    expect(m.middlewares).toHaveLength(1) // MCP only
  })

  it('standalone answers 503 for the DevTools base before the server listens', () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    const m = mockServer()
    callHook(plugins[0]!.configureServer, m.server)
    const res = { statusCode: 200, end: vi.fn() }
    const next = vi.fn()
    m.middlewares[0]!({ url: '/.svelte-devtools/' }, res, next)
    expect(res.statusCode).toBe(503)
    m.middlewares[0]!({ url: '/app' }, { end: vi.fn() }, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('subscribes the collector to the hot channel and unsubscribes on server close', () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    const m = mockServer()
    callHook(plugins[0]!.configureServer, m.server)
    expect(m.server.hot.on).toHaveBeenCalledWith('svelte-devtools:components', expect.any(Function))
    m.httpServer.emit('close')
    expect(m.server.hot.off).toHaveBeenCalledWith(
      'svelte-devtools:components',
      expect.any(Function),
    )
  })
})

function middlewareServer() {
  const m = mockServer()
  m.server.httpServer = null
  return m
}
const lastInstance = () => initiate.initDevframe.mock.results.at(-1)!.value

describe('middleware mode disposal (closeServer hook)', () => {
  it('config-file restart: the old plugin instance disposes its mount, the new one survives', async () => {
    const oldInstance = svelteDevtools()
    resolve(oldInstance)
    callHook(oldInstance[0]!.configureServer, middlewareServer().server)
    const a = lastInstance()
    const newInstance = svelteDevtools() // config re-evaluated on restart
    resolve(newInstance)
    callHook(newInstance[0]!.configureServer, middlewareServer().server)
    const b = lastInstance()

    await callHook(oldInstance[0]!.closeServer, { reason: 'restart' })
    expect(a.close).toHaveBeenCalledOnce()
    expect(b.close).not.toHaveBeenCalled()
    await callHook(newInstance[0]!.closeServer, { reason: 'close' })
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('inline restart: the reused plugin instance keeps only the newest mount', async () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    callHook(plugins[0]!.configureServer, middlewareServer().server)
    const a = lastInstance()
    callHook(plugins[0]!.configureServer, middlewareServer().server)
    const b = lastInstance()
    await callHook(plugins[0]!.closeServer, { reason: 'restart' })
    expect(a.close).toHaveBeenCalledOnce()
    expect(b.close).not.toHaveBeenCalled()
    await callHook(plugins[0]!.closeServer, { reason: 'close' })
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('serves devframe through SSE in middleware mode (no WebSocket server to share)', () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    callHook(plugins[0]!.configureServer, middlewareServer().server)
    expect(initiate.initDevframe.mock.calls.at(-1)![1]).toMatchObject({
      ws: false,
      sse: true,
      mcp: false,
    })
  })
})

// =====================================================================
// Warning Capture Plugin
// =====================================================================

describe('warningCapturePlugin', () => {
  it('captures Svelte compiler warnings and still forwards them', async () => {
    const plugins = svelteDevtools()
    const forwarded: string[] = []
    const logger = { warn: (msg: string) => forwarded.push(msg) }
    resolve(plugins, { logger })
    logger.warn('/test/src/lib/Counter.svelte:5:2 (a11y_no_redundant_roles) Warning message')
    logger.warn('unrelated warning')
    const warnings = await (
      await hubHandlers(plugins)
    ).get('svelte-devtools:get-compiler-warnings')!()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ code: 'a11y_no_redundant_roles', line: 5, column: 2 })
    expect(forwarded).toHaveLength(2)
  })

  it('does not stack wrappers on a reused customLogger and feeds the newest plugin instance', async () => {
    const forwarded: string[] = []
    const logger = { warn: (msg: string) => forwarded.push(msg) }
    const first = svelteDevtools()
    resolve(first, { logger })
    const second = svelteDevtools() // config-file restart: fresh plugin instances, same logger
    resolve(second, { logger })
    logger.warn('/a/App.svelte:1:1 (x) w')
    expect(forwarded).toHaveLength(1)
    expect(
      await (await hubHandlers(second)).get('svelte-devtools:get-compiler-warnings')!(),
    ).toHaveLength(1)
    expect(
      await (await hubHandlers(first)).get('svelte-devtools:get-compiler-warnings')!(),
    ).toHaveLength(0)
  })
})

// =====================================================================
// Load Profile Server Plugin
// =====================================================================

describe('loadProfileServerPlugin', () => {
  it('records load timings from the transformed load wrapper', async () => {
    const plugins = svelteDevtools()
    resolve(plugins)
    const serverPlugin = plugins.find(p => p.name === 'vite-devtools-svelte:load-profile-server')!
    callHook(serverPlugin.configureServer, {})
    ;(globalThis as any).__svelte_devtools_record_load('/', '/r/+page.ts', 'universal', 1.234, 10)
    const loads = await (await hubHandlers(plugins)).get('svelte-devtools:get-load-profiles')!()
    expect(loads[0]).toMatchObject({ route: '/', duration: 1.23, dataSize: 10, type: 'universal' })
  })
})

// =====================================================================
// Production no-op
// =====================================================================

function appliesToBuild(p: Plugin): boolean {
  return typeof p.apply === 'function'
    ? p.apply({}, { command: 'build', mode: 'production' } as any)
    : p.apply === undefined || p.apply === 'build'
}

describe('production build no-op', () => {
  it('every plugin is serve-only (absent from vite build)', () => {
    expect(
      svelteDevtools()
        .filter(appliesToBuild)
        .map(p => p.name),
    ).toEqual([])
  })
})
