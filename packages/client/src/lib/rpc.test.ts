import { describe, expect, it, vi } from 'vitest'

// A minimal devframe client: only what rpc.ts touches while connecting.
const fakeClient = vi.hoisted(() => ({
  status: 'unauthorized',
  connectionMeta: {},
  events: { on: () => () => {} },
  requestAuthCode: vi.fn((_options?: { reissue?: boolean }) => Promise.resolve()),
  requestTrustWithCode: vi.fn(() => Promise.resolve('token')),
}))
vi.mock('devframe/client', () => ({ connectDevframe: vi.fn(() => Promise.resolve(fakeClient)) }))

const { requestAuthCode, submitAuthCode } = await import('./rpc.js')

describe('rpc.ts auth helpers', () => {
  it('asks devframe to print the current code without rotating it by default', async () => {
    await requestAuthCode()
    expect(fakeClient.requestAuthCode).toHaveBeenLastCalledWith({})
  })

  it('rotates the code for "print a new code" (devframe prints each code only once)', async () => {
    await requestAuthCode({ reissue: true })
    expect(fakeClient.requestAuthCode).toHaveBeenLastCalledWith({ reissue: true })
  })

  it('trims the typed code before exchanging it', async () => {
    await submitAuthCode(' 123456 ')
    expect(fakeClient.requestTrustWithCode).toHaveBeenLastCalledWith('123456')
  })
})
