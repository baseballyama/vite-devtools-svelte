// Shared harness for the runtime perf tests: evaluates the injected runtime
// (runtimeCode) in an isolated fake browser and drives
// `window.__SVELTE_DEVTOOLS__` like the svelte/internal/client wrapper does.
import { runtimeCode } from '../../runtime.js'

export interface Sent {
  event: string
  bytes: number
  data: unknown
}

export interface Harness {
  dt: any
  /** the fake window the runtime was evaluated against */
  window: Record<string, any>
  sent: Sent[]
  /** live intervals (cleared ones are removed) */
  intervals: Array<{ fn: () => void; ms: number; id: number }>
  rafCallbacks: number
  flushTimers: () => void
  /** deliver a server → runtime hot event */
  emit: (event: string, data?: unknown) => void
  /** delays (ms) of currently pending setTimeout timers */
  pendingDelays: () => number[]
  document: { visibilityState: 'visible' | 'hidden'; dispatch: () => void }
}

// Evaluate runtimeCode in an isolated fake browser. Timers are captured (not
// scheduled) so tests control exactly when debounced/periodic work runs.
// `clock` replaces performance.now() inside the runtime (time-based logic).
// `active` (default true) delivers the §6.3 subscription message after boot,
// as the server does when a DevTools client is attached; `deltas` (default
// true) sets its §6.5 componentDeltas feature gate.
export function createRuntime(
  opts: {
    clock?: () => number
    active?: boolean
    /** advertise subscription.componentDeltas (§6.5); default true */
    deltas?: boolean
    onSend?: (bytes: number) => void
  } = {},
): Harness {
  const sent: Sent[] = []
  const intervals: Array<{ fn: () => void; ms: number; id: number }> = []
  const handlers = new Map<string, Array<(data: unknown) => void>>()
  let timers: Array<() => void> = []
  let rafCallbacks = 0
  const hot = {
    send(event: string, data: unknown) {
      const bytes = JSON.stringify(data ?? null).length
      sent.push({ event, bytes, data })
      opts.onSend?.(bytes)
    },
    on(event: string, cb: (data: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb])
    },
  }
  const window: Record<string, any> = {
    addEventListener() {},
    removeEventListener() {},
  }
  const visibilityListeners: Array<() => void> = []
  const document = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') visibilityListeners.push(cb)
    },
    dispatch() {
      for (const cb of visibilityListeners) cb()
    },
  }
  const code = runtimeCode.replaceAll('import.meta.hot', '__hot')
  const fn = new Function(
    'window',
    'document',
    '__hot',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'requestAnimationFrame',
    'performance',
    'WeakRef',
    code,
  )
  const timerIds = new Map<number, () => void>()
  const timerDelays = new Map<number, number>()
  let nextId = 1
  fn(
    window,
    document,
    hot,
    (cb: () => void, ms = 0) => {
      const id = nextId++
      timerIds.set(id, cb)
      timerDelays.set(id, ms)
      timers.push(() => {
        if (timerIds.has(id)) {
          timerIds.delete(id)
          timerDelays.delete(id)
          cb()
        }
      })
      return id
    },
    (id: number) => {
      timerIds.delete(id)
      timerDelays.delete(id)
    },
    (cb: () => void, ms: number) => {
      const id = nextId++
      intervals.push({ fn: cb, ms, id })
      return id
    },
    (id: number) => {
      const i = intervals.findIndex(x => x.id === id)
      if (i !== -1) intervals.splice(i, 1)
    },
    () => {
      rafCallbacks++
      return 0
    },
    opts.clock ? { now: opts.clock } : performance,
    WeakRef,
  )
  const emit = (event: string, data?: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(data)
  }
  if (opts.active !== false) {
    emit('svelte-devtools:subscription', { active: true, componentDeltas: opts.deltas !== false })
  }
  return {
    dt: window.__SVELTE_DEVTOOLS__,
    window,
    sent,
    intervals,
    get rafCallbacks() {
      return rafCallbacks
    },
    flushTimers() {
      const pending = timers
      timers = []
      for (const t of pending) t()
    },
    emit,
    document,
    pendingDelays: () => [...timerDelays.values()],
  }
}

// Mount `n` sibling components under one root, each with `statesPer` states,
// one derived and one effect — the shape of a big keyed `{#each}` list.
export function mountList(h: Harness, n: number, statesPer = 2) {
  const { dt } = h
  const root = dt.register('/app/src/routes/+page.svelte')
  const signals: any[] = []
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const id = dt.register('/app/src/lib/Row.svelte')
    dt.startInit(id)
    for (let s = 0; s < statesPer; s++) {
      const sig = { v: i, deps: null }
      signals.push(sig)
      dt.trackState(sig, `s${s}`, id)
    }
    const derived = { v: i * 2, deps: [signals[signals.length - 1]] }
    signals.push(derived)
    dt.trackDerived(derived, 'd', id)
    dt.trackEffect({ deps: [derived] }, '$effect', id)
    dt.endInit(id)
    dt.registered(id)
    ids.push(id)
  }
  dt.registered(root)
  return { root, ids, signals }
}

// Svelte tears effects down child-first, so the wrapper calls unmount(id) for
// every row and finally for the root.
export function unmountList(h: Harness, list: { root: number; ids: number[] }) {
  for (const id of list.ids) h.dt.unmount(id)
  h.dt.unmount(list.root)
}

// Deterministic work counter: number of elements visited by Map/Set/Array
// iteration while `fn` runs. Wall-clock ratios are too noisy on shared CI
// machines; element visits expose O(n²) loops exactly.
export function countVisits(fn: () => void): number {
  let visits = 0
  const restores: Array<() => void> = []
  const patchIter = (proto: any, key: PropertyKey) => {
    const orig = proto[key]
    proto[key] = function (this: any, ...args: any[]) {
      const it = orig.apply(this, args)
      const next = it.next.bind(it)
      return {
        next() {
          visits++
          return next()
        },
        [Symbol.iterator]() {
          return this
        },
      }
    }
    restores.push(() => (proto[key] = orig))
  }
  const patchLinear = (proto: any, key: string) => {
    const orig = proto[key]
    proto[key] = function (this: any, ...args: any[]) {
      visits += this.length ?? this.size ?? 0
      return orig.apply(this, args)
    }
    restores.push(() => (proto[key] = orig))
  }
  for (const proto of [Map.prototype, Set.prototype]) {
    for (const key of ['entries', 'keys', 'values', Symbol.iterator]) patchIter(proto, key)
    patchLinear(proto, 'forEach')
  }
  for (const key of [
    'filter',
    'indexOf',
    'includes',
    'splice',
    'forEach',
    'map',
    'some',
    'find',
    'findIndex',
  ]) {
    patchLinear(Array.prototype, key)
  }
  try {
    fn()
  } finally {
    for (const r of restores.reverse()) r()
  }
  return visits
}

export function pollFn(h: Harness): () => void {
  const poll = h.intervals.find(i => i.ms === 200)
  if (!poll) throw new Error('state poll interval not registered')
  return poll.fn
}

// Poll until a full tick records nothing new (initial snapshots done).
export function settlePolling(h: Harness, poll: () => void) {
  for (let t = 0; t < 2000; t++) {
    const before = h.dt._stateTimeline.length
    const metaBefore = h.dt._pollMeta.size
    poll()
    if (t > 0 && h.dt._stateTimeline.length === before && h.dt._pollMeta.size === metaBefore) return
  }
  throw new Error('polling never settled')
}

export function unmountVisits(n: number): number {
  const h = createRuntime()
  const list = mountList(h, n)
  return countVisits(() => unmountList(h, list))
}
