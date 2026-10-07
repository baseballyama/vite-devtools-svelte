import type * as Svelte from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `captureInfo()` builds a `resource()`, which reads panel context; tests run
// outside a component.
vi.doMock('svelte', async (importOriginal: () => Promise<typeof Svelte>) => ({
  ...(await importOriginal()),
  getContext: () => null,
}))

/** Fresh module over a fake RPC layer. */
async function load(rpc: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock('./rpc.js', () => rpc)
  const { captureInfo } = await import('./capture.svelte.js')
  const { withRoot } = await import('./testing.svelte.js')
  return { captureInfo, withRoot }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('./rpc.js')
})

describe('captureInfo', () => {
  it('polls getCaptureInfo', async () => {
    const info = { components: { captured: 1, total: 2, truncated: true } }
    const getCaptureInfo = vi.fn(() => Promise.resolve(info))
    const { captureInfo, withRoot } = await load({ getCaptureInfo })
    const r = withRoot(() => captureInfo(1_000))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(getCaptureInfo).toHaveBeenCalledTimes(3)
    expect(r.value.data).toEqual(info)
    r.stop()
  })

  it('respects the `when` gate', async () => {
    const getCaptureInfo = vi.fn(() => Promise.resolve({}))
    const { captureInfo, withRoot } = await load({ getCaptureInfo })
    const r = withRoot(() => captureInfo(1_000, () => false))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getCaptureInfo).not.toHaveBeenCalled()
    r.stop()
  })
})
