import { runtimeCode } from '../../src/runtime/index.js';
import { countVisits } from './visits.js';

export { countVisits };

export interface Sent {
  event: string;
  bytes: number;
  data: unknown;
}

export interface Harness {
  dt: any;
  window: Record<string, any>;
  sent: Sent[];
  /** live intervals (cleared ones are removed) */
  intervals: Array<{ fn: () => void; ms: number; id: number }>;
  rafCallbacks: number;
  flushTimers: () => void;
  /** deliver a server → runtime hot event */
  emit: (event: string, data?: unknown) => void;
  /** dispatch a window event (error, unhandledrejection) to the runtime's listeners */
  dispatchWindow: (type: string, event: unknown) => void;
  /** delays (ms) of currently pending setTimeout timers */
  pendingDelays: () => number[];
  document: { visibilityState: 'visible' | 'hidden'; dispatch: () => void };
}

// Timers are captured, not scheduled, so tests control when debounced/periodic work runs.
// `active` (default true) delivers the subscription message, as when a DevTools client is attached.
export function createRuntime(
  opts: {
    clock?: () => number;
    active?: boolean;
    /** advertise subscription.componentDeltas; default true */
    deltas?: boolean;
    onSend?: (bytes: number) => void;
  } = {},
): Harness {
  const sent: Sent[] = [];
  const intervals: Array<{ fn: () => void; ms: number; id: number }> = [];
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  let timers: Array<() => void> = [];
  let rafCallbacks = 0;
  const hot = {
    send(event: string, data: unknown) {
      const bytes = JSON.stringify(data ?? null).length;
      sent.push({ event, bytes, data });
      opts.onSend?.(bytes);
    },
    on(event: string, cb: (data: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    },
  };
  const windowListeners = new Map<string, Array<(event: unknown) => void>>();
  const window: Record<string, any> = {
    addEventListener(type: string, cb: (event: unknown) => void) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), cb]);
    },
    removeEventListener() {},
  };
  const visibilityListeners: Array<() => void> = [];
  const document = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') visibilityListeners.push(cb);
    },
    dispatch() {
      for (const cb of visibilityListeners) cb();
    },
  };
  const code = runtimeCode.replaceAll('import.meta.hot', '__hot');
  // oxlint-disable-next-line typescript/no-implied-eval -- running the runtime source under test is the point
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
  );
  const timerIds = new Map<number, () => void>();
  const timerDelays = new Map<number, number>();
  let nextId = 1;
  fn(
    window,
    document,
    hot,
    (cb: () => void, ms = 0) => {
      const id = nextId++;
      timerIds.set(id, cb);
      timerDelays.set(id, ms);
      timers.push(() => {
        if (timerIds.has(id)) {
          timerIds.delete(id);
          timerDelays.delete(id);
          cb();
        }
      });
      return id;
    },
    (id: number) => {
      timerIds.delete(id);
      timerDelays.delete(id);
    },
    (cb: () => void, ms: number) => {
      const id = nextId++;
      intervals.push({ fn: cb, ms, id });
      return id;
    },
    (id: number) => {
      const i = intervals.findIndex(x => x.id === id);
      if (i !== -1) intervals.splice(i, 1);
    },
    () => {
      rafCallbacks++;
      return 0;
    },
    opts.clock ? { now: opts.clock } : performance,
    WeakRef,
  );
  const emit = (event: string, data?: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(data);
  };
  if (opts.active !== false) {
    emit('svelte-devtools:subscription', { active: true, componentDeltas: opts.deltas !== false });
  }
  const dispatchWindow = (type: string, event: unknown) => {
    for (const cb of windowListeners.get(type) ?? []) cb(event);
  };
  return {
    dispatchWindow,
    dt: window.__SVELTE_DEVTOOLS__,
    window,
    sent,
    intervals,
    get rafCallbacks() {
      return rafCallbacks;
    },
    flushTimers() {
      const pending = timers;
      timers = [];
      for (const t of pending) t();
    },
    emit,
    document,
    pendingDelays: () => [...timerDelays.values()],
  };
}

// One derived and one effect per row: the shape of a big keyed `{#each}` list.
export function mountList(h: Harness, n: number, statesPer = 2) {
  const { dt } = h;
  const root = dt.register('/app/src/routes/+page.svelte');
  const signals: any[] = [];
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = dt.register('/app/src/lib/Row.svelte', root);
    dt.startInit(id);
    for (let s = 0; s < statesPer; s++) {
      const sig = { v: i, deps: null };
      signals.push(sig);
      dt.trackState(sig, `s${s}`, id);
    }
    const derived = { v: i * 2, deps: [signals.at(-1)] };
    signals.push(derived);
    dt.trackDerived(derived, 'd', id);
    dt.bindEffect(dt.trackUserEffect('effect', id, null), { deps: [derived], fn() {} });
    dt.endInit(id);
    ids.push(id);
  }
  return { root, ids, signals };
}

// Svelte tears effects down child-first, so the wrapper calls unmount(id) for
// every row and finally for the root.
export function unmountList(h: Harness, list: { root: number; ids: number[] }) {
  for (const id of list.ids) h.dt.unmount(id);
  h.dt.unmount(list.root);
}

export function pollFn(h: Harness): () => void {
  const poll = h.intervals.find(i => i.ms === 200);
  if (!poll) throw new Error('state poll interval not registered');
  return poll.fn;
}

// Poll until a full tick records nothing new (initial snapshots done).
export function settlePolling(h: Harness, poll: () => void) {
  for (let t = 0; t < 2000; t++) {
    const before = h.dt._stateTimeline.length;
    const metaBefore = h.dt._pollMeta.size;
    poll();
    if (t > 0 && h.dt._stateTimeline.length === before && h.dt._pollMeta.size === metaBefore)
      return;
  }
  throw new Error('polling never settled');
}

export function unmountVisits(n: number): number {
  const h = createRuntime();
  const list = mountList(h, n);
  return countVisits(() => unmountList(h, list));
}
