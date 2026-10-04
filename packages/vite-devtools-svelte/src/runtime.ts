// This code is injected into the user's app as a virtual module.
// It tracks Svelte component mount/unmount and sends data to the Vite server via HMR.
export const RUNTIME_MODULE_ID = 'virtual:svelte-devtools-runtime'
export const RESOLVED_RUNTIME_ID = '\0' + RUNTIME_MODULE_ID

// Virtual module ID for the svelte/internal/client wrapper.
// When user code imports 'svelte/internal/client', it is redirected to this module.
// The wrapper re-exports everything and overrides key functions for devtools tracking.
export const WRAPPER_MODULE_ID = '\0svelte-devtools:wrapped-client'

/**
 * Wrapper code for svelte/internal/client.
 *
 * Re-exports everything from the real module, then overrides:
 * - push/pop: component lifecycle tracking
 * - tag/tag_proxy: named signal/proxy tracking (Svelte dev mode)
 * - state/derived/proxy: type markers consumed by tag/tag_proxy
 * - user_effect/user_pre_effect: effect tracking
 * - template_effect/deferred_template_effect: render count/time profiling
 * - each/if/key/await/component/boundary: block-callback owner attribution
 *
 * This single module replaces all post-compilation regex transforms
 * for reactive tracking, making the approach Svelte-compiler-output agnostic.
 */
export const wrapperCode = /* js */ `
import * as __svelte_original from 'svelte/internal/client';
export * from 'svelte/internal/client';

function __dt() {
  return typeof window !== 'undefined' ? window.__SVELTE_DEVTOOLS__ : null;
}

// Component ID stack (parallel to runtime._stack but local to wrapper)
const __idStack = [];
function __currentId() {
  return __idStack.length > 0 ? __idStack[__idStack.length - 1] : null;
}

// Tracks the most recently created signal for type determination in tag()
const __pendingSignal = { ref: null, type: null };

// Component context -> devtools id (review B1b). A component created later
// by a block update ({#each}/{#if} after mount) runs outside its parent's
// push..pop, where the runtime's init stack is empty (the wrapper stack
// below covers the wrapped block helpers; this covers the rest). Svelte (5.56.8,
// internal/client) exports active_effect; every effect records the
// component context it was created in (effect.ctx) and runs with that
// context restored. The block effect that creates the child belongs to the
// parent's template, so active_effect.ctx at push time IS the parent's
// context. Each context is mapped to its id once the component mounted
// (inside its own deferred effect, where active_effect.ctx is the
// component's own context). Weak map: no leak, no Svelte state touched.
const __idByContext = new WeakMap();
function __parentFromContext() {
  const effect = __svelte_original.active_effect;
  const ctx = effect ? effect.ctx : null;
  return ctx ? __idByContext.get(ctx) : undefined;
}

// --- Component Lifecycle ---
//
// Observer must not break the observed: every devtools side-effect below is
// wrapped in try/catch so a bug or an out-of-shape runtime cannot tear down
// the user's app. The original Svelte function is always called, and its
// return value always returned, regardless of devtools failures.

export function push() {
  // Parent hint, read before this component's own id exists:
  // 1. the wrapper stack: the component whose init is running (children
  //    rendered directly by a template, where active_effect still belongs to
  //    an outer block), or the block owner re-pushed by __wrapBlockFn for a
  //    later {#each}/{#if}/{#key} update (see Block Attribution below);
  // 2. else the context-derived owner, for re-creation paths the wrapper
  //    does not wrap (snippet, svelte:element, ...).
  let parentHint = null;
  try { parentHint = __currentId(); } catch {}
  if (parentHint === null) {
    try { parentHint = __parentFromContext(); } catch {}
  }
  const result = __svelte_original.push.apply(null, arguments);
  try {
    const dt = __dt();
    if (dt) {
      const file = dt._pendingFile || 'Unknown';
      dt._pendingFile = null;
      dt._pendingParent = parentHint;
      const id = dt.register(file);
      __idStack.push(id);
      dt.startInit(id);
      try {
        __svelte_original.user_effect(() => {
          try {
            const own = __svelte_original.active_effect;
            if (own && own.ctx) __idByContext.set(own.ctx, id);
          } catch {}
          return () => { try { dt.unmount(id); } catch {} };
        });
      } catch {}
    }
  } catch {}
  return result;
}

export function pop() {
  // Capture devtools errors but ALWAYS forward to the original pop so the
  // Svelte component stack stays balanced.
  try {
    const dt = __dt();
    if (dt && __idStack.length > 0) {
      const id = __idStack.pop();
      try { dt.endInit(id); } catch {}
      try { dt.registered(id); } catch {}
    }
  } catch {}
  return __svelte_original.pop.apply(null, arguments);
}

// --- Signal Creation (type markers) ---

export function state() {
  const signal = __svelte_original.state.apply(null, arguments);
  try {
    __pendingSignal.ref = signal;
    __pendingSignal.type = 'state';
  } catch {}
  return signal;
}

export function derived() {
  const signal = __svelte_original.derived.apply(null, arguments);
  try {
    __pendingSignal.ref = signal;
    __pendingSignal.type = 'derived';
  } catch {}
  return signal;
}

export function proxy() {
  const p = __svelte_original.proxy.apply(null, arguments);
  try {
    __pendingSignal.ref = p;
    __pendingSignal.type = 'proxy';
  } catch {}
  return p;
}

// --- Signal Tagging (Svelte dev mode) ---

export function tag(signal, name) {
  const result = __svelte_original.tag.apply(null, arguments);
  try {
    const dt = __dt();
    const cid = __currentId();
    if (dt && cid !== null) {
      const type = (__pendingSignal.ref === signal) ? __pendingSignal.type : 'state';
      if (type === 'derived') {
        dt.trackDerived(signal, name, cid);
      } else {
        dt.trackState(signal, name, cid);
      }
    }
    __pendingSignal.ref = null;
    __pendingSignal.type = null;
  } catch {}
  return result;
}

export function tag_proxy(proxy, name) {
  const result = __svelte_original.tag_proxy.apply(null, arguments);
  try {
    const dt = __dt();
    const cid = __currentId();
    if (dt && cid !== null) {
      dt.trackProxy(proxy, name, cid);
    }
    __pendingSignal.ref = null;
    __pendingSignal.type = null;
  } catch {}
  return result;
}

// --- Effect Tracking ---

export function user_effect() {
  const result = __svelte_original.user_effect.apply(null, arguments);
  try {
    const dt = __dt();
    const cid = __currentId();
    if (dt && cid !== null) {
      dt._effectCounter = (dt._effectCounter || 0) + 1;
      // Track the effect OBJECT (not the callback). The Svelte runtime
      // populates result.deps with the signals this effect depends on,
      // which is what getReactiveGraph() reads to build edges.
      dt.trackEffect(result, 'effect_' + dt._effectCounter, cid);
    }
  } catch {}
  return result;
}

export function user_pre_effect() {
  const result = __svelte_original.user_pre_effect.apply(null, arguments);
  try {
    const dt = __dt();
    const cid = __currentId();
    if (dt && cid !== null) {
      dt._effectCounter = (dt._effectCounter || 0) + 1;
      dt.trackEffect(result, 'effect_pre_' + dt._effectCounter, cid);
    }
  } catch {}
  return result;
}

// --- Render Profiling ---
//
// Svelte 5 has no virtual DOM: the compiler wraps every dynamic part of a
// template in a template_effect (deferred_template_effect for <svelte:head>
// <title>). A re-run of such an effect IS the component updating the DOM, so
// these two functions are the measurement points for renders / render time.
//
// The first run of an effect is the mount-time paint, already covered by
// initTime, so it is skipped (initialRun). One state change re-runs several
// effects of the same component, so durations are pooled per microtask and
// recorded once per flush: recordRender() +1, recordRenderTime() the sum.

const __pendingRenderDurations = new Map();
let __renderFlushScheduled = false;

function __flushRenderDurations() {
  __renderFlushScheduled = false;
  const dt = __dt();
  for (const [cid, duration] of __pendingRenderDurations) {
    if (dt) {
      try { dt.recordRender(cid); } catch {}
      try { dt.recordRenderTime(cid, duration); } catch {}
    }
  }
  __pendingRenderDurations.clear();
}

function __recordRenderDuration(cid, duration) {
  __pendingRenderDurations.set(cid, (__pendingRenderDurations.get(cid) || 0) + duration);
  if (!__renderFlushScheduled) {
    __renderFlushScheduled = true;
    queueMicrotask(__flushRenderDurations);
  }
}

// Returns a (possibly new) args array whose first element times each re-run
// of the effect closure. The owning component is whatever id is on top of
// __idStack at effect-creation time. User exceptions propagate untouched;
// only the args are built inside try so the original is called exactly once.
function __wrapTemplateEffect(args) {
  const cid = __currentId();
  const fn = args[0];
  if (cid === null || typeof fn !== 'function') return args;
  const wrapped = Array.prototype.slice.call(args);
  let initialRun = true;
  wrapped[0] = function () {
    if (initialRun) {
      initialRun = false;
      return fn.apply(this, arguments);
    }
    const start = performance.now();
    try {
      return fn.apply(this, arguments);
    } finally {
      try { __recordRenderDuration(cid, performance.now() - start); } catch {}
    }
  };
  return wrapped;
}

export function template_effect() {
  let args = arguments;
  try { args = __wrapTemplateEffect(arguments); } catch {}
  return __svelte_original.template_effect.apply(null, args);
}

export function deferred_template_effect() {
  let args = arguments;
  try { args = __wrapTemplateEffect(arguments); } catch {}
  return __svelte_original.deferred_template_effect.apply(null, args);
}

// --- Block Attribution ---
//
// Svelte creates render effects synchronously at creation time. At mount this
// happens during the component function (between push/pop), so __idStack has
// the owner. But effects for {#each} items added later or re-created {#if}
// branches are created during a batch flush, when the stack is empty — they
// would never be attributed. Block helpers themselves ARE always called
// during their owner's init (or inside an outer block's callback), so the
// owner id is on the stack at block-creation time. __wrapBlock captures it
// and re-pushes it around every function argument the block invokes later,
// so effects created inside land on the innermost owner. Child components
// push their own id on top, keeping nested attribution correct.

function __wrapBlockFn(fn, cid) {
  return function () {
    let pushed = false;
    try { __idStack.push(cid); pushed = true; } catch {}
    try {
      return fn.apply(this, arguments);
    } finally {
      if (pushed) { try { __idStack.pop(); } catch {} }
    }
  };
}

function __wrapBlock(args) {
  const cid = __currentId();
  if (cid === null) return args;
  const wrapped = Array.prototype.slice.call(args);
  for (let i = 0; i < wrapped.length; i++) {
    if (typeof wrapped[i] === 'function') wrapped[i] = __wrapBlockFn(wrapped[i], cid);
  }
  return wrapped;
}

export function each() {
  let args = arguments;
  try { args = __wrapBlock(arguments); } catch {}
  return __svelte_original.each.apply(null, args);
}

export function key() {
  let args = arguments;
  try { args = __wrapBlock(arguments); } catch {}
  return __svelte_original.key.apply(null, args);
}

export function component() {
  let args = arguments;
  try { args = __wrapBlock(arguments); } catch {}
  return __svelte_original.component.apply(null, args);
}

export function boundary() {
  let args = arguments;
  try { args = __wrapBlock(arguments); } catch {}
  return __svelte_original.boundary.apply(null, args);
}

// 'if' and 'await' are reserved words, so they cannot be declared as
// function names and are exported via aliases instead.
function __if_block() {
  let args = arguments;
  try { args = __wrapBlock(arguments); } catch {}
  return __svelte_original['if'].apply(null, args);
}

function __await_block() {
  let args = arguments;
  try { args = __wrapBlock(arguments); } catch {}
  return __svelte_original['await'].apply(null, args);
}

export { __if_block as if, __await_block as await };
`

export const runtimeCode = /* js */ `
if (typeof window !== 'undefined' && !window.__SVELTE_DEVTOOLS__) {
  const __NO_VALUE = Symbol('no value');
  // FNV-1a over UTF-16 code units: cheap change detection for large snapshots.
  const __hash = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  };
  const __SVELTE_DT = {
    _nextId: 0,
    _instances: new Map(),
    _stack: [],
    _pendingParent: undefined,
    _pendingFile: null,
    _effectCounter: 0,
    _debounceTimer: null,
    _listeners: new Set(),

    // Phase 2: Profiling data
    _profiles: new Map(),
    _initStartTimes: new Map(),
    _profileDebounceTimer: null,

    // Phase 2: Reactive graph data
    _reactiveNodes: new Map(),
    _reactiveProxies: new Map(),

    // componentId -> Set<nodeId>. Lets unmount purge a component's reactive
    // nodes without scanning every node of the app (was O(components x nodes)).
    _nodesByComponent: new Map(),

    // Phase 3: State timeline
    _stateTimeline: [],
    _stateSnapshots: new Map(),
    _timelineDebounceTimer: null,
    // Polling bookkeeping: rotating start over $state node ids plus per-node
    // change hints (nodeId -> { ref, wv, nextCheckAt }).
    _pollIds: null,
    _pollCursor: 0,
    _pollMeta: new Map(),
    _deepCredit: 0,
    _lastSnapshotSize: new Map(),
    _timelineSeq: 0,
    _pushedSeq: 0,
    _timelineReset: false,
    _entryInfo: new WeakMap(),
    _epoch: Math.random().toString(36).slice(2) + Date.now().toString(36),

    // --- Activity subscription (docs/devframe-migration.md §6.3) ---
    // Inactive until the server says a DevTools client (UI tab or MCP lease)
    // is watching: no state polling, FPS rAF loop, or periodic HMR sends.
    _active: false,
    _componentsCost: { ms: 0, bytes: 0 },
    _componentDeltas: false,
    _pendingAdded: new Set(),
    _pendingRemoved: new Set(),
    _lastFullAt: 0,
    _resync: false,
    _profilesCost: { ms: 0, bytes: 0 },
    // = collector LIMITS.renderProfiles (pinned by a unit test): the server
    // keeps only the newest entries, so sending more is wasted bytes.
    _profileCap: 5000,
    _sampling: null,
    _fpsGen: 0,

    register(file) {
      const id = this._nextId++;
      // Parent: the wrapper's context-derived hint (components created by a
      // later block update, review B1b) when it names a live instance, else
      // the synchronous init stack (children created during the parent's own
      // init, before the parent is mapped).
      const hint = this._pendingParent;
      this._pendingParent = undefined;
      const parentId =
        hint !== undefined && hint !== null && this._instances.has(hint)
          ? hint
          : this._stack.length > 0 ? this._stack[this._stack.length - 1] : null;
      const name = file.split('/').pop()?.replace('.svelte', '') || 'Unknown';
      // children is a Set so unmounting one row of a 5 000-row list is O(1).
      this._instances.set(id, { id, file, name, parentId, mounted: true, children: new Set() });
      if (parentId !== null) {
        const parent = this._instances.get(parentId);
        if (parent) parent.children.add(id);
      }
      this._stack.push(id);
      if (this._active) this._pendingAdded.add(id);
      this._scheduleUpdate();
      return id;
    },

    registered(id) {
      const idx = this._stack.indexOf(id);
      if (idx !== -1) this._stack.splice(idx, 1);
    },

    mount(id) {
      const instance = this._instances.get(id);
      if (instance && !instance.mounted) {
        instance.mounted = true;
        if (this._active) this._pendingAdded.add(id);
        this._scheduleUpdate();
      }
    },

    unmount(id) {
      const instance = this._instances.get(id);
      if (instance) {
        if (instance.parentId !== null) {
          const parent = this._instances.get(instance.parentId);
          if (parent) parent.children.delete(id);
        }
        this._removeChildren(id);
        this._cleanupComponent(id);
      }
      this._scheduleUpdate();
      this._scheduleProfileUpdate();
    },

    // Remounts get a fresh id, so entries keyed by a dead id would otherwise
    // survive forever — every per-component map must be purged here.
    _cleanupComponent(id) {
      // Delta bookkeeping: an id added and removed between two pushes was
      // never sent, so it cancels out.
      if (this._active && !this._pendingAdded.delete(id)) this._pendingRemoved.add(id);
      this._cleanupReactiveNodes(id);
      this._instances.delete(id);
      this._profiles.delete(id);
      this._initStartTimes.delete(id);
    },

    _cleanupReactiveNodes(componentId) {
      const nodeIds = this._nodesByComponent.get(componentId);
      if (!nodeIds) return;
      this._nodesByComponent.delete(componentId);
      for (const nodeId of nodeIds) this._forgetNode(nodeId);
      this._pollIds = null;
    },

    _forgetNode(nodeId) {
      this._reactiveNodes.delete(nodeId);
      this._reactiveProxies.delete(nodeId);
      this._stateSnapshots.delete(nodeId);
      if (this._stateSnapshotStrs) this._stateSnapshotStrs.delete(nodeId);
      this._pollMeta.delete(nodeId);
      this._lastSnapshotSize.delete(nodeId);
    },

    _indexNode(nodeId, componentId) {
      let set = this._nodesByComponent.get(componentId);
      if (!set) {
        set = new Set();
        this._nodesByComponent.set(componentId, set);
      }
      set.add(nodeId);
      this._pollIds = null;
    },

    _removeChildren(parentId) {
      const parent = this._instances.get(parentId);
      if (!parent) return;
      for (const childId of [...parent.children]) {
        this._removeChildren(childId);
        this._cleanupComponent(childId);
      }
    },

    // Full-list pushes are throttled, not debounced: a pending timer is not
    // reset, so continuous churn still produces updates (a debounce would
    // starve), and the interval adapts to the last push's cost so a 10 000+
    // instance app can't spend its main thread serializing (review P3):
    // max(min, 20 x last send ms, 1 s when the last payload exceeded ~1 MB).
    _sendInterval(cost, min) {
      return Math.max(min, 20 * cost.ms, cost.bytes > 1000000 ? 1000 : 0);
    },

    _scheduleUpdate() {
      if (!this._active || this._debounceTimer) return;
      this._debounceTimer = setTimeout(() => {
        this._debounceTimer = null;
        this._sendUpdate();
      }, this._sendInterval(this._componentsCost, 100));
    },

    // components push (§6.5). Full form { epoch, components } replaces the
    // server's tree for this epoch: sent on activation, when the server does
    // not advertise componentDeltas, as a periodic checkpoint, or when the
    // delta would be larger than the tree. Otherwise the delta form
    // { epoch, added, removed } (removed ids first, ≤ 2 000 entries per
    // message, added in registration order = parents first).
    _sendUpdate(forceFull) {
      // Nobody watching: keep the registry, skip the O(N) payload. A full
      // snapshot is sent on activation (§6.3).
      if (!this._active) return;
      const t0 = performance.now();
      const CHUNK = 2000;
      const CHECKPOINT_MS = 30000;
      const pending = this._pendingAdded.size + this._pendingRemoved.size;
      const full =
        forceFull ||
        !this._componentDeltas ||
        t0 - this._lastFullAt >= CHECKPOINT_MS ||
        pending > this._instances.size;
      const toEntry = (instance) => ({
        id: instance.id,
        file: instance.file,
        name: instance.name,
        parentId: instance.parentId,
        mounted: instance.mounted,
      });
      let bytes = 0;
      const msgs = [];
      if (full) {
        const components = [];
        for (const [, instance] of this._instances) {
          if (instance.mounted) {
            components.push(toEntry(instance));
            bytes += instance.file.length + instance.name.length + 72;
          }
        }
        msgs.push({ epoch: this._epoch, reset: true, components });
        this._lastFullAt = t0;
      } else if (pending > 0) {
        const removed = [...this._pendingRemoved];
        const added = [];
        for (const id of this._pendingAdded) {
          const instance = this._instances.get(id);
          if (instance && instance.mounted) {
            added.push(toEntry(instance));
            bytes += instance.file.length + instance.name.length + 72;
          }
        }
        bytes += removed.length * 8;
        for (let r = 0; r < removed.length; r += CHUNK) {
          msgs.push({ epoch: this._epoch, added: [], removed: removed.slice(r, r + CHUNK) });
        }
        for (let a = 0; a < added.length; a += CHUNK) {
          msgs.push({ epoch: this._epoch, added: added.slice(a, a + CHUNK), removed: [] });
        }
      }
      this._pendingAdded.clear();
      this._pendingRemoved.clear();
      if (import.meta.hot) {
        for (const msg of msgs) import.meta.hot.send('svelte-devtools:components', msg);
      }
      this._componentsCost = { ms: performance.now() - t0, bytes };
    },

    getTree() {
      const components = [];
      for (const [, instance] of this._instances) {
        if (instance.mounted) {
          components.push({
            id: instance.id,
            file: instance.file,
            name: instance.name,
            parentId: instance.parentId,
            mounted: instance.mounted,
          });
        }
      }
      return components;
    },

    // --- Phase 2: Render Profiling ---

    startInit(id) {
      this._initStartTimes.set(id, performance.now());
    },

    endInit(id) {
      const start = this._initStartTimes.get(id);
      if (start === undefined) return;
      const initTime = performance.now() - start;
      this._initStartTimes.delete(id);
      const instance = this._instances.get(id);
      if (!instance) return;
      this._profiles.set(id, {
        componentId: id,
        file: instance.file,
        name: instance.name,
        initTime,
        renderCount: 0,
        totalRenderTime: 0,
        lastRenderTime: 0,
        lastRenderAt: Date.now(),
      });
      this._scheduleProfileUpdate();
    },

    recordRender(id) {
      const profile = this._profiles.get(id);
      if (!profile) {
        const instance = this._instances.get(id);
        if (!instance) return;
        this._profiles.set(id, {
          componentId: id,
          file: instance.file,
          name: instance.name,
          initTime: 0,
          renderCount: 1,
          totalRenderTime: 0,
          lastRenderTime: 0,
          lastRenderAt: Date.now(),
        });
      } else {
        profile.renderCount++;
        profile.lastRenderAt = Date.now();
      }
      this._scheduleProfileUpdate();
    },

    recordRenderTime(id, duration) {
      const profile = this._profiles.get(id);
      if (profile) {
        profile.totalRenderTime += duration;
        profile.lastRenderTime = duration;
      }
    },

    // Profiles push (review P-1 Option A; contract in
    // docs/performance-status.md). Throttled like components, but the floor
    // grows with the payload: every push carries the whole retained map, so
    // a large app coalesces bursts instead of resending ~1 MB twice a second.
    // Hard cap 2 s (contract R6): a slow serialization must not stretch the
    // latency beyond it.
    _profileInterval() {
      const cost = this._profilesCost;
      return Math.min(
        2000,
        Math.max(500, 20 * cost.ms, cost.bytes > 1000000 ? 2000 : cost.bytes > 250000 ? 1000 : 0),
      );
    },

    _scheduleProfileUpdate() {
      if (!this._active || this._profileDebounceTimer) return;
      this._profileDebounceTimer = setTimeout(() => {
        this._profileDebounceTimer = null;
        this._sendProfileUpdate();
      }, this._profileInterval());
    },

    // Also the forced path (activation / resync): a pending throttled push is
    // cancelled so the same state is not sent twice.
    _sendProfileUpdate() {
      if (this._profileDebounceTimer) {
        clearTimeout(this._profileDebounceTimer);
        this._profileDebounceTimer = null;
      }
      if (!this._active) return;
      const t0 = performance.now();
      const all = Array.from(this._profiles.values());
      // Exactly what the collector retains: its tail, in the same order.
      const profiles = all.length > this._profileCap ? all.slice(all.length - this._profileCap) : all;
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:profiles', { epoch: this._epoch, profiles });
      }
      // Payload size from a small sample (entries differ mainly by file path).
      const k = Math.min(8, profiles.length);
      let sampled = 0;
      for (let i = 0; i < k; i++) sampled += JSON.stringify(profiles[i]).length;
      const bytes = k > 0 ? Math.round((sampled / k) * profiles.length) : 0;
      this._profilesCost = { ms: performance.now() - t0, bytes };
    },

    getProfiles() {
      return Array.from(this._profiles.values());
    },

    resetProfiles() {
      this._profiles.clear();
      this._scheduleProfileUpdate();
    },

    // --- Phase 2: Reactive Graph Tracking ---

    trackState(signal, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef(signal),
        meta: { id: nodeId, type: 'state', name, componentId, componentFile: instance ? instance.file : '' }
      });
      this._indexNode(nodeId, componentId);
    },

    trackProxy(proxy, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveProxies.set(nodeId, new WeakRef(proxy));
      // The proxy itself stays weakly held (_reactiveProxies). The marker is
      // held strongly so the node is not GC-dropped while the component lives;
      // _cleanupComponent removes it on unmount.
      const marker = { v: '(proxy)', _isProxy: true };
      this._reactiveNodes.set(nodeId, {
        signal: { deref: () => marker },
        meta: { id: nodeId, type: 'state', name, componentId, componentFile: instance ? instance.file : '' }
      });
      this._indexNode(nodeId, componentId);
    },

    trackDerived(signal, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef(signal),
        meta: { id: nodeId, type: 'derived', name, componentId, componentFile: instance ? instance.file : '' }
      });
      this._indexNode(nodeId, componentId);
    },

    trackEffect(effect, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef(effect || { v: undefined, _isEffect: true }),
        meta: { id: nodeId, type: 'effect', name, componentId, componentFile: instance ? instance.file : '' }
      });
      this._indexNode(nodeId, componentId);
      return effect;
    },

    _graphNode(nodeId, entry, signal) {
      const node = { ...entry.meta };
      if (signal._isProxy) {
        const proxy = this._reactiveProxies.get(nodeId)?.deref();
        if (proxy) {
          try {
            node.value = Array.isArray(proxy) ? '[' + proxy.length + ']' : '{' + Object.keys(proxy).length + '}';
          } catch { node.value = '(proxy)'; }
        }
      } else if (node.type !== 'effect' && signal.v !== undefined && typeof signal.v !== 'symbol') {
        try {
          const v = signal.v;
          if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) {
            node.value = v;
          } else {
            node.value = '(object)';
          }
        } catch { /* ignore */ }
      }
      return node;
    },

    // Full graph, or — with componentId — only that component's nodes plus
    // the nodes they are directly connected to (via deps / reactions through
    // untracked intermediates). Scoped requests keep the user's app cheap on
    // huge apps (no BFS over every node).
    getReactiveGraph(componentId) {
      const scoped = componentId !== undefined && componentId !== null;
      const edges = [];
      const signalToId = new Map();
      const live = new Map();

      for (const [nodeId, entry] of this._reactiveNodes) {
        const signal = entry.signal.deref();
        if (!signal || !this._instances.has(entry.meta.componentId)) {
          this._forgetNode(nodeId);
          this._pollIds = null;
          continue;
        }
        signalToId.set(signal, nodeId);
        live.set(nodeId, signal);
      }

      // Drop proxy refs whose proxy was collected or whose component is gone.
      for (const [nodeId, ref] of this._reactiveProxies) {
        if (!ref.deref() || !live.has(nodeId)) this._reactiveProxies.delete(nodeId);
      }

      const roots = scoped
        ? [...(this._nodesByComponent.get(componentId) || [])].filter((id) => live.has(id))
        : [...live.keys()];
      const included = new Set(roots);
      const edgeSet = new Set();
      const addEdge = (from, to) => {
        const key = from + '>' + to;
        if (from !== to && !edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from, to });
          included.add(from);
          included.add(to);
        }
      };
      // Walk a signal's neighbours (deps or reactions) through untracked
      // intermediates until tracked nodes are reached.
      const walk = (start, field, onHit) => {
        if (!start) return;
        const visited = new Set();
        const queue = [...start];
        // Index cursor instead of queue.shift(): shift is O(queue) per pop.
        for (let qi = 0; qi < queue.length; qi++) {
          const dep = queue[qi];
          if (!dep || visited.has(dep)) continue;
          visited.add(dep);
          const id = signalToId.get(dep);
          if (id) onHit(id);
          else if (dep[field]) for (const d of dep[field]) queue.push(d);
        }
      };

      for (const nodeId of roots) {
        const signal = live.get(nodeId);
        walk(signal.deps, 'deps', (depId) => addEdge(depId, nodeId));
        if (scoped) walk(signal.reactions, 'reactions', (rId) => addEdge(nodeId, rId));
      }

      const nodes = [];
      for (const nodeId of included) {
        nodes.push(this._graphNode(nodeId, this._reactiveNodes.get(nodeId), live.get(nodeId)));
      }
      return { nodes, edges };
    },

    sendReactiveGraph(request) {
      const graph = this.getReactiveGraph(request && request.componentId);
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:reactive-graph', graph);
      }
    },

    // --- Phase 3: State Timeline ---

    // Current value of a $state node: the signal value, or for tag_proxy
    // nodes (non-reassigned object/array state) the live proxy itself.
    // Returns a sentinel when the value can't be read.
    _readStateValue(nodeId, signal) {
      if (signal._isProxy) {
        const proxy = this._reactiveProxies.get(nodeId)?.deref();
        return proxy === undefined ? __NO_VALUE : proxy;
      }
      const v = signal.v;
      // Svelte's UNINITIALIZED marker is a symbol; functions aren't state data.
      return typeof v === 'symbol' || typeof v === 'function' ? __NO_VALUE : v;
    },

    // Runs every 200 ms in the user's app, so it must stay cheap regardless of
    // how much state the app holds.
    //  1. Hint pass, every node every tick (O(1) each): primitives are compared
    //     directly and recorded at once; objects whose reference or Svelte
    //     write version (wv) changed are queued for serialization at once.
    //  2. Serialization work is limited to BUDGET_MS per tick (queued nodes
    //     carry over, nothing is dropped).
    //  3. In-place deep mutations (proxies don't bump an outer wv) are found by
    //     time-based re-checks: each object is re-verified no earlier than
    //     nextCheckAt = now + max(RECHECK_MS, 50 x its serialization cost),
    //     paid from a DEEP_MS-per-tick credit, so the amortized cost is bounded
    //     however many large states the app holds.
    //  4. Values serializing above MAX_SNAPSHOT_CHARS are kept as length+hash
    //     (not the string) and appear in the timeline as a summary.
    _pollStateValues() {
      const BUDGET_MS = 2;
      const DEEP_MS = 0.5;
      const now = performance.now();
      this._deepCredit = Math.min(10 * DEEP_MS, (this._deepCredit || 0) + DEEP_MS);
      if (!this._pollIds) {
        const ids = [];
        for (const [nodeId, entry] of this._reactiveNodes) {
          if (entry.meta.type === 'state') ids.push(nodeId);
        }
        this._pollIds = ids;
      }
      const ids = this._pollIds;
      const n = ids.length;
      if (n === 0) return;
      const dirty = [];
      const due = [];
      // Rotate the start so due/dirty ties are served round-robin.
      const offset = this._pollCursor % n;
      this._pollCursor = offset + 1;
      for (let k = 0; k < n; k++) {
        const nodeId = ids[(offset + k) % n];
        const entry = this._reactiveNodes.get(nodeId);
        if (!entry) continue;
        if (!this._instances.has(entry.meta.componentId)) {
          this._forgetNode(nodeId);
          this._pollIds = null;
          continue;
        }
        const signal = entry.signal.deref();
        if (!signal) continue;
        const value = this._readStateValue(nodeId, signal);
        if (value === __NO_VALUE) continue;
        if (value === null || typeof value !== 'object') {
          const had = this._stateSnapshots.has(nodeId);
          const prev = this._stateSnapshots.get(nodeId);
          if (had && Object.is(prev, value)) continue;
          // Forget the object key so object -> primitive -> same object again
          // is still recorded as a change.
          if (this._stateSnapshotStrs) this._stateSnapshotStrs.delete(nodeId);
          this._recordChange(nodeId, entry, had ? prev : null, value, typeof value === 'string' ? 2 * value.length : 64);
          continue;
        }
        let meta = this._pollMeta.get(nodeId);
        if (!meta) {
          meta = { ref: undefined, wv: undefined, nextCheckAt: 0 };
          this._pollMeta.set(nodeId, meta);
        }
        if (meta.ref !== value || meta.wv !== signal.wv) dirty.push(nodeId);
        else if (now >= meta.nextCheckAt) due.push(nodeId);
      }
      const start = performance.now();
      for (const nodeId of dirty) {
        if (performance.now() - start > BUDGET_MS) return;
        this._serializeNode(nodeId, false);
      }
      for (const nodeId of due) {
        if (this._deepCredit <= 0 || performance.now() - start > BUDGET_MS) return;
        this._serializeNode(nodeId, true);
      }
    },

    _serializeNode(nodeId, deep) {
      const MAX_SNAPSHOT_CHARS = 32768;
      const RECHECK_MS = 1000;
      const entry = this._reactiveNodes.get(nodeId);
      const meta = this._pollMeta.get(nodeId);
      if (!entry || !meta) return;
      const signal = entry.signal.deref();
      if (!signal) return;
      const value = this._readStateValue(nodeId, signal);
      if (value === __NO_VALUE || value === null || typeof value !== 'object') return;
      try {
        const t0 = performance.now();
        const str = JSON.stringify(value);
        const cost = performance.now() - t0;
        if (deep) this._deepCredit -= cost;
        meta.ref = value;
        meta.wv = signal.wv;
        meta.nextCheckAt = t0 + Math.max(RECHECK_MS, 50 * cost);
        // Small values keep the string (exact compare); large ones only a
        // length+hash so a 5 MB array doesn't pin 5 MB per node.
        const key = str === undefined ? '' : str.length > MAX_SNAPSHOT_CHARS ? str.length + ':' + __hash(str) : str;
        if (!this._stateSnapshotStrs) this._stateSnapshotStrs = new Map();
        const had = this._stateSnapshotStrs.has(nodeId);
        if (had && this._stateSnapshotStrs.get(nodeId) === key) return;
        this._stateSnapshotStrs.set(nodeId, key);
        const snapshot =
          str === undefined
            ? null
            : str.length > MAX_SNAPSHOT_CHARS
              ? '(object: ' + str.length + ' chars, too large to snapshot)'
              : JSON.parse(str);
        const prev = this._stateSnapshots.get(nodeId);
        const size = typeof snapshot === 'string' ? 64 : str.length;
        this._recordChange(nodeId, entry, prev !== undefined ? prev : null, snapshot, size + (this._lastSnapshotSize.get(nodeId) || 0));
        this._lastSnapshotSize.set(nodeId, size);
      } catch { /* ignore non-serializable (cycles, BigInt) */ }
    },

    _recordChange(nodeId, entry, oldValue, newValue, approxBytes) {
      if (this._stateTimeline.length >= 500) this._stateTimeline.splice(0, this._stateTimeline.length - 499);
      const change = {
        id: nodeId,
        name: entry.meta.name,
        componentFile: entry.meta.componentFile,
        oldValue,
        newValue,
        timestamp: Date.now(),
      };
      // seq stays runtime-internal: the server assigns its own seq (§6.4).
      this._entryInfo.set(change, { seq: ++this._timelineSeq, bytes: (approxBytes || 64) + 192 });
      this._stateTimeline.push(change);
      this._stateSnapshots.set(nodeId, newValue);
      this._scheduleTimelineUpdate();
    },

    // Debounced delta push (docs/devframe-migration.md §6.4): only entries
    // recorded since the previous push, ≤ 200 per message, tagged with a
    // per-page-load epoch; reset after clearStateTimeline().
    _scheduleTimelineUpdate() {
      if (!this._active) return;
      if (this._timelineDebounceTimer) clearTimeout(this._timelineDebounceTimer);
      this._timelineDebounceTimer = setTimeout(() => {
        this._timelineDebounceTimer = null;
        if (!import.meta.hot) return;
        for (const msg of this._timelineDeltas()) {
          import.meta.hot.send('svelte-devtools:state-timeline', msg);
        }
      }, 300);
    },

    _timelineDeltas() {
      const all = this._stateTimeline;
      let start = all.length;
      while (start > 0 && this._entryInfo.get(all[start - 1]).seq > this._pushedSeq) start--;
      const pending = all.slice(start);
      const msgs = [];
      for (let i = 0; i < pending.length || (this._timelineReset && i === 0); i += 200) {
        const msg = { epoch: this._epoch, changes: pending.slice(i, i + 200) };
        if (i === 0 && this._timelineReset) msg.reset = true;
        msgs.push(msg);
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return msgs;
    },

    // Full buffer (reset: true) — reply to request-state-timeline and the
    // activation snapshot. Newest entries first up to TIMELINE_BYTES, the
    // server's own buffer budget, so nothing is sent that it would drop.
    _timelineFull() {
      const TIMELINE_BYTES = 4 * 1024 * 1024;
      const all = this._stateTimeline;
      let start = all.length;
      let bytes = 0;
      while (start > 0) {
        const size = this._entryInfo.get(all[start - 1]).bytes;
        if (bytes + size > TIMELINE_BYTES && start < all.length) break;
        bytes += size;
        start--;
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return { epoch: this._epoch, changes: all.slice(start), reset: true };
    },

    getStateTimeline() {
      return this._stateTimeline;
    },

    clearStateTimeline() {
      this._stateTimeline = [];
      this._pushedSeq = this._timelineSeq;
      this._timelineReset = true;
      this._scheduleTimelineUpdate();
    },

    // --- FPS Monitoring ---
    // Uses requestAnimationFrame to measure frame rate with minimal overhead.
    // Only stores timestamps - no allocations per frame beyond a single array push.
    _fpsFrameTimes: [],

    _fpsLoop(gen) {
      if (gen !== this._fpsGen) return;
      this._fpsFrameTimes.push(performance.now());
      requestAnimationFrame(() => this._fpsLoop(gen));
    },

    _isVisible() {
      return typeof document === 'undefined' || document.visibilityState !== 'hidden';
    },

    _setSubscription(data) {
      const wasActive = this._active;
      this._active = !!(data && data.active);
      this._componentDeltas = !!(data && data.componentDeltas);
      if (!this._active) {
        this._pendingAdded.clear();
        this._pendingRemoved.clear();
      }
      // resync: the server holds no full base for this epoch (§6.5, review
      // C1), or we reconnected to a possibly restarted server.
      const resync = this._resync || !!(data && data.resync);
      this._resync = false;
      if (this._active && (!wasActive || resync)) {
        // Collector state may be stale or empty (first activation, resync, or a
        // reconnect to a possibly restarted server): resend everything once, in
        // the order components -> profiles -> timeline(reset: true); the
        // reset push marks the activation snapshot complete (D4).
        this._sendUpdate(true);
        this._sendProfileUpdate();
        if (import.meta.hot) {
          import.meta.hot.send('svelte-devtools:state-timeline', this._timelineFull());
        }
      }
      this._syncSampling();
    },

    // Sampling (state poll + FPS) runs only while active AND the app tab is
    // visible.
    _syncSampling() {
      const want = this._active && this._isVisible();
      if (want && !this._sampling) {
        this._fpsFrameTimes = [];
        const gen = ++this._fpsGen;
        this._sampling = {
          poll: setInterval(() => { this._pollStateValues(); }, 200),
          fps: setInterval(() => { this._sampleFps(); }, 500),
        };
        requestAnimationFrame(() => this._fpsLoop(gen));
      } else if (!want && this._sampling) {
        clearInterval(this._sampling.poll);
        clearInterval(this._sampling.fps);
        this._sampling = null;
        this._fpsGen++;
        this._fpsFrameTimes = [];
      }
    },

    _sampleFps() {
      const now = performance.now();
      // Remove frame timestamps older than 1 second
      const cutoff = now - 1000;
      let i = 0;
      while (i < this._fpsFrameTimes.length && this._fpsFrameTimes[i] < cutoff) i++;
      if (i > 0) this._fpsFrameTimes.splice(0, i);
      const fps = this._fpsFrameTimes.length;
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:fps', { timestamp: Date.now(), fps });
      }
    }
  };

  window.__SVELTE_DEVTOOLS__ = __SVELTE_DT;

  // State polling and FPS sampling start on the server's subscription
  // message (§6.3) and pause while the app tab is hidden.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => __SVELTE_DT._syncSampling());
  }

  // Phase 3: Capture runtime errors
  window.addEventListener('error', (event) => {
    if (import.meta.hot) {
      import.meta.hot.send('svelte-devtools:runtime-error', {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack || '',
        timestamp: Date.now(),
      });
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (import.meta.hot) {
      const reason = event.reason;
      import.meta.hot.send('svelte-devtools:runtime-error', {
        message: reason?.message || String(reason),
        stack: reason?.stack || '',
        timestamp: Date.now(),
      });
    }
  });

  // Listen for reactive graph requests from server
  // Pull requests are answered regardless of the subscription state.
  if (import.meta.hot) {
    import.meta.hot.on('svelte-devtools:subscription', (data) => {
      __SVELTE_DT._setSubscription(data);
    });
    import.meta.hot.on('vite:ws:connect', () => {
      // The server may have restarted with an empty collector: the reply to
      // runtime-ready is treated as a fresh activation (full snapshot).
      __SVELTE_DT._resync = true;
      import.meta.hot.send('svelte-devtools:runtime-ready', {});
    });
    import.meta.hot.send('svelte-devtools:runtime-ready', {});
    import.meta.hot.on('svelte-devtools:request-reactive-graph', (data) => {
      __SVELTE_DT.sendReactiveGraph(data);
    });
    import.meta.hot.on('svelte-devtools:request-state-timeline', () => {
      import.meta.hot.send('svelte-devtools:state-timeline', __SVELTE_DT._timelineFull());
    });
    import.meta.hot.on('svelte-devtools:clear-state-timeline', () => {
      __SVELTE_DT.clearStateTimeline();
    });
  }
}
`
