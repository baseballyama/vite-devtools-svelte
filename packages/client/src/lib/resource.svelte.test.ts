import type * as Svelte from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceOptions } from './resource.svelte.js'
import { withRoot } from './testing.svelte.js'

// `resource()` reads the owning panel's visibility from context; tests run
// outside a component, so `getContext` is replaced by this lookup. (`doMock`
// + dynamic import: a hoisted `vi.mock` does not mix with the rune compiler.)
const context = new Map<unknown, unknown>()
vi.doMock('svelte', async (importOriginal: () => Promise<typeof Svelte>) => ({
  ...(await importOriginal()),
  getContext: (key: unknown) => context.get(key),
}))
const { PANEL_ACTIVE, resource } = await import('./resource.svelte.js')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

/** A fetcher whose calls the test answers one by one. */
function controlled<T>() {
  const calls: Deferred<T>[] = []
  const fetcher = vi.fn(() => {
    const d = deferred<T>()
    calls.push(d)
    return d.promise
  })
  return { fetcher, calls, last: () => calls.at(-1)! }
}

// document.hidden / visibilitychange
const visibility: (() => void)[] = []
const doc = {
  hidden: false,
  addEventListener: (_: 'visibilitychange', cb: () => void) => visibility.push(cb),
  removeEventListener: (_: 'visibilitychange', cb: () => void) => {
    visibility.splice(visibility.indexOf(cb), 1)
  },
}

const roots: (() => void)[] = []
function mount<T>(fetcher: () => Promise<T>, opts: ResourceOptions<T>) {
  const r = withRoot(() => resource(fetcher, opts))
  roots.push(r.stop)
  return { res: r.value, flush: r.flush, stop: r.stop }
}

/** Settle pending promise chains (fake timers do not advance). */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000 })
  vi.stubGlobal('document', doc)
  doc.hidden = false
  visibility.length = 0
  context.clear()
})
afterEach(() => {
  for (const stop of roots.splice(0)) stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('resource: one load', () => {
  it('starts loading with the initial data, then holds the answer', async () => {
    const f = controlled<number[]>()
    const { res } = mount(f.fetcher, { initial: [] })
    expect(res).toMatchObject({ data: [], loading: true, busy: true, error: null, updatedAt: null })
    f.last().resolve([1, 2])
    await settle()
    expect(res).toMatchObject({
      data: [1, 2],
      loading: false,
      busy: false,
      error: null,
      updatedAt: 1_000,
    })
  })

  it('reports an Error message, or a non-Error as text, and keeps the previous data', async () => {
    const f = controlled<number>()
    const { res } = mount(f.fetcher, { initial: 0 })
    f.last().resolve(5)
    await settle()
    const p = res.refresh()
    f.last().reject(new Error('RPC x failed: down'))
    await p
    expect(res).toMatchObject({ data: 5, error: 'RPC x failed: down', loading: false, busy: false })
    const q = res.refresh()
    f.last().reject('plain')
    await q
    expect(res.error).toBe('plain')
    const r = res.refresh()
    f.last().resolve(6)
    await r
    expect(res).toMatchObject({ data: 6, error: null })
  })

  it('loads once without an interval', async () => {
    const f = controlled<number>()
    mount(f.fetcher, { initial: 0 })
    f.last().resolve(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.fetcher).toHaveBeenCalledTimes(1)
  })

  it('refresh() fetches again and resolves when done', async () => {
    const f = controlled<number>()
    const { res } = mount(f.fetcher, { initial: 0 })
    f.last().resolve(1)
    await settle()
    const p = res.refresh()
    expect(res.busy).toBe(true)
    f.last().resolve(2)
    await p
    expect(res.data).toBe(2)
  })
})

describe('resource: polling', () => {
  it('polls at the interval', async () => {
    let n = 0
    const fetcher = vi.fn(() => Promise.resolve(++n))
    const { res } = mount(fetcher, { initial: 0, interval: 1_000 })
    await settle()
    expect(res.data).toBe(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(res.data).toBe(4)
  })

  it('never overlaps an in-flight request', async () => {
    const f = controlled<number>()
    mount(f.fetcher, { initial: 0, interval: 100 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    f.last().resolve(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })

  it('skips ticks while the document is hidden and catches up when it becomes visible', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1))
    mount(fetcher, { initial: 0, interval: 1_000 })
    await settle()
    doc.hidden = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    doc.hidden = false
    for (const cb of visibility) cb()
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('paused starts without polling; live toggles it', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1))
    const { res, flush } = mount(fetcher, { initial: 0, interval: 1_000, paused: true })
    await vi.advanceTimersByTimeAsync(5_000)
    // The first load still happens; only polling is paused.
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(res.live).toBe(false)
    res.live = true
    flush()
    await vi.advanceTimersByTimeAsync(2_000)
    // Resuming loads at once, then polls.
    expect(fetcher).toHaveBeenCalledTimes(4)
    res.live = false
    flush()
    await settle()
    const paused = fetcher.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledTimes(paused)
    expect(visibility).toHaveLength(0)
  })

  it('stops polling and listening when its owner is destroyed', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1))
    const { stop } = mount(fetcher, { initial: 0, interval: 1_000 })
    await settle()
    expect(visibility).toHaveLength(1)
    stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(visibility).toHaveLength(0)
  })
})

describe('resource: gates', () => {
  it('does nothing while `when` is false, and loads when it turns true', async () => {
    let on = $state(false)
    const fetcher = vi.fn(() => Promise.resolve(1))
    const { res, flush } = mount(fetcher, { initial: 0, interval: 1_000, when: () => on })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).not.toHaveBeenCalled()
    expect(res.loading).toBe(true)
    on = true
    flush()
    await settle()
    expect(res.data).toBe(1)
    on = false
    flush()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does nothing while its panel is inactive (PANEL_ACTIVE context)', async () => {
    let active = $state(false)
    context.set(PANEL_ACTIVE, () => active)
    const fetcher = vi.fn(() => Promise.resolve(1))
    const { flush } = mount(fetcher, { initial: 0, interval: 1_000 })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetcher).not.toHaveBeenCalled()
    active = true
    flush()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('resource: change detection', () => {
  it('keeps the same data object when a poll returns equal content', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ rows: [1, 2] }))
    const { res } = mount(fetcher, { initial: { rows: [] as number[] }, interval: 1_000 })
    await settle()
    const first = res.data
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(res.data).toBe(first)
    expect(res.updatedAt).toBe(4_000)
  })

  it('always replaces data it cannot serialise', async () => {
    let n = 0
    const fetcher = vi.fn(() => Promise.resolve({ big: 1n, n: ++n }))
    const { res } = mount(fetcher, { initial: { big: 0n, n: 0 }, interval: 1_000 })
    await settle()
    const first = res.data
    await vi.advanceTimersByTimeAsync(1_000)
    expect(res.data).not.toBe(first)
  })

  it('an undefined answer counts as unserialisable and is always applied', async () => {
    const answers = new Map<string, number>()
    const fetcher = vi.fn(() => Promise.resolve(answers.get('none')))
    const { res } = mount<number | undefined>(fetcher, { initial: 1 })
    await settle()
    expect(res.data).toBeUndefined()
  })

  it('uses a custom equals with the current data', async () => {
    const same = { v: 1 }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(same)
      .mockResolvedValueOnce(same)
      .mockResolvedValue({ v: 1 })
    const equals = vi.fn((a: { v: number }, b: { v: number }) => a === b)
    const { res } = mount<{ v: number }>(fetcher, { initial: { v: 0 }, interval: 1_000, equals })
    await settle()
    expect(res.data).toBe(same)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(equals).toHaveBeenLastCalledWith(same, same)
    expect(res.data).toBe(same)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(res.data).not.toBe(same)
  })

  it('skips polled fetches while the version is unchanged; refresh() always fetches', async () => {
    let version: string | undefined = 'a'
    const versionFn = vi.fn(() => Promise.resolve(version))
    const fetcher = vi.fn(() => Promise.resolve(1))
    const { res } = mount(fetcher, { initial: 0, interval: 1_000, version: versionFn })
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(versionFn).toHaveBeenCalledTimes(4)
    expect(fetcher).toHaveBeenCalledTimes(1)
    version = 'b'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await res.refresh()
    expect(fetcher).toHaveBeenCalledTimes(3)
    // Unknown version → always fetch.
    version = undefined
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('a failed fetch does not record its version, so the next poll retries', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(2)
    let version = 'a'
    const { res } = mount<number>(fetcher, {
      initial: 0,
      interval: 1_000,
      version: () => Promise.resolve(version),
    })
    await settle()
    version = 'b'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(res.error).toBe('x')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(res).toMatchObject({ data: 2, error: null })
  })
})

describe('resource: stale answers', () => {
  it('set() replaces data and drops the answer of a request already in flight', async () => {
    const f = controlled<number[]>()
    const { res } = mount(f.fetcher, { initial: [], interval: 1_000 })
    f.last().resolve([1, 2, 3])
    await vi.advanceTimersByTimeAsync(1_000)
    // A poll is in flight when the user clears the list.
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    res.set([])
    f.last().resolve([1, 2, 3])
    await settle()
    expect(res.data).toEqual([])
    // The next poll is fresh and applies.
    await vi.advanceTimersByTimeAsync(1_000)
    f.last().resolve([4])
    await settle()
    expect(res.data).toEqual([4])
  })

  it('set() also drops a failing in-flight answer', async () => {
    const f = controlled<number>()
    const { res } = mount(f.fetcher, { initial: 0 })
    res.set(7)
    f.last().reject(new Error('late'))
    await settle()
    expect(res).toMatchObject({ data: 7, error: null, loading: false, busy: false })
  })

  it('set() during the first load ends the loading state', () => {
    const f = controlled<number>()
    const { res } = mount(f.fetcher, { initial: 0 })
    res.set(3)
    expect(res).toMatchObject({ data: 3, loading: false })
  })

  it('set() forgets the version, so the next poll fetches even if it did not move', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1))
    const { res } = mount(fetcher, {
      initial: 0,
      interval: 1_000,
      version: () => Promise.resolve('same'),
    })
    await settle()
    res.set(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(res.data).toBe(1)
  })

  it('refresh() during a request waits for it, drops its answer and fetches again', async () => {
    let scope = 'a'
    const f = controlled<string>()
    const fetcher = vi.fn(() => {
      const s = scope
      return f.fetcher().then(v => `${s}:${v}`)
    })
    const { res } = mount(fetcher, { initial: '' })
    // The scope changes while the first request (for "a") is in flight.
    scope = 'b'
    const p = res.refresh()
    f.calls[0]!.resolve('old')
    await settle()
    expect(res.data).toBe('')
    expect(res.loading).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    f.calls[1]!.resolve('new')
    await p
    expect(res).toMatchObject({ data: 'b:new', loading: false, busy: false })
  })

  it('concurrent refresh() calls share the follow-up request', async () => {
    const f = controlled<number>()
    const { res } = mount(f.fetcher, { initial: 0 })
    const a = res.refresh()
    const b = res.refresh()
    f.calls[0]!.resolve(1)
    await settle()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    f.calls[1]!.resolve(2)
    await Promise.all([a, b])
    expect(res.data).toBe(2)
  })
})
