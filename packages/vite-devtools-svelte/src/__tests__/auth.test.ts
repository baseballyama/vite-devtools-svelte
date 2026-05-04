import { describe, it, expect, beforeEach, vi } from 'vite-plus/test'
import { svelteDevtools } from '../plugin.js'
import { EventEmitter } from 'node:events'
import path from 'node:path'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')

// =====================================================================
// Helpers — like middleware.test.ts but exposing token + raw header control
// =====================================================================

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    ended: false,
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

function createMockReq(opts: {
  method?: string
  url?: string
  body?: string
  headers?: Record<string, string>
} = {}) {
  const req = new EventEmitter() as any
  req.method = opts.method || 'POST'
  req.url = opts.url || '/'
  req.headers = opts.headers ?? {}
  if (opts.body !== undefined) {
    setTimeout(() => {
      req.emit('data', Buffer.from(opts.body!))
      req.emit('end')
    }, 0)
  }
  return req
}

interface SetupResult {
  rpc: Function
  asset: Function
  clientUi: Function
  token: string
}

function setup(): SetupResult {
  const plugins = svelteDevtools()
  const middlewares: Array<{ path: string; handler: Function }> = []
  const mockServer = {
    hot: { on: () => {}, send: vi.fn() },
    middlewares: {
      use: (...args: any[]) => {
        if (typeof args[0] === 'string') middlewares.push({ path: args[0], handler: args[1] })
      },
    },
    environments: {},
    transformRequest: vi.fn(),
    config: { server: { port: 5173 } },
  }

  for (const plugin of plugins) {
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
        server: { port: 5173 },
      } as any)
    }
  }
  for (const plugin of plugins) {
    if (typeof plugin.configureServer === 'function') {
      plugin.configureServer(mockServer as any)
    }
  }

  const rpc = middlewares.find((m) => m.path === '/__svelte-devtools/rpc')!.handler
  const asset = middlewares.find((m) => m.path === '/__svelte-devtools/asset')!.handler
  const clientUi = middlewares.find((m) => m.path === '/.svelte-devtools')!.handler

  const mainPlugin = plugins[0]
  const token =
    (mainPlugin.api as { getDevtoolsToken?: () => string } | undefined)?.getDevtoolsToken?.() ?? ''

  return { rpc, asset, clientUi, token }
}

const okBody = JSON.stringify({ method: 'svelte-devtools:get-project', args: [] })

// =====================================================================
// RPC auth — 403 / 415 / 413 / token / Origin / Referer cases
// =====================================================================

describe('RPC fallback auth', () => {
  let s: SetupResult

  beforeEach(() => {
    s = setup()
  })

  it('rejects request with no Origin and no token (403)', () => {
    const req = createMockReq({
      headers: { 'content-type': 'application/json' },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects request with cross-origin Origin even with valid token (403)', () => {
    const req = createMockReq({
      headers: {
        origin: 'https://attacker.example.com',
        'content-type': 'application/json',
        'x-svelte-devtools-token': s.token,
      },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects request with same-origin Origin but missing token (403)', () => {
    const req = createMockReq({
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects request with same-origin Origin but wrong token (403)', () => {
    const req = createMockReq({
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
        'x-svelte-devtools-token': 'not-the-real-token',
      },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('accepts request with valid Origin + valid token + JSON', async () => {
    const req = createMockReq({
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
        'x-svelte-devtools-token': s.token,
      },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    await vi.waitFor(() => expect(res.ended).toBe(true))
    expect(res.statusCode).toBe(200)
  })

  it('accepts when Referer (not Origin) carries the same-origin signal', async () => {
    const req = createMockReq({
      headers: {
        referer: 'http://localhost:5173/__svelte-devtools/',
        'content-type': 'application/json',
        'x-svelte-devtools-token': s.token,
      },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    await vi.waitFor(() => expect(res.ended).toBe(true))
    expect(res.statusCode).toBe(200)
  })

  it('rejects non-JSON content type (415)', () => {
    const req = createMockReq({
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'text/plain',
        'x-svelte-devtools-token': s.token,
      },
      body: okBody,
    })
    const res = createMockRes()
    s.rpc(req, res)
    expect(res.statusCode).toBe(415)
  })

  it('rejects body larger than 1MB (413)', async () => {
    const big = 'x'.repeat(1_500_000)
    const req = createMockReq({
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
        'x-svelte-devtools-token': s.token,
      },
      body: big,
    })
    const res = createMockRes()
    s.rpc(req, res)
    await vi.waitFor(() => expect(res.ended).toBe(true))
    expect(res.statusCode).toBe(413)
  })
})

// =====================================================================
// Asset endpoint auth
// =====================================================================

describe('asset middleware auth', () => {
  let s: SetupResult

  beforeEach(() => {
    s = setup()
  })

  it('rejects asset request without token (403)', () => {
    const req = createMockReq({ method: 'GET', url: '/?path=foo' })
    const res = createMockRes()
    s.asset(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects asset request with cross-origin Origin (403)', () => {
    const req = createMockReq({
      method: 'GET',
      url: '/?path=foo',
      headers: { origin: 'https://attacker.example.com', 'x-svelte-devtools-token': s.token },
    })
    const res = createMockRes()
    s.asset(req, res)
    expect(res.statusCode).toBe(403)
  })
})

// =====================================================================
// Path validation — `inspect-file` / `open-in-editor` / `open-reactive-in-editor`
// =====================================================================

describe('inspect-file path sandbox', () => {
  let rpcHandlers: Map<string, Function>

  beforeEach(() => {
    const plugins = svelteDevtools()
    const plugin = plugins.find((p) => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
      } as any)
    }
    rpcHandlers = new Map()
    plugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)
  })

  it('returns empty source when given an absolute path outside the project root', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!('/etc/passwd')) as any
    expect(result.source).toBe('')
    expect(result.compiled).toBe('')
  })

  it('returns empty source when given a traversal-style relative path', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!('../../../etc/passwd')) as any
    expect(result.source).toBe('')
  })

  it('returns content for a legitimate path within the project root', async () => {
    const result = (await rpcHandlers.get('svelte-devtools:inspect-file')!(
      'src/lib/components/Counter.svelte',
    )) as any
    expect(result.source).toContain('$state')
  })
})

describe('open-in-editor path sandbox', () => {
  let rpcHandlers: Map<string, Function>

  beforeEach(() => {
    const plugins = svelteDevtools()
    const plugin = plugins.find((p) => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
      } as any)
    }
    rpcHandlers = new Map()
    plugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)
  })

  it('throws when given a path outside the project root', async () => {
    await expect(
      rpcHandlers.get('svelte-devtools:open-in-editor')!('/etc/passwd'),
    ).rejects.toThrow(/Forbidden|File not found/)
  })

  it('throws when given a non-existent file', async () => {
    await expect(
      rpcHandlers.get('svelte-devtools:open-in-editor')!('does-not-exist.svelte'),
    ).rejects.toThrow(/File not found/)
  })
})

describe('open-reactive-in-editor path sandbox', () => {
  let rpcHandlers: Map<string, Function>

  beforeEach(() => {
    const plugins = svelteDevtools()
    const plugin = plugins.find((p) => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
      } as any)
    }
    rpcHandlers = new Map()
    plugin.devtools!.setup({
      views: { hostStatic: () => {} },
      docks: { register: () => {} },
      rpc: {
        register: ({ name, handler }: { name: string; handler: Function }) =>
          rpcHandlers.set(name, handler),
      },
    } as any)
  })

  it('throws when given a path outside the project root', async () => {
    await expect(
      rpcHandlers.get('svelte-devtools:open-reactive-in-editor')!('/etc/passwd', 'foo', 'state'),
    ).rejects.toThrow(/Forbidden|File not found/)
  })
})

// =====================================================================
// dev-only resolveId / load gates
// =====================================================================

describe('dev-only virtual module gates', () => {
  it('does not resolve runtime virtual modules during build', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find((p) => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      // command: 'build' — production build should skip our virtual modules
      plugin.configResolved({
        command: 'build',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
      } as any)
    }
    const resolveId = plugin.resolveId as Function
    const load = plugin.load as Function
    expect(resolveId.call(plugin, 'virtual:svelte-devtools-runtime', '/some/file.ts')).toBeUndefined()
    expect(load.call(plugin, '\0virtual:svelte-devtools-runtime')).toBeUndefined()
    expect(load.call(plugin, '\0svelte-devtools:wrapped-client')).toBeUndefined()
  })

  it('does resolve runtime virtual modules during dev', () => {
    const plugins = svelteDevtools()
    const plugin = plugins.find((p) => p.name === 'vite-devtools-svelte')!
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: FIXTURES_DIR,
        logger: { warn: () => {} },
      } as any)
    }
    const resolveId = plugin.resolveId as Function
    const load = plugin.load as Function
    expect(resolveId.call(plugin, 'virtual:svelte-devtools-runtime', '/some/file.ts')).toBe(
      '\0virtual:svelte-devtools-runtime',
    )
    expect(typeof load.call(plugin, '\0virtual:svelte-devtools-runtime')).toBe('string')
    expect(typeof load.call(plugin, '\0svelte-devtools:wrapped-client')).toBe('string')
  })
})
