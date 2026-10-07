import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionState } from './rpc.js'

// A fake devframe client: only what rpc.ts touches.
type Status = 'connecting' | 'connected' | 'unauthorized' | 'disconnected' | 'error'
function fakeClient(status: Status = 'connected', meta: Record<string, unknown> = {}) {
  const handlers: ((s: Status) => void)[] = []
  const call = vi.fn((_method: string, ..._args: unknown[]): Promise<unknown> =>
    Promise.resolve('ok'),
  )
  const c = {
    status,
    connectionMeta: meta,
    connectionError: undefined as Error | undefined,
    events: {
      on: (_: 'connection:status', h: (s: Status) => void) => {
        handlers.push(h)
        return () => {}
      },
    },
    scope: vi.fn((_ns: string) => ({ rpc: { call } })),
    close: vi.fn(),
    requestAuthCode: vi.fn((_options?: { reissue?: boolean }) => Promise.resolve()),
    requestTrustWithCode: vi.fn((_code: string) => Promise.resolve(true)),
    /** Simulate a status event from devframe. */
    emit(s: Status, error?: string) {
      c.status = s
      c.connectionError = error ? new Error(error) : undefined
      for (const h of handlers) h(s)
    },
    call,
  }
  return c
}
type Fake = ReturnType<typeof fakeClient>

/** A `call` that rejects `method` with `reason` (also non-Errors) and answers anything else. */
function failing(method: string, reason: unknown) {
  return (m: string): Promise<unknown> =>
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the reason is the test input
    m === method ? Promise.reject(reason) : Promise.resolve()
}

const connectDevframe = vi.hoisted(() => vi.fn<() => Promise<unknown>>())
vi.mock('devframe/client', () => ({ connectDevframe }))

// rpc.ts reads `document` once at load; each test gets a fresh module.
const listeners = { visibilitychange: [] as (() => void)[], pagehide: [] as (() => void)[] }
const doc = {
  visibilityState: 'visible' as 'visible' | 'hidden',
  addEventListener: (type: 'visibilitychange', cb: () => void) => listeners[type].push(cb),
}

async function load({ withDocument = true } = {}) {
  vi.resetModules()
  listeners.visibilitychange = []
  listeners.pagehide = []
  if (withDocument) {
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', {
      addEventListener: (type: 'pagehide', cb: () => void) => listeners[type].push(cb),
    })
  }
  return import('./rpc.js')
}

/** Let promise chains settle without advancing time. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  connectDevframe.mockReset()
  doc.visibilityState = 'visible'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('connection state', () => {
  it('starts "connecting" with an unknown host, and connecting is lazy', async () => {
    const rpc = await load()
    expect(rpc.getConnectionState()).toEqual({ status: 'connecting', host: 'unknown' })
    expect(connectDevframe).not.toHaveBeenCalled()
  })

  it.each([
    [{}, 'standalone'],
    [{ configs: {} }, 'vite-devtools'],
  ] as const)('subscribing connects and reports the host (meta %j → %s)', async (meta, host) => {
    connectDevframe.mockResolvedValue(fakeClient('connected', meta))
    const rpc = await load()
    const seen: ConnectionState[] = []
    rpc.onConnectionState(s => {
      seen.push(s)
    })
    await settle()
    expect(seen.map(s => s.status)).toEqual(['connecting', 'connecting', 'connected'])
    expect(seen.at(-1)!.host).toBe(host)
    expect(connectDevframe).toHaveBeenCalledWith({ simpleAuth: false })
  })

  it('reports "unauthorized" from devframe and stops notifying after unsubscribe', async () => {
    const c = fakeClient('unauthorized')
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    const cb = vi.fn<(s: ConnectionState) => void>()
    const off = rpc.onConnectionState(cb)
    await settle()
    expect(rpc.getConnectionState().status).toBe('unauthorized')
    off()
    cb.mockClear()
    c.emit('connected')
    expect(cb).not.toHaveBeenCalled()
    expect(rpc.getConnectionState().status).toBe('connected')
  })

  it('concurrent first calls share one connection', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await Promise.all([rpc.getProject(), rpc.getRoutes(), rpc.getAssets()])
    expect(connectDevframe).toHaveBeenCalledTimes(1)
    expect(c.scope).toHaveBeenCalledWith('svelte-devtools')
  })
})

describe('calls', () => {
  it('maps an RPC failure to "RPC <method> failed: <reason>" keeping the cause', async () => {
    const c = fakeClient()
    const boom = new Error('boom')
    // (The activity lease also goes through `call`.)
    c.call.mockImplementation(failing('get-project', boom))
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await expect(rpc.getProject()).rejects.toMatchObject({
      message: 'RPC get-project failed: boom',
      cause: boom,
    })
  })

  it('maps a non-Error rejection too', async () => {
    const c = fakeClient()
    c.call.mockImplementation(failing('get-routes', 'nope'))
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await expect(rpc.getRoutes()).rejects.toThrow('RPC get-routes failed: nope')
  })

  it('maps a connection failure, reports it, and dials again with exponential backoff', async () => {
    connectDevframe.mockRejectedValue(new Error('ECONNREFUSED'))
    const rpc = await load()
    await expect(rpc.getProject()).rejects.toThrow('RPC get-project failed: ECONNREFUSED')
    expect(rpc.getConnectionState()).toMatchObject({ status: 'error', error: 'ECONNREFUSED' })
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      const before = connectDevframe.mock.calls.length
      let waited = 0
      while (connectDevframe.mock.calls.length === before) {
        await vi.advanceTimersByTimeAsync(100)
        waited += 100
      }
      delays.push(waited)
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000])
  })

  it('failures while a redial is pending do not stack timers (one redial, backoff advances once)', async () => {
    connectDevframe.mockRejectedValue(new Error('down'))
    const rpc = await load()
    await rpc.getProject().catch(() => {})
    await rpc.getRoutes().catch(() => {})
    await rpc.getAssets().catch(() => {})
    expect(connectDevframe).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(500)
    expect(connectDevframe).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(999)
    expect(connectDevframe).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(connectDevframe).toHaveBeenCalledTimes(5)
  })

  it('a client without connection meta is standalone', async () => {
    const c = fakeClient()
    ;(c as { connectionMeta?: unknown }).connectionMeta = undefined
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await rpc.getProject()
    expect(rpc.getConnectionState().host).toBe('standalone')
  })

  it('a non-Error connection failure is reported as text', async () => {
    connectDevframe.mockRejectedValue('offline')
    const rpc = await load()
    await expect(rpc.getProject()).rejects.toThrow('RPC get-project failed: offline')
    expect(rpc.getConnectionState()).toMatchObject({ status: 'error', error: 'offline' })
  })

  it('a successful reconnect resets the backoff and clears the error', async () => {
    connectDevframe.mockRejectedValueOnce(new Error('down'))
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await rpc.getProject().catch(() => {})
    await vi.advanceTimersByTimeAsync(500)
    expect(rpc.getConnectionState()).toEqual({
      status: 'connected',
      host: 'standalone',
      error: undefined,
    })
    // The socket drops: the client is discarded and redialled after the minimum delay.
    const c2 = fakeClient()
    connectDevframe.mockResolvedValue(c2)
    c.emit('connected')
    c.emit('disconnected', 'closed')
    expect(c.close).toHaveBeenCalled()
    expect(rpc.getConnectionState()).toMatchObject({ status: 'disconnected', error: 'closed' })
    await vi.advanceTimersByTimeAsync(499)
    expect(connectDevframe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(connectDevframe).toHaveBeenCalledTimes(3)
    await rpc.getProject()
    expect(c2.call).toHaveBeenCalledWith('get-project')
  })

  it('ignores status events from a client it already discarded', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await rpc.getProject()
    c.emit('error', 'bad')
    expect(rpc.getConnectionState()).toMatchObject({ status: 'error', error: 'bad' })
    connectDevframe.mockResolvedValue(fakeClient())
    await vi.advanceTimersByTimeAsync(500)
    expect(rpc.getConnectionState().status).toBe('connected')
    c.emit('disconnected')
    expect(rpc.getConnectionState().status).toBe('connected')
  })

  it('discarding tolerates a client whose close() throws', async () => {
    const c = fakeClient()
    c.close.mockImplementation(() => {
      throw new Error('already closed')
    })
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await rpc.getProject()
    expect(() => c.emit('disconnected')).not.toThrow()
  })

  type Rpc = Awaited<ReturnType<typeof load>>
  it.each<[string, (rpc: Rpc) => Promise<unknown>, unknown[]]>([
    [
      'openInEditor with a line',
      r => r.openInEditor('a.svelte', 12),
      ['open-in-editor', { file: 'a.svelte', line: 12 }],
    ],
    [
      'openInEditor drops line 0',
      r => r.openInEditor('a.svelte', 0),
      ['open-in-editor', { file: 'a.svelte', line: undefined }],
    ],
    [
      'openInEditor drops a negative line',
      r => r.openInEditor('a.svelte', -3),
      ['open-in-editor', { file: 'a.svelte', line: undefined }],
    ],
    [
      'openReactiveInEditor',
      r => r.openReactiveInEditor('a.svelte', 'n', 'state'),
      ['open-reactive-in-editor', { file: 'a.svelte', name: 'n', type: 'state' }],
    ],
    ['getReactiveGraph()', r => r.getReactiveGraph(), ['get-reactive-graph']],
    [
      'getReactiveGraph(req)',
      r => r.getReactiveGraph({ componentId: 1 }),
      ['get-reactive-graph', { componentId: 1 }],
    ],
    ['getReactiveSummary()', r => r.getReactiveSummary(), ['get-reactive-summary']],
    [
      'getReactiveSummary(req)',
      r => r.getReactiveSummary({ topK: 3 }),
      ['get-reactive-summary', { topK: 3 }],
    ],
    [
      'getStateTimelineDelta',
      r => r.getStateTimelineDelta(7),
      ['get-state-timeline-delta', { since: 7 }],
    ],
    [
      'sendApiRequest',
      r => r.sendApiRequest('/api', 'POST', '{}', 'b'),
      ['send-api-request', { url: '/api', method: 'POST', headers: '{}', body: 'b' }],
    ],
    ['inspectFile', r => r.inspectFile('x.svelte'), ['inspect-file', { file: 'x.svelte' }]],
    ['getOGPreview', r => r.getOGPreview('/p'), ['get-og-preview', { url: '/p' }]],
  ])('%s sends the right method and arguments', async (_, run, expected) => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await run(rpc)
    expect(c.call).toHaveBeenLastCalledWith(...expected)
  })

  it('every no-argument getter / clear calls its kebab-case method', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    const pairs: [() => Promise<unknown>, string][] = [
      [rpc.getProject, 'get-project'],
      [rpc.getRoutes, 'get-routes'],
      [rpc.getAssets, 'get-assets'],
      [rpc.getComponentRelations, 'get-component-relations'],
      [rpc.getLiveComponents, 'get-live-components'],
      [rpc.getLiveComponentsMeta, 'get-live-components-meta'],
      [rpc.getCaptureInfo, 'get-capture-info'],
      [rpc.getRenderProfiles, 'get-render-profiles'],
      [rpc.getLoadProfiles, 'get-load-profiles'],
      [rpc.clearLoadProfiles, 'clear-load-profiles'],
      [rpc.getStateTimeline, 'get-state-timeline'],
      [rpc.getVersions, 'get-versions'],
      [rpc.clearStateTimeline, 'clear-state-timeline'],
      [rpc.getApiEndpoints, 'get-api-endpoints'],
      [rpc.getCompilerWarnings, 'get-compiler-warnings'],
      [rpc.getRuntimeErrors, 'get-runtime-errors'],
      [rpc.clearErrors, 'clear-errors'],
      [rpc.getSvelteFiles, 'get-svelte-files'],
      [rpc.getModuleGraph, 'get-module-graph'],
      [rpc.getBuildAnalysis, 'get-build-analysis'],
      [rpc.getFps, 'get-fps'],
      [rpc.clearFps, 'clear-fps'],
    ]
    for (const [fn, method] of pairs) {
      await fn()
      expect(c.call).toHaveBeenLastCalledWith(method)
    }
  })
})

describe('auth', () => {
  it('asks devframe to print the current code, rotating it only on request', async () => {
    const c = fakeClient('unauthorized')
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await rpc.requestAuthCode()
    expect(c.requestAuthCode).toHaveBeenLastCalledWith({})
    // "Print a new code": devframe prints each code only once.
    await rpc.requestAuthCode({ reissue: true })
    expect(c.requestAuthCode).toHaveBeenLastCalledWith({ reissue: true })
    await rpc.requestAuthCode({ reissue: false })
    expect(c.requestAuthCode).toHaveBeenLastCalledWith({})
  })

  it('trims the typed code before exchanging it and returns the verdict', async () => {
    const c = fakeClient('unauthorized')
    c.requestTrustWithCode.mockResolvedValueOnce(false)
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    await expect(rpc.submitAuthCode(' 123456 \n')).resolves.toBe(false)
    expect(c.requestTrustWithCode).toHaveBeenLastCalledWith('123456')
  })
})

/** Arguments of every `set-active` (activity lease) call. */
const leaseCalls = (c: Fake) =>
  c.call.mock.calls
    .filter(([m]) => m === 'set-active')
    .map(([, a]) => a as { client: string; active: boolean })
const setActive = (c: Fake) => leaseCalls(c).map(a => a.active)

describe('activity lease (heartbeat)', () => {
  it('holds a lease while connected and visible, renewing every 5 s under one client id', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    rpc.onConnectionState(() => {})
    await settle()
    expect(setActive(c)).toEqual([true])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(setActive(c)).toEqual([true, true, true, true])
    expect(new Set(leaseCalls(c).map(a => a.client)).size).toBe(1)
  })

  it('releases the lease when the tab is hidden and takes it again when visible', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    rpc.onConnectionState(() => {})
    await settle()
    doc.visibilityState = 'hidden'
    for (const l of listeners.visibilitychange) l()
    expect(setActive(c)).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(setActive(c)).toEqual([true, false])
    doc.visibilityState = 'visible'
    for (const l of listeners.visibilitychange) l()
    expect(setActive(c)).toEqual([true, false, true])
  })

  it('releases the lease on pagehide', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    rpc.onConnectionState(() => {})
    await settle()
    for (const l of listeners.pagehide) l()
    expect(setActive(c)).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setActive(c)).toEqual([true, false])
  })

  it('pagehide without a lease sends nothing', async () => {
    const c = fakeClient('unauthorized')
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    rpc.onConnectionState(() => {})
    await settle()
    for (const l of listeners.pagehide) l()
    expect(setActive(c)).toEqual([])
  })

  it('takes no lease while unauthorized, and swallows a failing set-active', async () => {
    const c = fakeClient('unauthorized')
    c.call.mockRejectedValue(new Error('no'))
    connectDevframe.mockResolvedValue(c)
    const rpc = await load()
    rpc.onConnectionState(() => {})
    await settle()
    expect(setActive(c)).toEqual([])
    c.emit('connected')
    await settle()
    expect(setActive(c)).toEqual([true])
  })

  it('without a document (unit tests, workers) never takes a lease', async () => {
    const c = fakeClient()
    connectDevframe.mockResolvedValue(c)
    const rpc = await load({ withDocument: false })
    rpc.onConnectionState(() => {})
    await settle()
    expect(setActive(c)).toEqual([])
  })
})
