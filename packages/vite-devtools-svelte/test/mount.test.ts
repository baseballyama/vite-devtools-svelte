// Standalone devframe mount on the Vite dev server (src/server/mount.ts):
// WebSocket origin allowlist per binding, readiness gate, and lifecycle.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'

import { afterEach, describe, it, expect, vi } from 'vitest'

import { mountStandalone } from '../src/server/mount.js'

const initiate = vi.hoisted(() => ({
  initDevframe: vi.fn((_def: unknown, _options: unknown) => ({
    nodeMiddleware: vi.fn(),
    close: vi.fn(async () => {}),
  })),
}))
vi.mock('devframe/initiate', () => initiate)

type Middleware = (req: { url?: string }, res: unknown, next: () => unknown) => void

function fakeServer(opts: { http?: boolean; https?: boolean } = {}) {
  const httpServer =
    opts.http === false
      ? null
      : // an unlistened http.Server: mount only reads its events and address
        Object.assign(http.createServer(), {
          address: (): AddressInfo | string | null => null,
        })
  const stack: Middleware[] = []
  const info = vi.fn()
  const server = {
    httpServer,
    middlewares: { use: (fn: Middleware) => stack.push(fn) },
    config: { server: { https: opts.https ? {} : undefined }, logger: { info } },
  }
  return { server, httpServer, stack, info }
}

const DEF = { id: 'svelte-devtools' } as never
const lastOptions = () =>
  initiate.initDevframe.mock.calls.at(-1)![1] as { allowedOrigins: string[]; origin: string }
const lastInstance = () => initiate.initDevframe.mock.results.at(-1)!.value

function listenAt(address: string, family: string, https = false) {
  const f = fakeServer({ https })
  mountStandalone(f.server as never, DEF)
  f.httpServer!.address = () => ({ address, family, port: 5173 })
  f.httpServer!.emit('listening')
  return f
}

const INTERFACES = {
  lo0: [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
    { address: '::1', family: 'IPv6', internal: true },
  ],
  en0: [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: 'fe80::1c2b:3d4e', family: 'IPv6', internal: false },
  ],
  utun3: undefined,
} as unknown as ReturnType<typeof os.networkInterfaces>

afterEach(() => {
  vi.restoreAllMocks()
  initiate.initDevframe.mockClear()
})

describe('allowed WebSocket origins by binding (server.host)', () => {
  it.each([
    ['localhost (IPv4 loopback)', '127.0.0.1', 'IPv4', false, []],
    ['localhost (IPv6 loopback)', '::1', 'IPv6', false, []],
    ['a single LAN IPv4', '192.168.1.20', 'IPv4', false, ['http://192.168.1.20:5173']],
    ['a single IPv6', 'fe80::1c2b:3d4e', 'IPv6', false, ['http://[fe80::1c2b:3d4e]:5173']],
    ['a single LAN IPv4 over https', '10.0.0.2', 'IPv4', true, ['https://10.0.0.2:5173']],
    [
      'IPv4 wildcard (0.0.0.0): every external interface',
      '0.0.0.0',
      'IPv4',
      false,
      ['http://192.168.1.20:5173', 'http://[fe80::1c2b:3d4e]:5173'],
    ],
    [
      'IPv6 wildcard (::): every external interface',
      '::',
      'IPv6',
      true,
      ['https://192.168.1.20:5173', 'https://[fe80::1c2b:3d4e]:5173'],
    ],
  ])('%s', (_, address, family, https, expected) => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(INTERFACES)
    listenAt(address, family, https)
    expect(lastOptions().allowedOrigins).toEqual(expected)
  })

  it('the auth link and the logged URL point at the SPA on localhost', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(INTERFACES)
    const f = listenAt('0.0.0.0', 'IPv4', true)
    expect(lastOptions().origin).toBe('https://localhost:5173/.svelte-devtools/')
    expect(f.info).toHaveBeenCalledWith(
      expect.stringContaining('https://localhost:5173/.svelte-devtools/'),
    )
  })
})

const res = () => ({ statusCode: 200, end: vi.fn() })

describe('mount lifecycle', () => {
  it('answers 503 for the DevTools base until listening, then hands requests to devframe', () => {
    const f = fakeServer()
    expect(mountStandalone(f.server as never, DEF)).toBeUndefined()
    const [mw] = f.stack
    const next = vi.fn()
    const early = res()
    mw!({ url: '/.svelte-devtools/' }, early, next)
    expect(early.statusCode).toBe(503)
    mw!({ url: '/app' }, res(), next)
    expect(next).toHaveBeenCalledOnce()

    f.httpServer!.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 1 })
    f.httpServer!.emit('listening')
    const instance = lastInstance()
    const req = { url: '/.svelte-devtools/' }
    mw!(req, early, next)
    expect(instance.nodeMiddleware).toHaveBeenCalledWith(req, early, next)
  })

  it('closes the instance with its own server, and serves 503 again afterwards', () => {
    const f = listenAt('127.0.0.1', 'IPv4')
    const instance = lastInstance()
    f.httpServer!.emit('close')
    expect(instance.close).toHaveBeenCalledOnce()
    const after = res()
    f.stack[0]!({ url: '/.svelte-devtools/' }, after, vi.fn())
    expect(after.statusCode).toBe(503)
  })

  it('a failing instance close on server close is swallowed', async () => {
    const f = listenAt('127.0.0.1', 'IPv4')
    const instance = lastInstance()
    let rejected = false
    instance.close.mockImplementationOnce(() => {
      rejected = true
      return Promise.reject(new Error('already closed'))
    })
    f.httpServer!.emit('close')
    await Promise.resolve()
    expect(rejected).toBe(true) // and no unhandled rejection fails the run
  })

  it('a server closed before it listened never creates an instance', () => {
    const f = fakeServer()
    mountStandalone(f.server as never, DEF)
    f.httpServer!.emit('close')
    f.httpServer!.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 1 })
    f.httpServer!.emit('listening')
    expect(initiate.initDevframe).not.toHaveBeenCalled()
  })

  it.each([
    ['a pipe', '/tmp/vite.sock'],
    ['no address', null],
  ])('listening on %s creates no instance', (_, address) => {
    const f = fakeServer()
    mountStandalone(f.server as never, DEF)
    f.httpServer!.address = () => address
    f.httpServer!.emit('listening')
    expect(initiate.initDevframe).not.toHaveBeenCalled()
  })

  it('middleware mode: SSE through the same middleware, disposed by the caller', async () => {
    const f = fakeServer({ http: false })
    const dispose = mountStandalone(f.server as never, DEF)!
    expect(lastOptions()).toMatchObject({ ws: false, sse: true, mcp: false })
    const instance = lastInstance()
    const next = vi.fn()
    f.stack[0]!({ url: '/.svelte-devtools/' }, res(), next)
    expect(instance.nodeMiddleware).toHaveBeenCalledOnce()
    await dispose()
    expect(instance.close).toHaveBeenCalledOnce()
    const after = res()
    f.stack[0]!({ url: '/.svelte-devtools/' }, after, next)
    expect(after.statusCode).toBe(503)
  })

  it('middleware mode: a failing close does not reject dispose', async () => {
    const f = fakeServer({ http: false })
    const dispose = mountStandalone(f.server as never, DEF)!
    lastInstance().close.mockRejectedValueOnce(new Error('already closed'))
    await expect(dispose()).resolves.toBeUndefined()
  })
})

function listenWith(options?: { auth?: boolean }) {
  const f = fakeServer()
  mountStandalone(f.server as never, DEF, options)
  f.httpServer!.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 5173 })
  f.httpServer!.emit('listening')
}
const lastAuth = () => (initiate.initDevframe.mock.calls.at(-1)![1] as { auth?: unknown }).auth

describe('client auth (the one-time code gate)', () => {
  it.each([
    [undefined, true],
    [{}, true],
    [{ auth: true }, true],
    [{ auth: false }, false],
  ])('%j → auth %s on the shared HTTP server', (options, expected) => {
    listenWith(options)
    expect(lastAuth()).toBe(expected)
  })

  it.each([
    [undefined, true],
    [{ auth: false }, false],
  ])('%j → auth %s in middleware mode', (options, expected) => {
    const f = fakeServer({ http: false })
    mountStandalone(f.server as never, DEF, options)
    expect(lastAuth()).toBe(expected)
  })
})
