import { afterEach, describe, expect, it, vi } from 'vitest'

/** Fresh module (feature detection and state are module-level) over a fake RPC layer. */
async function load(rpc: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock('./rpc.js', () => rpc)
  const mod = await import('./connection.svelte.js')
  // Same Svelte runtime as the fresh module.
  const { track } = await import('./testing.svelte.js')
  return { ...mod, track }
}

afterEach(() => {
  vi.doUnmock('./rpc.js')
})

describe('connection without a status API (older transport)', () => {
  it('reads as connected, cannot authenticate, and its actions are no-ops', async () => {
    const { connection, connectionSupported } = await load({
      getConnectionState: undefined,
      onConnectionState: undefined,
      requestAuthCode: undefined,
      submitAuthCode: undefined,
    })
    expect(connectionSupported).toBe(false)
    expect(connection.state).toEqual({ status: 'connected', host: 'unknown' })
    expect(connection.canAuth).toBe(false)
    await expect(connection.requestCode()).resolves.toBeUndefined()
    await expect(connection.submitCode('1')).resolves.toBe(false)
  })
})

/** A fake RPC layer with the devframe connection API; `emit` pushes a state. */
function fakeRpc() {
  let listener: ((s: unknown) => void) | undefined
  return {
    emit: (s: unknown) => listener!(s),
    rpc: {
      getConnectionState: () => ({ status: 'connecting', host: 'unknown' }),
      onConnectionState: vi.fn((cb: (s: unknown) => void) => {
        listener = cb
        return () => {}
      }),
      requestAuthCode: vi.fn((_options?: { reissue?: boolean }) => Promise.resolve()),
      submitAuthCode: vi.fn((code: string) => Promise.resolve(code === '123')),
    },
  }
}

describe('connection with the devframe API', () => {
  it('starts from the current state and follows updates reactively', async () => {
    const f = fakeRpc()
    const { connection, connectionSupported, track } = await load(f.rpc)
    expect(connectionSupported).toBe(true)
    expect(f.rpc.onConnectionState).toHaveBeenCalledTimes(1)
    const t = track(() => connection.state.status)
    f.emit({ status: 'unauthorized', host: 'standalone' })
    t.flush()
    f.emit({ status: 'connected', host: 'standalone' })
    t.flush()
    t.stop()
    expect(t.seen).toEqual(['connecting', 'unauthorized', 'connected'])
    expect(connection.state.host).toBe('standalone')
  })

  it('forwards code requests and submissions', async () => {
    const f = fakeRpc()
    const { connection } = await load(f.rpc)
    expect(connection.canAuth).toBe(true)
    await connection.requestCode({ reissue: true })
    expect(f.rpc.requestAuthCode).toHaveBeenLastCalledWith({ reissue: true })
    await expect(connection.submitCode('123')).resolves.toBe(true)
    await expect(connection.submitCode('999')).resolves.toBe(false)
  })

  it('without getConnectionState it assumes connected until told otherwise', async () => {
    const f = fakeRpc()
    const { connection } = await load({ ...f.rpc, getConnectionState: undefined })
    expect(connection.state).toEqual({ status: 'connected', host: 'unknown' })
  })
})
