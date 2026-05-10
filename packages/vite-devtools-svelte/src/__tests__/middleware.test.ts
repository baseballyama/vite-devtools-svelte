import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'
import { svelteDevtools } from '../plugin.js'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import path from 'node:path'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')

// =====================================================================
// Mock HTTP request/response helpers
// =====================================================================

// Token captured per setupPluginsWithServer() call so that mock requests
// can pass the auth check the production code now enforces.
let currentTestToken = ''

function createMockReq(
  opts: { method?: string; url?: string; body?: string; headers?: Record<string, string> } = {},
) {
  const req = new EventEmitter() as any
  req.method = opts.method || 'GET'
  req.url = opts.url || '/'
  // Default to a same-origin browser request with the captured token plus
  // application/json so the auth middleware accepts the request. Tests that
  // want to exercise auth failures pass `headers: {}` explicitly.
  const defaultHeaders: Record<string, string> = {
    origin: 'http://localhost:5173',
    'content-type': 'application/json',
    'x-svelte-devtools-token': currentTestToken,
  }
  req.headers = { ...defaultHeaders, ...opts.headers }
  // Simulate body streaming
  if (opts.body !== undefined) {
    setTimeout(() => {
      req.emit('data', Buffer.from(opts.body!))
      req.emit('end')
    }, 0)
  }
  return req
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    ended: false,
    piped: false,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value
    },
    end(data?: string) {
      if (data) this.body = data
      this.ended = true
    },
    pipe: null as any,
  }
  return res
}

// =====================================================================
// Middleware Registration
// =====================================================================

function setupPluginsWithServer() {
  const plugins = svelteDevtools()
  const middlewares: Array<{ path: string; handler: Function }> = []
  const hotListeners: Record<string, Function> = {}

  const mockServer = {
    hot: {
      on: (event: string, handler: Function) => {
        hotListeners[event] = handler
      },
      send: vi.fn(),
    },
    middlewares: {
      use: (...args: any[]) => {
        if (typeof args[0] === 'string') {
          middlewares.push({ path: args[0], handler: args[1] })
        } else {
          middlewares.push({ path: '', handler: args[0] })
        }
      },
    },
    environments: {},
    transformRequest: vi.fn(),
  }

  for (const plugin of plugins) {
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
      } as any)
    }
  }

  for (const plugin of plugins) {
    if (typeof plugin.configureServer === 'function') {
      plugin.configureServer(mockServer as any)
    }
  }

  // Read the per-process auth token through the main plugin's `api`. This
  // is the same channel inter-plugin code would use; tests don't need a
  // production-only flag.
  const mainPlugin = plugins[0]
  const token =
    (mainPlugin.api as { getDevtoolsToken?: () => string } | undefined)?.getDevtoolsToken?.() ?? ''
  currentTestToken = token

  return { plugins, middlewares, hotListeners, mockServer, token }
}

// =====================================================================
// RPC Fallback Endpoint Tests
// =====================================================================

describe('RPC fallback endpoint', () => {
  let rpcMiddleware: Function

  beforeEach(() => {
    const { middlewares } = setupPluginsWithServer()
    const rpc = middlewares.find(m => m.path === '/__svelte-devtools/rpc')
    if (!rpc) throw new Error('RPC middleware not registered')
    rpcMiddleware = rpc.handler
  })

  it('should reject non-POST requests', () => {
    const req = createMockReq({ method: 'GET' })
    const res = createMockRes()
    rpcMiddleware(req, res)
    expect(res.statusCode).toBe(405)
    expect(res.body).toBe('Method not allowed')
  })

  it('should handle valid RPC request for get-project', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:get-project', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    expect(res.headers['content-type']).toBe('application/json')
    const parsed = JSON.parse(res.body)
    expect(parsed.name).toBe('test-fixture')
  })

  it('should handle valid RPC request for get-routes', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:get-routes', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    const parsed = JSON.parse(res.body)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })

  it('should handle valid RPC request for get-assets', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:get-assets', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    const parsed = JSON.parse(res.body)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })

  it('should return error for unknown RPC method', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:nonexistent', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    expect(res.statusCode).toBe(500)
    const parsed = JSON.parse(res.body)
    expect(parsed.error).toContain('Unknown RPC method')
  })

  it('should return error for malformed JSON', async () => {
    const req = createMockReq({
      method: 'POST',
      body: 'not json',
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    expect(res.statusCode).toBe(500)
  })

  it('should handle get-live-components returning empty array', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:get-live-components', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    const parsed = JSON.parse(res.body)
    expect(parsed).toEqual([])
  })

  it('should handle get-api-endpoints', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:get-api-endpoints', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    const parsed = JSON.parse(res.body)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })

  it('should handle get-svelte-files', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:get-svelte-files', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    const parsed = JSON.parse(res.body)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty('file')
    expect(parsed[0]).toHaveProperty('name')
  })

  it('should handle clear-load-profiles', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:clear-load-profiles', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    expect(res.statusCode).toBe(200)
  })

  it('should handle clear-errors', async () => {
    const req = createMockReq({
      method: 'POST',
      body: JSON.stringify({ method: 'svelte-devtools:clear-errors', args: [] }),
    })
    const res = createMockRes()
    rpcMiddleware(req, res)

    await vi.waitFor(() => {
      expect(res.ended).toBe(true)
    })
    expect(res.statusCode).toBe(200)
  })
})

// =====================================================================
// Asset Serving Middleware Tests
// =====================================================================

describe('asset serving middleware', () => {
  let assetMiddleware: Function

  beforeEach(() => {
    const { middlewares } = setupPluginsWithServer()
    const asset = middlewares.find(m => m.path === '/__svelte-devtools/asset')
    if (!asset) throw new Error('asset middleware not registered')
    assetMiddleware = asset.handler
  })

  it('should return 400 if path parameter is missing', () => {
    const req = createMockReq({ url: '/' })
    const res = createMockRes()
    assetMiddleware(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Missing path parameter')
  })

  it('should serve files from static directory', () => {
    const faviconPath = path.join(FIXTURES_DIR, 'static', 'favicon.png')
    const req = createMockReq({ url: `/?path=${encodeURIComponent(faviconPath)}` })
    // Use a real Writable stream so pipe() works
    const chunks: Buffer[] = []
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk)
        cb()
      },
    }) as any
    res.statusCode = 200
    res.headers = {} as Record<string, string>
    res.setHeader = (key: string, value: string) => {
      res.headers[key.toLowerCase()] = value
    }
    assetMiddleware(req, res)
    // Should set Content-Type for png
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.statusCode).not.toBe(403)
    expect(res.statusCode).not.toBe(404)
  })

  it('should return 403 for path traversal attempts', () => {
    // Try to access a file outside the static directory
    const traversalPath = path.join(FIXTURES_DIR, 'package.json')
    const req = createMockReq({ url: `/?path=${encodeURIComponent(traversalPath)}` })
    const res = createMockRes()
    assetMiddleware(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body).toBe('Forbidden')
  })

  it('should return 404 when path resolves to a directory (not a file)', () => {
    // static/ itself is a directory, not a file
    const staticDirPath = path.join(FIXTURES_DIR, 'static')
    const req = createMockReq({ url: `/?path=${encodeURIComponent(staticDirPath)}` })
    const res = createMockRes()
    assetMiddleware(req, res)
    // staticDir itself should fail isFile() check or fall through to 404
    expect(res.statusCode).toBe(404)
  })

  it('should return 404 for nonexistent files', () => {
    const missingPath = path.join(FIXTURES_DIR, 'static', 'nonexistent.png')
    const req = createMockReq({ url: `/?path=${encodeURIComponent(missingPath)}` })
    const res = createMockRes()
    assetMiddleware(req, res)
    expect(res.statusCode).toBe(404)
    expect(res.body).toBe('Not found')
  })
})

// =====================================================================
// Client UI Serving Middleware Tests
// =====================================================================

describe('client UI serving middleware', () => {
  it('should register /.svelte-devtools middleware', () => {
    const { middlewares } = setupPluginsWithServer()
    const clientMw = middlewares.find(m => m.path === '/.svelte-devtools')
    expect(clientMw).toBeDefined()
  })

  it('should call next() for nonexistent files', () => {
    const { middlewares } = setupPluginsWithServer()
    const clientMw = middlewares.find(m => m.path === '/.svelte-devtools')!
    const req = createMockReq({ url: '/nonexistent-file.xyz' })
    const res = createMockRes()
    let nextCalled = false
    clientMw.handler(req, res, () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })
})

// =====================================================================
// HMR Event Listeners
// =====================================================================

describe('HMR event listeners', () => {
  it('should register component listener', () => {
    const { hotListeners } = setupPluginsWithServer()
    expect(hotListeners['svelte-devtools:components']).toBeDefined()
  })

  it('should register profiles listener', () => {
    const { hotListeners } = setupPluginsWithServer()
    expect(hotListeners['svelte-devtools:profiles']).toBeDefined()
  })

  it('should register state-timeline listener', () => {
    const { hotListeners } = setupPluginsWithServer()
    expect(hotListeners['svelte-devtools:state-timeline']).toBeDefined()
  })

  it('should register runtime-error listener', () => {
    const { hotListeners } = setupPluginsWithServer()
    expect(hotListeners['svelte-devtools:runtime-error']).toBeDefined()
  })

  it('should register reactive-graph listener', () => {
    const { hotListeners } = setupPluginsWithServer()
    expect(hotListeners['svelte-devtools:reactive-graph']).toBeDefined()
  })

  it('should update live components when data received', async () => {
    const { hotListeners, plugins } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    // Get RPC handlers
    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const mockComponents = [
      { id: 0, file: '/test/Counter.svelte', name: 'Counter', parentId: null, mounted: true },
    ]
    hotListeners['svelte-devtools:components']({ components: mockComponents })

    const result = await rpcHandlers.get('svelte-devtools:get-live-components')!()
    expect(result).toEqual(mockComponents)
  })

  it('should update render profiles when data received', async () => {
    const { hotListeners, plugins } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const mockProfiles = [
      {
        componentId: 0,
        file: '/test/Counter.svelte',
        name: 'Counter',
        initTime: 5,
        renderCount: 3,
        totalRenderTime: 15,
        lastRenderTime: 5,
        lastRenderAt: Date.now(),
      },
    ]
    hotListeners['svelte-devtools:profiles']({ profiles: mockProfiles })

    const result = await rpcHandlers.get('svelte-devtools:get-render-profiles')!()
    expect(result).toEqual(mockProfiles)
  })

  it('should buffer runtime errors (max 200)', async () => {
    const { hotListeners, plugins } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    // Push 210 errors
    for (let i = 0; i < 210; i++) {
      hotListeners['svelte-devtools:runtime-error']({
        message: `Error ${i}`,
        timestamp: Date.now(),
      })
    }

    const result = (await rpcHandlers.get('svelte-devtools:get-runtime-errors')!()) as any[]
    expect(result.length).toBeLessThanOrEqual(200)
    // Should keep the latest errors
    expect(result[result.length - 1].message).toBe('Error 209')
  })

  it('should resolve reactive graph requests from HMR', async () => {
    const { hotListeners, plugins } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    // Start a reactive graph request - the handler will send a request to the client and wait
    const graphPromise = rpcHandlers.get('svelte-devtools:get-reactive-graph')!()

    // Simulate the client responding with reactive graph data
    const mockGraph = {
      nodes: [{ id: '0:count', type: 'state', name: 'count', componentId: 0, componentFile: '' }],
      edges: [],
    }
    hotListeners['svelte-devtools:reactive-graph'](mockGraph)

    const result = await graphPromise
    expect(result).toEqual(mockGraph)
  })

  it('should resolve state timeline requests from HMR', async () => {
    const { hotListeners, plugins } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const timelinePromise = rpcHandlers.get('svelte-devtools:get-state-timeline')!()

    const mockTimeline = [
      {
        id: '0:count',
        name: 'count',
        componentFile: '',
        oldValue: 0,
        newValue: 1,
        timestamp: Date.now(),
      },
    ]
    hotListeners['svelte-devtools:state-timeline']({ changes: mockTimeline })

    const result = await timelinePromise
    expect(result).toEqual(mockTimeline)
  })

  it('should send clear-state-timeline to client', async () => {
    const { plugins, mockServer } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    await rpcHandlers.get('svelte-devtools:clear-state-timeline')!()
    expect(mockServer.hot.send).toHaveBeenCalledWith('svelte-devtools:clear-state-timeline', {})
  })
})

// =====================================================================
// Inspect File with Server
// =====================================================================

describe('inspect-file with server', () => {
  it('should return source and compiled code for valid file', async () => {
    const { plugins, mockServer } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    // Mock transformRequest to return compiled code
    mockServer.transformRequest.mockResolvedValue({
      code: 'const compiled = true;',
      map: { mappings: 'AAAA', sources: ['Counter.svelte'] },
    })

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!(
      'src/lib/components/Counter.svelte',
    )) as any
    expect(result.source).toContain('$state')
    expect(result.compiled).toBe('const compiled = true;')
    expect(result.mappings).toBe('AAAA')
    expect(result.sources).toEqual(['Counter.svelte'])
  })

  it('should handle transform failure gracefully', async () => {
    const { plugins, mockServer } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    mockServer.transformRequest.mockRejectedValue(new Error('Transform error'))

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!(
      'src/lib/components/Counter.svelte',
    )) as any
    expect(result.source).toContain('$state')
    expect(result.compiled).toBe('// Transform failed')
  })

  it('should handle source map as string', async () => {
    const { plugins, mockServer } = setupPluginsWithServer()
    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!

    mockServer.transformRequest.mockResolvedValue({
      code: 'compiled',
      map: JSON.stringify({ mappings: 'BBBB', sources: ['test.svelte'] }),
    })

    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!(
      'src/lib/components/Counter.svelte',
    )) as any
    expect(result.mappings).toBe('BBBB')
    expect(result.sources).toEqual(['test.svelte'])
  })
})

// =====================================================================
// Module Graph with Server
// =====================================================================

describe('module graph with server', () => {
  it('should build module graph from Vite 8 environment moduleGraph', async () => {
    const plugins = svelteDevtools()
    const middlewares: any[] = []
    const hotListeners: Record<string, Function> = {}

    // Create a module map simulating Vite 8's environment-based moduleGraph
    const mockModule1 = {
      file: path.join(FIXTURES_DIR, 'src/lib/components/Counter.svelte'),
      importedModules: new Set(),
    }
    const mockModule2 = {
      file: path.join(FIXTURES_DIR, 'src/routes/+page.svelte'),
      importedModules: new Set([mockModule1]),
    }
    const idToModuleMap = new Map()
    idToModuleMap.set('counter', mockModule1)
    idToModuleMap.set('page', mockModule2)

    const mockServer = {
      hot: {
        on: (event: string, handler: Function) => {
          hotListeners[event] = handler
        },
        send: vi.fn(),
      },
      middlewares: { use: (...args: any[]) => middlewares.push(args) },
      environments: {
        client: {
          moduleGraph: { idToModuleMap },
        },
      },
      transformRequest: vi.fn(),
    }

    for (const plugin of plugins) {
      if (typeof plugin.configResolved === 'function') {
        plugin.configResolved({
          command: 'serve',
          root: FIXTURES_DIR,
          logger: { warn: () => {} },
        } as any)
      }
    }
    for (const plugin of plugins) {
      if (typeof plugin.configureServer === 'function') {
        plugin.configureServer(mockServer as any)
      }
    }

    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:get-module-graph')!()) as any
    expect(result.modules.length).toBe(2)

    const counterModule = result.modules.find((m: any) => m.id.includes('Counter'))
    expect(counterModule).toBeDefined()
    expect(counterModule.type).toBe('svelte')

    const pageModule = result.modules.find((m: any) => m.id.includes('+page'))
    expect(pageModule).toBeDefined()
    expect(pageModule.type).toBe('svelte')

    // Page should import Counter
    expect(pageModule.imports).toContain(counterModule.id)
    // Counter should be imported by Page
    expect(counterModule.importedBy).toContain(pageModule.id)
  })

  it('should detect cycles in module graph', async () => {
    const plugins = svelteDevtools()
    const middlewares: any[] = []
    const hotListeners: Record<string, Function> = {}

    // Create a circular dependency: A -> B -> C -> A
    const moduleA: any = { file: path.join(FIXTURES_DIR, 'src/a.ts'), importedModules: new Set() }
    const moduleB: any = { file: path.join(FIXTURES_DIR, 'src/b.ts'), importedModules: new Set() }
    const moduleC: any = { file: path.join(FIXTURES_DIR, 'src/c.ts'), importedModules: new Set() }
    moduleA.importedModules.add(moduleB)
    moduleB.importedModules.add(moduleC)
    moduleC.importedModules.add(moduleA)

    const idToModuleMap = new Map()
    idToModuleMap.set('a', moduleA)
    idToModuleMap.set('b', moduleB)
    idToModuleMap.set('c', moduleC)

    // Create the files so statSync works
    const fs = await import('node:fs')
    const srcDir = path.join(FIXTURES_DIR, 'src')
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      const filePath = path.join(srcDir, name)
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `// ${name}`)
      }
    }

    const mockServer = {
      hot: {
        on: (event: string, handler: Function) => {
          hotListeners[event] = handler
        },
        send: vi.fn(),
      },
      middlewares: { use: (...args: any[]) => middlewares.push(args) },
      environments: {
        client: { moduleGraph: { idToModuleMap } },
      },
      transformRequest: vi.fn(),
    }

    for (const plugin of plugins) {
      if (typeof plugin.configResolved === 'function') {
        plugin.configResolved({
          command: 'serve',
          root: FIXTURES_DIR,
          logger: { warn: () => {} },
        } as any)
      }
    }
    for (const plugin of plugins) {
      if (typeof plugin.configureServer === 'function') {
        plugin.configureServer(mockServer as any)
      }
    }

    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:get-module-graph')!()) as any
    expect(result.modules.length).toBe(3)
    expect(result.cycles.length).toBeGreaterThan(0)

    // All modules should be marked as cyclic
    for (const mod of result.modules) {
      expect(mod.isCyclic).toBe(true)
    }

    // Cleanup
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      try {
        fs.unlinkSync(path.join(srcDir, name))
      } catch {}
    }
  })

  it('should fallback to legacy moduleGraph when environments are empty', async () => {
    const plugins = svelteDevtools()
    const hotListeners: Record<string, Function> = {}

    const moduleLegacy = {
      file: path.join(FIXTURES_DIR, 'src/routes/+page.svelte'),
      importedModules: new Set(),
    }
    const legacyIdToModuleMap = new Map()
    legacyIdToModuleMap.set('legacy', moduleLegacy)

    const mockServer = {
      hot: {
        on: (e: string, h: Function) => {
          hotListeners[e] = h
        },
        send: vi.fn(),
      },
      middlewares: { use: () => {} },
      // No environments (or empty environments)
      environments: {},
      // Legacy moduleGraph at server level
      moduleGraph: { idToModuleMap: legacyIdToModuleMap },
      transformRequest: vi.fn(),
    }

    for (const p of plugins) {
      if (typeof p.configResolved === 'function')
        p.configResolved({
          command: 'serve',
          root: FIXTURES_DIR,
          logger: { warn: () => {} },
        } as any)
    }
    for (const p of plugins) {
      if (typeof p.configureServer === 'function') p.configureServer(mockServer as any)
    }

    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:get-module-graph')!()) as any
    expect(result.modules.length).toBe(1)
    expect(result.modules[0].type).toBe('svelte')
  })

  it('should exclude node_modules from module graph', async () => {
    const plugins = svelteDevtools()
    const hotListeners: Record<string, Function> = {}

    const moduleNM = {
      file: path.join(FIXTURES_DIR, 'node_modules/svelte/index.js'),
      importedModules: new Set(),
    }
    const moduleApp = {
      file: path.join(FIXTURES_DIR, 'src/routes/+page.svelte'),
      importedModules: new Set(),
    }

    const idToModuleMap = new Map()
    idToModuleMap.set('nm', moduleNM)
    idToModuleMap.set('app', moduleApp)

    const mockServer = {
      hot: {
        on: (e: string, h: Function) => {
          hotListeners[e] = h
        },
        send: vi.fn(),
      },
      middlewares: { use: () => {} },
      environments: { client: { moduleGraph: { idToModuleMap } } },
      transformRequest: vi.fn(),
    }

    for (const p of plugins) {
      if (typeof p.configResolved === 'function')
        p.configResolved({
          command: 'serve',
          root: FIXTURES_DIR,
          logger: { warn: () => {} },
        } as any)
    }
    for (const p of plugins) {
      if (typeof p.configureServer === 'function') p.configureServer(mockServer as any)
    }

    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:get-module-graph')!()) as any
    const nmModule = result.modules.find((m: any) => m.file?.includes('node_modules'))
    expect(nmModule).toBeUndefined()
  })

  it('should classify module types correctly', async () => {
    const plugins = svelteDevtools()
    const hotListeners: Record<string, Function> = {}

    const fs = await import('node:fs')
    // Create test files
    for (const name of ['test.js', 'test.css']) {
      const filePath = path.join(FIXTURES_DIR, 'src', name)
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `/* ${name} */`)
    }

    const moduleSvelte = {
      file: path.join(FIXTURES_DIR, 'src/routes/+page.svelte'),
      importedModules: new Set(),
    }
    const moduleTS = {
      file: path.join(FIXTURES_DIR, 'src/routes/api/hello/+server.ts'),
      importedModules: new Set(),
    }
    const moduleJS = { file: path.join(FIXTURES_DIR, 'src/test.js'), importedModules: new Set() }
    const moduleCSS = { file: path.join(FIXTURES_DIR, 'src/test.css'), importedModules: new Set() }

    const idToModuleMap = new Map()
    idToModuleMap.set('svelte', moduleSvelte)
    idToModuleMap.set('ts', moduleTS)
    idToModuleMap.set('js', moduleJS)
    idToModuleMap.set('css', moduleCSS)

    const mockServer = {
      hot: {
        on: (e: string, h: Function) => {
          hotListeners[e] = h
        },
        send: vi.fn(),
      },
      middlewares: { use: () => {} },
      environments: { client: { moduleGraph: { idToModuleMap } } },
      transformRequest: vi.fn(),
    }

    for (const p of plugins) {
      if (typeof p.configResolved === 'function')
        p.configResolved({
          command: 'serve',
          root: FIXTURES_DIR,
          logger: { warn: () => {} },
        } as any)
    }
    for (const p of plugins) {
      if (typeof p.configureServer === 'function') p.configureServer(mockServer as any)
    }

    const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
    let rpcHandlers = new Map<string, Function>()
    mainPlugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)

    const result = (await rpcHandlers.get('svelte-devtools:get-module-graph')!()) as any
    const svelteModule = result.modules.find((m: any) => m.id.endsWith('.svelte'))
    const tsModule = result.modules.find((m: any) => m.id.endsWith('.ts'))
    const jsModule = result.modules.find((m: any) => m.id.endsWith('.js'))
    const cssModule = result.modules.find((m: any) => m.id.endsWith('.css'))

    expect(svelteModule?.type).toBe('svelte')
    expect(tsModule?.type).toBe('ts')
    expect(jsModule?.type).toBe('js')
    expect(cssModule?.type).toBe('css')

    // Cleanup
    for (const name of ['test.js', 'test.css']) {
      try {
        fs.unlinkSync(path.join(FIXTURES_DIR, 'src', name))
      } catch {}
    }
  })
})
