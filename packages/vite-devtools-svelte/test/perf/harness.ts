// Shared harness for the runtime perf tests: creates a devtools store
// (src/runtime/runtime.js) over an isolated fake browser and drives it like
// the hooks (src/runtime/hooks.js) do.
import { countVisits } from './visits.js'

export { countVisits }

interface RuntimeModule {
  createStore: (env: Record<string, unknown>) => any
  connectHot: (store: any, hot: unknown) => void
}
// A specifier in a variable: the runtime is untyped browser JavaScript.
const RUNTIME_URL = new URL('../../src/runtime/runtime.js', import.meta.url).href
const { createStore, connectHot } = (await import(RUNTIME_URL)) as RuntimeModule

/**
 * The readers hooks.js gives the runtime (svelte/internal/devtools), over the
 * plain objects these tests use as signals and effects: `v` value (a symbol
 * = uninitialized), `deps` / `reactions` arrays, `fn` (an effect), `ctx`,
 * `first` / `next` children. A derived is an object with a
 * `deps` array and no `fn`.
 */
export const fieldApi = {
  signalValue: (s: any) => (typeof s.v === 'symbol' ? undefined : s.v),
  isUninitialized: (s: any) => typeof s.v === 'symbol',
  deps: (r: any): unknown[] => r.deps ?? [],
  reactions: (s: any): unknown[] => s.reactions ?? [],
  kind: (x: any) => ('fn' in x ? 'effect' : Array.isArray(x.deps) ? 'derived' : 'state'),
  componentOf: (e: any) => e.ctx ?? null,
  children: (e: any) => {
    const out: unknown[] = []
    for (let c = e.first; c; c = c.next) out.push(c)
    return out
  },
  snapshot: <T>(value: T): T => value,
  sourceNode: (): string | null => null,
}

/** A write to a tracked signal, as Svelte reports it (hooks.js → markWritten). */
export function write(h: Harness, signal: { v: unknown }, value: unknown) {
  signal.v = value
  const id = h.dt._idBySignal.get(signal)
  if (id !== undefined) h.dt.markWritten(id)
}

export interface Sent {
  event: string
  bytes: number
  data: unknown
}

export interface Harness {
  dt: any
  /** the fake window the store was created with */
  window: Record<string, any>
  sent: Sent[]
  /** live intervals (cleared ones are removed) */
  intervals: Array<{ fn: () => void; ms: number; id: number }>
  rafCallbacks: number
  flushTimers: () => void
  /** deliver a server → runtime hot event */
  emit: (event: string, data?: unknown) => void
  /** dispatch a window event (error, unhandledrejection) to the runtime's listeners */
  dispatchWindow: (type: string, event: unknown) => void
  /** delays (ms) of currently pending setTimeout timers */
  pendingDelays: () => number[]
  document: { visibilityState: 'visible' | 'hidden'; dispatch: () => void }
}

// Create a store over an isolated fake browser. Timers are captured (not
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
  const windowListeners = new Map<string, Array<(event: unknown) => void>>()
  const window: Record<string, any> = {
    addEventListener(type: string, cb: (event: unknown) => void) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), cb])
    },
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
  const timerIds = new Map<number, () => void>()
  const timerDelays = new Map<number, number>()
  let nextId = 1
  const dt = createStore({
    window,
    document,
    setTimeout: (cb: () => void, ms = 0) => {
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
    clearTimeout: (id: number) => {
      timerIds.delete(id)
      timerDelays.delete(id)
    },
    setInterval: (cb: () => void, ms: number) => {
      const id = nextId++
      intervals.push({ fn: cb, ms, id })
      return id
    },
    clearInterval: (id: number) => {
      const i = intervals.findIndex(x => x.id === id)
      if (i !== -1) intervals.splice(i, 1)
    },
    requestAnimationFrame: () => {
      rafCallbacks++
      return 0
    },
    performance: opts.clock ? { now: opts.clock } : performance,
  })
  connectHot(dt, hot)
  dt._api = fieldApi
  const emit = (event: string, data?: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(data)
  }
  if (opts.active !== false) {
    emit('svelte-devtools:subscription', { active: true, componentDeltas: opts.deltas !== false })
  }
  const dispatchWindow = (type: string, event: unknown) => {
    for (const cb of windowListeners.get(type) ?? []) cb(event)
  }
  return {
    dispatchWindow,
    dt,
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
    const derived = { v: i * 2, deps: [signals.at(-1)] }
    signals.push(derived)
    dt.trackDerived(derived, 'd', id)
    dt.bindEffect(dt.trackUserEffect('effect', id), { deps: [derived], fn() {} })
    dt.endInit(id)
    dt.registered(id)
    ids.push(id)
  }
  dt.registered(root)
  return { root, ids, signals }
}

// Svelte tears effects down child-first, so the hooks call unmount(id) for
// every row and finally for the root.
export function unmountList(h: Harness, list: { root: number; ids: number[] }) {
  for (const id of list.ids) h.dt.unmount(id)
  h.dt.unmount(list.root)
}

// The observation the runtime schedules after Svelte's flush (a task later),
// run synchronously.
export function pollFn(h: Harness): () => void {
  return () => {
    if (h.dt._observeTimer !== null) {
      clearTimeout(h.dt._observeTimer)
      h.dt._observeTimer = null
    }
    h.dt._observeStates()
  }
}

// Observe until nothing is pending (initial snapshots done).
export function settlePolling(h: Harness, poll: () => void) {
  for (let t = 0; t < 2000; t++) {
    poll()
    if (h.dt._unseeded.size === 0 && h.dt._written.size === 0) return
  }
  throw new Error('polling never settled')
}

export function unmountVisits(n: number): number {
  const h = createRuntime()
  const list = mountList(h, n)
  return countVisits(() => unmountList(h, list))
}
