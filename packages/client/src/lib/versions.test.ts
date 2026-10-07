import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DatasetVersions } from './types.js'

const V: DatasetVersions = {
  components: 1,
  renderProfiles: 2,
  loadProfiles: 3,
  stateTimeline: 4,
  reactiveGraph: 5,
  errors: 6,
  fps: 7,
}

/** Fresh module (its cache is module state) over a mocked RPC layer. */
async function load(rpc: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock('./rpc.js', () => rpc)
  return import('./versions.js')
}

beforeEach(() => {
  vi.useFakeTimers({ now: 10_000 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.doUnmock('./rpc.js')
})

describe('datasetVersion', () => {
  it('is undefined (always refetch) against a server without getVersions', async () => {
    const { datasetVersion } = await load({ getVersions: undefined })
    expect(datasetVersion('components')).toBeUndefined()
  })

  it('joins the counters of the requested datasets', async () => {
    const getVersions = vi.fn(() => Promise.resolve(V))
    const { datasetVersion } = await load({ getVersions })
    await expect(datasetVersion('components')!()).resolves.toBe('1')
    await expect(datasetVersion('errors', 'fps', 'components')!()).resolves.toBe('6:7:1')
    await expect(datasetVersion()!()).resolves.toBe('')
  })

  it('shares one in-flight request between panels and reuses it for 250 ms', async () => {
    const getVersions = vi.fn(() => Promise.resolve(V))
    const { datasetVersion } = await load({ getVersions })
    const a = datasetVersion('components')!
    const b = datasetVersion('fps')!
    await Promise.all([a(), b()])
    expect(getVersions).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(249)
    await a()
    expect(getVersions).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await a()
    expect(getVersions).toHaveBeenCalledTimes(2)
  })

  it('a failed request means "unknown" (undefined), and is retried after it ages out', async () => {
    const getVersions = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(V)
    const { datasetVersion } = await load({ getVersions })
    const v = datasetVersion('errors')!
    await expect(v()).resolves.toBeUndefined()
    vi.advanceTimersByTime(250)
    await expect(v()).resolves.toBe('6')
  })

  it('a counter the server does not report is unknown (refetch), not a constant', async () => {
    const { datasetVersion } = await load({ getVersions: () => Promise.resolve({ components: 1 }) })
    await expect(datasetVersion('components', 'fps')!()).resolves.toBeUndefined()
    await expect(datasetVersion('components')!()).resolves.toBe('1')
  })
})
