import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { svelteDevtools } from '../plugin.js'
import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from '../runtime.js'
import type { Plugin } from 'vite'

// =====================================================================
// Plugin Factory: svelteDevtools()
// =====================================================================

describe('svelteDevtools factory', () => {
  it('should return an array of 5 plugins', () => {
    const plugins = svelteDevtools()
    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBe(5)
  })

  it('should return plugins with correct names', () => {
    const plugins = svelteDevtools()
    const names = plugins.map(p => p.name)
    expect(names).toContain('vite-devtools-svelte')
    expect(names).toContain('vite-devtools-svelte:tracking')
    expect(names).toContain('vite-devtools-svelte:load-profile')
    expect(names).toContain('vite-devtools-svelte:load-profile-server')
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
    for (const p of plugins) {
      if (typeof p.configResolved === 'function') {
        p.configResolved({ command: 'serve', root: '/test', logger: { warn: () => {} } } as any)
      }
    }
    const trackingPlugin = plugins.find(p => p.name === 'vite-devtools-svelte:tracking')!
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = (trackingPlugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    expect(result).not.toBeNull()
  })
})

// =====================================================================
// Virtual Module Resolution (runtime + wrapper)
// =====================================================================

describe('mainPlugin virtual module resolution', () => {
  function getMainPlugin(): Plugin {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({ command: 'serve', root: '/test', logger: { warn: () => {} } } as any)
    }
    return plugin
  }

  // Runtime virtual module
  it('should resolve the runtime virtual module ID', () => {
    const plugin = getMainPlugin()
    const resolved = (plugin.resolveId as Function)!(RUNTIME_MODULE_ID)
    expect(resolved).toBe(RESOLVED_RUNTIME_ID)
  })

  it('should load the runtime code for the resolved ID', () => {
    const plugin = getMainPlugin()
    const loaded = (plugin.load as Function)!(RESOLVED_RUNTIME_ID)
    expect(loaded).toBe(runtimeCode)
  })

  // svelte/internal/client wrapper
  it('should intercept svelte/internal/client from user code', () => {
    const plugin = getMainPlugin()
    const resolved = (plugin.resolveId as Function)!(
      'svelte/internal/client',
      '/test/src/lib/Counter.svelte',
    )
    expect(resolved).toBe(WRAPPER_MODULE_ID)
  })

  it('should NOT intercept svelte/internal/client from node_modules', () => {
    const plugin = getMainPlugin()
    const resolved = (plugin.resolveId as Function)!(
      'svelte/internal/client',
      '/test/node_modules/svelte/src/index.js',
    )
    expect(resolved).toBeUndefined()
  })

  it('should NOT intercept svelte/internal/client from virtual modules (\\0 prefix)', () => {
    const plugin = getMainPlugin()
    const resolved = (plugin.resolveId as Function)!(
      'svelte/internal/client',
      '\0svelte-devtools:wrapped-client',
    )
    expect(resolved).toBeUndefined()
  })

  it('should NOT intercept svelte/internal/client without importer', () => {
    const plugin = getMainPlugin()
    const resolved = (plugin.resolveId as Function)!('svelte/internal/client')
    expect(resolved).toBeUndefined()
  })

  it('should NOT intercept svelte/internal/client in build mode', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({ command: 'build', root: '/test', logger: { warn: () => {} } } as any)
    }
    const resolved = (plugin.resolveId as Function)!(
      'svelte/internal/client',
      '/test/src/lib/Counter.svelte',
    )
    expect(resolved).toBeUndefined()
  })

  it('should NOT intercept svelte/internal/client when componentTracking is disabled', () => {
    const plugins = svelteDevtools({ componentTracking: false })
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({ command: 'serve', root: '/test', logger: { warn: () => {} } } as any)
    }
    const resolved = (plugin.resolveId as Function)!(
      'svelte/internal/client',
      '/test/src/lib/Counter.svelte',
    )
    expect(resolved).toBeUndefined()
  })

  it('should load the wrapper code for the wrapper module ID', () => {
    const plugin = getMainPlugin()
    const loaded = (plugin.load as Function)!(WRAPPER_MODULE_ID)
    expect(loaded).toBe(wrapperCode)
  })

  it('should return undefined for other module IDs', () => {
    const plugin = getMainPlugin()
    expect((plugin.resolveId as Function)!('some-other-module')).toBeUndefined()
    expect((plugin.load as Function)!('some-other-id')).toBeUndefined()
  })
})

// =====================================================================
// HTML Injection (transformIndexHtml)
// =====================================================================

describe('mainPlugin transformIndexHtml', () => {
  it('should inject runtime script in serve mode', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({ command: 'serve', root: '/test', logger: { warn: () => {} } } as any)
    }
    const result = (plugin.transformIndexHtml as Function)!()
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
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({ command: 'build', root: '/test', logger: { warn: () => {} } } as any)
    }
    const result = (plugin.transformIndexHtml as Function)!()
    expect(result).toEqual([])
  })
})

// =====================================================================
// DevTools setup hook
// =====================================================================

describe('mainPlugin devtools setup', () => {
  it('should have devtools.setup function', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    expect(plugin.devtools).toBeDefined()
    expect(typeof plugin.devtools!.setup).toBe('function')
  })

  it('should register devtools dock and RPC handlers', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({ command: 'serve', root: '/test', logger: { warn: () => {} } } as any)
    }

    const registeredRpc: Array<{ name: string; handler: Function }> = []
    const registeredDocks: any[] = []
    const hostedPaths: string[] = []

    const mockCtx = {
      views: { hostStatic: (path: string, _dir: string) => hostedPaths.push(path) },
      docks: { register: (dock: any) => registeredDocks.push(dock) },
      rpc: { register: (entry: any) => registeredRpc.push(entry) },
    }

    plugin.devtools!.setup(mockCtx as any)

    expect(registeredDocks.length).toBe(1)
    expect(registeredDocks[0].id).toBe('svelte-devtools')
    expect(hostedPaths).toContain('/.svelte-devtools/')

    const rpcNames = registeredRpc.map(r => r.name)
    expect(rpcNames).toContain('svelte-devtools:get-project')
    expect(rpcNames).toContain('svelte-devtools:get-routes')
    expect(rpcNames).toContain('svelte-devtools:get-assets')
    expect(rpcNames).toContain('svelte-devtools:get-component-relations')
    expect(rpcNames).toContain('svelte-devtools:get-live-components')
    expect(rpcNames).toContain('svelte-devtools:get-render-profiles')
    expect(rpcNames).toContain('svelte-devtools:get-reactive-graph')
    expect(rpcNames).toContain('svelte-devtools:get-load-profiles')
    expect(rpcNames).toContain('svelte-devtools:get-state-timeline')
    expect(rpcNames).toContain('svelte-devtools:get-api-endpoints')
    expect(rpcNames).toContain('svelte-devtools:send-api-request')
    expect(rpcNames).toContain('svelte-devtools:get-module-graph')
    expect(rpcNames).toContain('svelte-devtools:get-og-preview')
    expect(rpcNames).toContain('svelte-devtools:get-build-analysis')
  })
})

// =====================================================================
// RPC Handler Integration Tests
// =====================================================================

describe('RPC handlers (via devtools.setup)', () => {
  let rpcHandlers: Map<string, Function>

  beforeEach(() => {
    const plugins = svelteDevtools()
    const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    const fixturesDir = new URL('fixtures', import.meta.url).pathname
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: fixturesDir,
        logger: { warn: () => {} },
      } as any)
    }

    rpcHandlers = new Map()
    const mockCtx = {
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    }
    plugin.devtools!.setup(mockCtx as any)
  })

  it('get-project should return project info', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:get-project')!()) as any
    expect(result.name).toBe('test-fixture')
  })

  it('get-routes should return route info', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:get-routes')!()) as any[]
    expect(result.length).toBeGreaterThan(0)
  })

  it('get-assets should return asset info', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:get-assets')!()) as any[]
    expect(result.length).toBeGreaterThan(0)
  })

  it('get-component-relations should return component relations', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:get-component-relations')!()) as any[]
    expect(result.find((c: any) => c.name === 'Counter')).toBeDefined()
  })

  it('get-live-components should return empty array initially', async () => {
    expect(await rpcHandlers.get('svelte-devtools:get-live-components')!()).toEqual([])
  })

  it('get-module-graph should return empty graph without server', async () => {
    expect(await rpcHandlers.get('svelte-devtools:get-module-graph')!()).toEqual({
      modules: [],
      cycles: [],
    })
  })

  it('get-build-analysis should handle missing build dir', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:get-build-analysis')!()) as any
    expect(result.chunks).toEqual([])
    expect(result.totalSize).toBe(0)
  })

  it('get-api-endpoints should detect HTTP methods', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:get-api-endpoints')!()) as any[]
    const usersEndpoint = result.find((e: any) => e.path.includes('users'))
    expect(usersEndpoint).toBeDefined()
    expect(usersEndpoint.methods).toContain('GET')
    expect(usersEndpoint.methods).toContain('POST')
    expect(usersEndpoint.methods).toContain('DELETE')
  })

  it('send-api-request should reject SSRF attempts', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:send-api-request')!(
      'http://169.254.169.254/metadata',
      'GET',
      '{}',
      '',
    )) as any
    expect(result.status).toBe(0)
    expect(result.statusText).toContain('Blocked')
  })

  it('inspect-file should return source for existing file', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!(
      'src/lib/components/Counter.svelte',
    )) as any
    expect(result.source).toContain('$state')
  })

  it('inspect-file should handle nonexistent file gracefully', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!(
      'nonexistent.svelte',
    )) as any
    expect(result.source).toBe('')
  })
})

// =====================================================================
// Warning Capture Plugin
// =====================================================================

describe('warningCapturePlugin', () => {
  it('should intercept Svelte compiler warnings', async () => {
    const plugins = svelteDevtools()
    const warningPlugin = plugins.find(p => p.name === 'vite-devtools-svelte:warning-capture')!
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    let capturedWarnings: string[] = []
    const mockConfig = {
      command: 'serve',
      root: '/test',
      logger: { warn: (msg: string) => capturedWarnings.push(msg) },
    }

    if (typeof mainPlugin.configResolved === 'function')
      mainPlugin.configResolved(mockConfig as any)
    if (typeof warningPlugin.configResolved === 'function')
      warningPlugin.configResolved(mockConfig as any)

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    mockConfig.logger.warn(
      '/test/src/lib/Counter.svelte:5:2 (a11y_no_redundant_roles) Warning message',
    )

    const warnings = (await rpcHandlers.get('svelte-devtools:get-compiler-warnings')!()) as any[]
    expect(warnings.length).toBe(1)
    expect(warnings[0].code).toBe('a11y_no_redundant_roles')
    expect(capturedWarnings.length).toBe(1)
  })
})

// =====================================================================
// Load Profile Server Plugin
// =====================================================================

describe('loadProfileServerPlugin', () => {
  it('should register global load recording function', () => {
    const plugins = svelteDevtools()
    const serverPlugin = plugins.find(p => p.name === 'vite-devtools-svelte:load-profile-server')!
    if (typeof serverPlugin.configureServer === 'function') {
      serverPlugin.configureServer({} as any)
    }
    expect(typeof (globalThis as any).__svelte_devtools_record_load).toBe('function')
  })
})
