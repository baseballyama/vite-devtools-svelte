// The MCP endpoint the plugin mounts on the dev server
// (`/__svelte-devtools/mcp`): token gate, consumer lease, error handling, and
// the `claude mcp add` hint printed once the server listens.
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import type { Plugin } from 'vite'
import { afterEach, describe, it, expect, vi } from 'vitest'

import * as mcpServerModule from '../src/mcp/server.js'
import { isValidMcpToken, svelteDevtools } from '../src/plugin.js'
import { callHook, resolvePlugins } from './helpers.js'

vi.mock('../src/mcp/server.js', async importOriginal => {
  const real = await importOriginal<typeof mcpServerModule>()
  return { ...real, buildMcpServer: vi.fn(real.buildMcpServer) }
})

const FIXTURES = new URL('fixtures', import.meta.url).pathname
const MCP_PATH = '/__svelte-devtools/mcp'
const SUBSCRIPTION = 'svelte-devtools:subscription'

type Handler = (req: unknown, res: unknown) => void

/** A dev server double: hot channel, middleware stack, logger, http server events. */
function setup(serverConfig: Record<string, unknown> = {}) {
  const plugins: Plugin[] = svelteDevtools()
  // Hosted by the Vite DevTools hub: no standalone devframe mount, so the
  // MCP endpoint is the only middleware.
  resolvePlugins(plugins, { root: FIXTURES, plugins: [{ name: 'vite:devtools' }] })
  const listeners = new Map<string, (payload: unknown, client?: unknown) => void>()
  const routes: Array<[string, Handler]> = []
  // an unlistened http.Server: the plugin only reads its events and address
  const httpServer = Object.assign(http.createServer(), {
    address: (): AddressInfo | string | null => null,
  })
  const server = {
    hot: {
      on: (event: string, fn: (payload: unknown) => void) => listeners.set(event, fn),
      off: vi.fn(),
      send: vi.fn(),
    },
    middlewares: { use: (path: string, fn: Handler) => routes.push([path, fn]) },
    httpServer,
    config: { server: serverConfig, logger: { info: vi.fn(), error: vi.fn() } },
    environments: {},
  }
  callHook(plugins[0]!.configureServer, server)
  const [path, handler] = routes.find(([p]) => p === MCP_PATH) ?? []
  expect(path).toBe(MCP_PATH)
  const token = (plugins[0]!.api as { getDevtoolsToken: () => string }).getDevtoolsToken()
  return {
    server,
    httpServer,
    handler: handler!,
    token,
    subscriptions: () => server.hot.send.mock.calls.filter(([event]) => event === SUBSCRIPTION),
    /** The runtime's activation snapshot ends with a `reset: true` timeline. */
    sendSnapshot: () =>
      listeners.get('svelte-devtools:state-timeline')!({ epoch: 'e1', reset: true, changes: [] }),
  }
}

function fakeResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    },
    end: vi.fn(),
  }
}

describe('isValidMcpToken', () => {
  const token = '123e4567-e89b-12d3-a456-426614174000'
  it.each([
    ['the exact token', token, true],
    ['no header', undefined, false],
    ['an empty header', '', false],
    ['another token of the same length', token.replace('1', '9'), false],
    ['a prefix', token.slice(0, -1), false],
    ['the token plus a suffix', `${token}0`, false],
    ['the token twice (repeated header, joined)', `${token}, ${token}`, false],
    ['a repeated header (array)', [token], false],
    ['a multibyte string of the same UTF-16 length', 'é'.repeat(token.length), false],
  ])('%s → %s', (_, header, expected) => {
    expect(isValidMcpToken(header, token)).toBe(expected)
  })
})

describe('MCP endpoint token gate', () => {
  it('generates a fresh random token per plugin instance', () => {
    expect(setup().token).toMatch(/^[0-9a-f-]{36}$/)
    expect(setup().token).not.toBe(setup().token)
  })

  it.each([
    ['a missing token', () => null],
    ['a wrong token', () => 'not-the-token'],
    ['the token as a repeated header (array)', (t: string) => [t, t]],
    ['a case-changed token', (t: string) => t.toUpperCase()],
  ])('403s %s without touching the runtime', (_, header) => {
    const s = setup()
    const res = fakeResponse()
    s.handler({ headers: { 'x-svelte-devtools-token': header(s.token) } }, res)
    expect(res.statusCode).toBe(403)
    expect(res.end).toHaveBeenCalledWith('Forbidden')
    // no consumer lease: the runtime is not woken up for an unauthenticated caller
    expect(s.subscriptions()).toEqual([])
    expect(vi.mocked(mcpServerModule.buildMcpServer)).not.toHaveBeenCalled()
  })
})

/** The next MCP server built fails to connect with `reason`; returns its `close` spy. */
function failingServer(reason: unknown = new Error('boom')) {
  const close = vi.fn(async () => {})
  vi.mocked(mcpServerModule.buildMcpServer).mockImplementationOnce(
    () =>
      ({
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is a case under test
        connect: () => Promise.reject(reason),
        close,
      }) as never,
  )
  return close
}

describe('MCP endpoint errors', () => {
  afterEach(() => {
    vi.mocked(mcpServerModule.buildMcpServer).mockClear()
  })

  it.each([
    ['an Error', new Error('boom'), 'Error: boom'],
    ['a non-Error value', 'plain failure', 'plain failure'],
  ])(
    'answers 500 JSON when the handler throws %s, logs it, closes the server',
    async (_, reason, text) => {
      const close = failingServer(reason)
      const s = setup()
      const res = fakeResponse()
      s.handler({ headers: { 'x-svelte-devtools-token': s.token } }, res)
      s.sendSnapshot()
      await vi.waitFor(() => expect(res.end).toHaveBeenCalled())
      expect(res.statusCode).toBe(500)
      expect(res.headers['content-type']).toBe('application/json')
      expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toEqual({ error: text })
      expect(s.server.config.logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`[svelte-devtools] MCP handler error: ${text}`),
      )
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    },
  )

  it('answers 500 (never hangs) when building the MCP server throws', async () => {
    vi.mocked(mcpServerModule.buildMcpServer).mockImplementationOnce(() => {
      throw new Error('factory failed')
    })
    const s = setup()
    const res = fakeResponse()
    s.handler({ headers: { 'x-svelte-devtools-token': s.token } }, res)
    s.sendSnapshot()
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce())
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toEqual({
      error: 'Error: factory failed',
    })
    expect(s.server.config.logger.error).toHaveBeenCalledWith(
      '[svelte-devtools] MCP handler error: Error: factory failed',
    )
  })

  it('does not write a second response when headers were already sent', async () => {
    failingServer()
    const s = setup()
    const res = { ...fakeResponse(), headersSent: true }
    s.handler({ headers: { 'x-svelte-devtools-token': s.token } }, res)
    s.sendSnapshot()
    await vi.waitFor(() => expect(s.server.config.logger.error).toHaveBeenCalled())
    expect(res.end).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })
})

/** An MCP `initialize` request carrying `token`. */
const initialize = (url: string, token: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-svelte-devtools-token': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    }),
  })

describe('MCP endpoint over HTTP', () => {
  const servers: http.Server[] = []
  afterEach(async () => {
    for (const srv of servers.splice(0)) {
      await new Promise<void>(resolve => {
        srv.close(() => resolve())
      })
    }
  })

  async function listen(handler: Handler): Promise<string> {
    const srv = http.createServer((req, res) => handler(req, res))
    servers.push(srv)
    await new Promise<void>(resolve => {
      srv.listen(0, '127.0.0.1', resolve)
    })
    return `http://127.0.0.1:${(srv.address() as AddressInfo).port}${MCP_PATH}`
  }

  it('serves MCP with the token; the first call leases the runtime and awaits its snapshot', async () => {
    const s = setup()
    const url = await listen(s.handler)
    let snapshotSent = false
    const first = initialize(url, s.token).then(res => {
      expect(snapshotSent).toBe(true)
      return res
    })
    // the request activated the runtime (consumer lease) ...
    await vi.waitFor(() =>
      expect(s.subscriptions()).toEqual([[SUBSCRIPTION, { active: true, componentDeltas: true }]]),
    )
    // ... and is held until the activation snapshot arrives
    for (let i = 0; i < 5; i++) {
      await new Promise<void>(resolve => {
        setImmediate(resolve)
      })
    }
    snapshotSent = true
    s.sendSnapshot()
    const res = await first
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { serverInfo: { name: string } } }
    expect(body.result.serverInfo.name).toBeTruthy()

    // already leased: a second call is answered without waiting for a snapshot
    const second = await initialize(url, s.token)
    expect(second.status).toBe(200)
    expect(s.subscriptions()).toHaveLength(1)
  })

  it('a malformed MCP message is answered by the transport and logged', async () => {
    const s = setup()
    const url = await listen(s.handler)
    const pending = fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-svelte-devtools-token': s.token,
      },
      body: '{not json',
    })
    await vi.waitFor(() => expect(s.subscriptions()).toHaveLength(1))
    s.sendSnapshot()
    const res = await pending
    expect(res.status).toBe(400)
    expect(s.server.config.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[svelte-devtools] MCP transport error:'),
    )
  })

  it('a duplicated token header (joined by Node) is rejected', async () => {
    const s = setup()
    const url = await listen(s.handler)
    const res = await fetch(url, {
      method: 'POST',
      headers: [
        ['x-svelte-devtools-token', s.token],
        ['x-svelte-devtools-token', s.token],
      ],
      body: '{}',
    })
    expect(res.status).toBe(403)
  })
})

describe('MCP registration hint', () => {
  it.each([
    ['IPv6 wildcard', { address: '::', family: 'IPv6' }, {}, 'http://localhost:5173'],
    ['IPv4 wildcard', { address: '0.0.0.0', family: 'IPv4' }, {}, 'http://localhost:5173'],
    ['IPv6 loopback', { address: '::1', family: 'IPv6' }, {}, 'http://localhost:5173'],
    ['IPv4 loopback', { address: '127.0.0.1', family: 'IPv4' }, {}, 'http://localhost:5173'],
    ['a LAN IPv4', { address: '192.168.1.20', family: 'IPv4' }, {}, 'http://192.168.1.20:5173'],
    ['a LAN IPv6', { address: 'fe80::1', family: 'IPv6' }, {}, 'http://[fe80::1]:5173'],
    ['https', { address: '::', family: 'IPv6' }, { https: {} }, 'https://localhost:5173'],
  ])('%s binding → %s', (_, addr, serverConfig, origin) => {
    const s = setup(serverConfig)
    s.httpServer.address = () => ({ ...addr, port: 5173 })
    s.httpServer.emit('listening')
    const lines = s.server.config.logger.info.mock.calls.map(([line]) => String(line).trim())
    expect(lines).toContain(
      `claude mcp add --transport http svelte ${origin}${MCP_PATH} --header x-svelte-devtools-token:${s.token}`,
    )
  })

  it.each([
    ['a pipe / socket path', '/tmp/vite.sock'],
    ['no address', null],
  ])('prints nothing for %s', (_, address) => {
    const s = setup()
    s.httpServer.address = () => address
    s.httpServer.emit('listening')
    expect(s.server.config.logger.info).not.toHaveBeenCalled()
  })
})
