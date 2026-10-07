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

const shape = (p: Plugin) => ({
  name: p.name,
  enforce: p.enforce,
  apply: typeof p.apply === 'function' ? 'fn' : p.apply,
})

describe('svelteDevtools factory', () => {
  it('returns the dev-only plugins in hook order', () => {
    // main (pre) resolves the wrapper before vite-plugin-svelte compiles;
    // the transforms (post) see compiled output.
    expect(svelteDevtools().map(shape)).toEqual([
      { name: 'vite-devtools-svelte', enforce: 'pre', apply: 'serve' },
      { name: 'vite-devtools-svelte:tracking', enforce: 'post', apply: 'serve' },
      { name: 'vite-devtools-svelte:load-profile', enforce: 'post', apply: 'serve' },
      { name: 'vite-devtools-svelte:load-profile-server', enforce: undefined, apply: 'serve' },
      { name: 'vite-devtools-svelte:warning-capture', enforce: 'post', apply: 'serve' },
      { name: 'vite-devtools-svelte:sveltekit-template-injector', enforce: 'post', apply: 'fn' },
    ])
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
  it('resolves and loads the runtime virtual module', () => {
    const plugin = getMainPlugin()
    expect(callHook(plugin.resolveId, RUNTIME_MODULE_ID)).toBe(RESOLVED_RUNTIME_ID)
    expect(callHook(plugin.load, RESOLVED_RUNTIME_ID)).toBe(runtimeCode)
    expect(callHook(plugin.load, WRAPPER_MODULE_ID)).toBe(wrapperCode)
  })

  it.each([
    ['app component', '/test/src/lib/Counter.svelte', WRAPPER_MODULE_ID],
    ['app Svelte module', '/test/src/lib/cart.svelte.ts', WRAPPER_MODULE_ID],
    ['app module with a query', '/test/src/App.svelte?direct', WRAPPER_MODULE_ID],
    ['a dependency (node_modules)', '/test/node_modules/svelte/src/index.js', null],
    ['a nested dependency', '/test/node_modules/.pnpm/x/node_modules/lib/A.svelte', null],
    // the wrapper itself imports the real module: redirecting it would loop
    ['the wrapper (virtual \\0 id)', WRAPPER_MODULE_ID, null],
    ['another virtual module', '\0virtual:other', null],
    ['no importer (entry)', undefined, null],
  ])('svelte/internal/client imported by %s → %s', (_, importer, expected) => {
    expect(callHook(getMainPlugin().resolveId, 'svelte/internal/client', importer)).toBe(expected)
  })

  it.each([
    ['svelte', '/test/src/App.svelte'],
    ['svelte/internal/server', '/test/src/App.svelte'],
    ['svelte/internal/client/index.js', '/test/src/App.svelte'],
    ['some-other-module', '/test/src/App.svelte'],
  ])('defers %s to Vite', (id, importer) => {
    expect(callHook(getMainPlugin().resolveId, id, importer)).toBeNull()
  })

  it('defers unknown ids to other loaders', () => {
    expect(callHook(getMainPlugin().load, '/test/src/App.svelte')).toBeNull()
  })

  it('does not redirect svelte/internal/client when componentTracking is disabled', () => {
    const plugins = svelteDevtools({ componentTracking: false })
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    resolvePlugins([plugin])
    expect(callHook(plugin.resolveId, 'svelte/internal/client', '/test/src/A.svelte')).toBeNull()
    // the runtime itself is still served (the dock works without tracking)
    expect(callHook(plugin.resolveId, RUNTIME_MODULE_ID)).toBe(RESOLVED_RUNTIME_ID)
  })
})

// Plugins are `apply: 'serve'`, but a hook can still be reached outside dev
// (a plugin list reused by another tool, `vite build --watch` setups): each
// hook re-checks the command and is inert during a build.
describe('build command: every hook is inert', () => {
  const plugins = svelteDevtools()
  resolvePlugins(plugins, { command: 'build' })
  const byName = (name: string) => plugins.find(p => p.name === name)!
  const main = byName('vite-devtools-svelte')

  it.each([
    ['resolveId(runtime)', () => callHook(main.resolveId, RUNTIME_MODULE_ID)],
    [
      'resolveId(svelte/internal/client)',
      () => callHook(main.resolveId, 'svelte/internal/client', '/test/src/A.svelte'),
    ],
    ['load(runtime)', () => callHook(main.load, RESOLVED_RUNTIME_ID)],
    ['load(wrapper)', () => callHook(main.load, WRAPPER_MODULE_ID)],
    [
      'tracking transform',
      () =>
        callHook(
          byName('vite-devtools-svelte:tracking').transform,
          '\t$.push($$props, true, A);',
          '/test/src/A.svelte',
        ),
    ],
    [
      'load-profile transform',
      () =>
        callHook(
          byName('vite-devtools-svelte:load-profile').transform,
          'export const load = () => ({})',
          '/test/src/routes/+page.ts',
        ),
    ],
  ])('%s → null', (_, run) => {
    expect(run()).toBeNull()
  })

  it('transformIndexHtml injects nothing', () => {
    expect((main.transformIndexHtml as { handler: () => unknown }).handler()).toEqual([])
  })

  it('compiler warnings are not captured', async () => {
    const forwarded: string[] = []
    const logger = { warn: (msg: string) => forwarded.push(msg) }
    const built = svelteDevtools()
    resolvePlugins(built, { command: 'build', logger, root: FIXTURES })
    logger.warn('/test/src/A.svelte:1:1 (x) w')
    expect(forwarded).toHaveLength(1)
    const warnings = await (
      await hubHandlers(built)
    ).get('svelte-devtools:get-compiler-warnings')!()
    expect(warnings).toEqual([])
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

  it.each([
    [{}, true],
    [{ clientAuth: false }, false],
  ])('svelteDevtools(%j) → devframe auth %s', (options, auth) => {
    const plugins = svelteDevtools(options)
    resolve(plugins)
    callHook(plugins[0]!.configureServer, middlewareServer().server)
    expect(initiate.initDevframe.mock.calls.at(-1)![1]).toMatchObject({ auth })
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

  it.each([
    [
      'path, position and code',
      '/a/src/A.svelte:5:2 (a11y_no_redundant_roles) msg',
      { file: '/a/src/A.svelte', line: 5, column: 2, code: 'a11y_no_redundant_roles' },
    ],
    [
      'ANSI colours stripped from the message',
      '\u001B[33m./src/B.svelte:1:3 (css_unused_selector) unused\u001B[39m',
      {
        file: './src/B.svelte',
        line: 1,
        code: 'css_unused_selector',
        message: './src/B.svelte:1:3 (css_unused_selector) unused',
      },
    ],
    [
      'a path without a position',
      'warning in C:/proj/src/C.svelte (x_code) text',
      { file: 'C:/proj/src/C.svelte', line: undefined, column: undefined, code: 'x_code' },
    ],
    ['no code', '/a/src/D.svelte:2:1 something odd', { file: '/a/src/D.svelte', code: 'unknown' }],
    [
      'no recognisable path',
      'Foo.svelte mentioned (a_code)',
      { file: '', line: undefined, code: 'a_code' },
    ],
  ])('parses a compiler warning with %s', async (_, msg, expected) => {
    const plugins = svelteDevtools()
    const logger = { warn: (_msg: string) => {} }
    resolve(plugins, { logger })
    logger.warn(msg)
    const warnings = await (
      await hubHandlers(plugins)
    ).get('svelte-devtools:get-compiler-warnings')!()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject(expected)
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
