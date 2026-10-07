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
// component's own context). The map lives on the runtime (dt._idByContext)
// so the reactive graph can name the component of any effect it reaches.
// Weak map: no leak, no Svelte state touched.
function __parentFromContext() {
  const dt = __dt();
  const effect = __svelte_original.active_effect;
  const ctx = effect ? effect.ctx : null;
  return dt && ctx && dt._idByContext ? dt._idByContext.get(ctx) : undefined;
}

// Owner of a signal/effect created right now: the component whose init (or
// wrapped block callback) is running, else — outside init, e.g. an effect
// created while another effect runs — the component of the active effect.
function __owner() {
  const cid = __currentId();
  if (cid !== null) return cid;
  const fromContext = __parentFromContext();
  return fromContext === undefined ? null : fromContext;
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
            if (own && own.ctx) dt._idByContext.set(own.ctx, id);
            if (own) dt.setComponentEffect(id, own);
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
    const cid = __owner();
    const type = (__pendingSignal.ref === signal) ? __pendingSignal.type : 'state';
    if (dt && cid !== null) {
      const owner = __svelte_original.active_effect;
      if (type === 'derived') {
        dt.trackDerived(signal, name, cid, owner);
      } else {
        dt.trackState(signal, name, cid, owner);
      }
    } else if (dt && dt._moduleFile) {
      // created while a .svelte.js/.ts module body runs (shared state)
      dt.trackModuleSignal(type === 'derived' ? 'derived' : 'state', signal, name);
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
    const cid = __owner();
    if (dt && cid !== null) {
      dt.trackProxy(proxy, name, cid, __svelte_original.active_effect);
    } else if (dt && dt._moduleFile) {
      dt.trackModuleSignal('proxy', proxy, name);
    }
    __pendingSignal.ref = null;
    __pendingSignal.type = null;
  } catch {}
  return result;
}

// --- Effect Tracking ---
//
// A top-level $effect in a component is deferred by Svelte until mount:
// user_effect() returns undefined and the effect object is created later,
// in pop(). So the node is registered now (named per component) and bound
// to the real effect object on its first run, where active_effect IS the
// effect; the Svelte runtime then keeps effect.deps current, which is what
// getReactiveGraph() reads to build edges. The wrapped callback forwards
// this, arguments and the return value (teardown) unchanged.

function __trackUserEffect(original, kind, args) {
  let cid = null;
  let dt = null;
  let fn = null;
  try {
    dt = __dt();
    fn = args[0];
    if (dt && typeof fn === 'function') cid = __owner();
  } catch {}
  if (cid === null) return original.apply(null, args);
  let nodeId = null;
  let bound = false;
  const wrapped = Array.prototype.slice.call(args);
  wrapped[0] = function () {
    if (!bound) {
      bound = true;
      try { dt.bindEffect(nodeId, __svelte_original.active_effect); } catch {}
    }
    return fn.apply(this, arguments);
  };
  try { nodeId = dt.trackUserEffect(kind, cid, __svelte_original.active_effect); } catch {}
  const result = original.apply(null, wrapped);
  if (result && !bound) {
    bound = true;
    try { dt.bindEffect(nodeId, result); } catch {}
  }
  return result;
}

export function user_effect() {
  return __trackUserEffect(__svelte_original.user_effect, 'effect', arguments);
}

export function user_pre_effect() {
  return __trackUserEffect(__svelte_original.user_pre_effect, 'effect_pre', arguments);
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
  const cid = __owner();
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

// A component whose init throws (caught by <svelte:boundary>, or by the
// block's caller) never reaches pop(): its id would stay on both stacks and
// every later signal/child would be attributed to it. On the way out — normal
// or thrown — the stack is cut back to its depth on entry, and ids left
// above it are dropped as aborted inits (registered, never mounted).
function __wrapBlockFn(fn, cid) {
  return function () {
    let depth = -1;
    try { depth = __idStack.length; __idStack.push(cid); } catch {}
    try {
      return fn.apply(this, arguments);
    } finally {
      if (depth !== -1) {
        try {
          if (__idStack.length > depth + 1) {
            const dt = __dt();
            const aborted = __idStack.slice(depth + 1);
            for (let i = aborted.length - 1; i >= 0; i--) {
              try { if (dt) dt.abortInit(aborted[i]); } catch {}
            }
          }
          __idStack.length = depth;
        } catch {}
      }
    }
  };
}

function __wrapBlock(args) {
  const cid = __owner();
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
  // State timeline ring (§6.7 C): every read sees at most 500 entries and
  // __TIMELINE_BYTES (also the server's buffer budget). The raw array may
  // hold up to __TIMELINE_TRIM_AT (2 x the 500 cap) between bulk trims.
  const __TIMELINE_BYTES = 4 * 1024 * 1024;
  const __TIMELINE_TRIM_AT = 1000;
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
    // signal (or proxy marker) -> nodeId, set at track time and removed by
    // _forgetNode: a scoped graph resolves dependencies without scanning
    // every node (§6.7 D).
    _idBySignal: new WeakMap(),
    // proxy -> nodeId (tag_proxy nodes; the marker above is per node)
    _idByProxy: new WeakMap(),
    // Svelte component context -> component id (set by the wrapper on mount)
    _idByContext: new WeakMap(),
    // componentId -> (name -> last suffix) for names declared more than once
    // per instance ({@const} in {#each} items, several $state class instances)
    _nameSeq: new Map(),
    // Module scopes: signals created while a .svelte.js/.ts module body runs
    // (shared state such as \`export const cart = $state(...)\`) belong to a
    // scope per module file. Ids come from the component id counter (never
    // reused, non-negative) but scopes are not components: they are not in
    // _instances / the component tree, and live as long as the page.
    _modules: new Map(),
    _moduleByFile: new Map(),
    // tag_proxy node name -> Set<nodeId>: resolves a proxy's property source
    // (labelled '<name>.prop' by Svelte in dev) to the node of its proxy
    _proxyNames: new Map(),
    // file of the module body running now (set by the module transform)
    _moduleFile: null,
    // componentId -> { effect, effect_pre } counters: effect names are
    // numbered per component, so instances of one file match
    _effectSeq: new Map(),
    // Every tracked node id (dense, swap-remove like _pollIds) for the
    // incremental liveness sweep, and its cursor.
    _sweepIds: [],
    _sweepIndex: new Map(),
    _sweepCursor: 0,
    // Polling bookkeeping (§6.7 D): $state node ids in a dense array kept up
    // to date incrementally (_pollIndex: nodeId -> position; removal is
    // swap-with-last), a cursor carried across ticks, nodes found changed but
    // not yet serialized (_pollDirty), and per-node change hints
    // (nodeId -> { ref, wv, nextCheckAt }).
    _pollIds: [],
    _pollIndex: new Map(),
    _pollCursor: 0,
    _pollDirty: new Set(),
    // Full-sweep bookkeeping: how long the last complete pass over all $state
    // nodes took (ms), for disclosure (= the worst-case detection delay).
    _pollSweep: { startedAt: 0, lastMs: null, nodes: 0 },
    _pollMeta: new Map(),
    _deepCredit: 0,
    _lastSnapshotSize: new Map(),
    _timelineSeq: 0,
    _pushedSeq: 0,
    _timelineReset: false,
    _entryInfo: new WeakMap(),
    // Sum of _entryInfo.bytes over _stateTimeline (runtime byte budget).
    _timelineBytes: 0,
    // Disclosure since the last push (§6.7 C): unsent entries the ring removed
    // (by count / by bytes) and changes recorded only as a size summary.
    _timelineDropped: { 'runtime-count': 0, 'runtime-bytes': 0 },
    _valueTooLarge: 0,

    // Overview aggregate (§6.7 I/J), O(1) per event: registered nodes per
    // component and type (+ app totals), and per-component activity in a
    // ring of 60 one-second buckets (sampled changes, renders, render ms,
    // plus how long sampling ran in that second).
    _nodeCounts: new Map(),
    _nodeTotals: { state: 0, derived: 0, effect: 0 },
    _activity: [],
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
    _baselining: false,
    // Polled state nodes not observed yet (no seed value). Their first
    // observation is a seed, not a change: no timeline entry, no activity
    // count, no drops — the old value is unknown, not null (review B-1/B-2).
    _unseeded: new Set(),
    // pendingNodes last sent on a state-timeline message (null = none yet)
    _sentPendingNodes: null,
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
      this._effectSeq.delete(id);
      this._nameSeq.delete(id);
      this._instances.delete(id);
      this._profiles.delete(id);
      this._initStartTimes.delete(id);
    },

    _cleanupReactiveNodes(componentId) {
      const nodeIds = this._nodesByComponent.get(componentId);
      if (!nodeIds) return;
      this._nodesByComponent.delete(componentId);
      for (const nodeId of [...nodeIds]) this._forgetNode(nodeId);
    },

    _forgetNode(nodeId) {
      const entry = this._reactiveNodes.get(nodeId);
      if (entry) {
        this._countNode(entry.meta.componentId, entry.meta.type, -1);
        const set = this._nodesByComponent.get(entry.meta.componentId);
        if (set) set.delete(nodeId);
      }
      const signal = entry && entry.signal.deref();
      if (signal && this._idBySignal.get(signal) === nodeId) this._idBySignal.delete(signal);
      const proxy = this._reactiveProxies.get(nodeId)?.deref();
      if (proxy && this._idByProxy.get(proxy) === nodeId) this._idByProxy.delete(proxy);
      if (entry && this._reactiveProxies.has(nodeId)) {
        const named = this._proxyNames.get(entry.meta.name);
        if (named) {
          named.delete(nodeId);
          if (named.size === 0) this._proxyNames.delete(entry.meta.name);
        }
      }
      this._pollRemove(nodeId);
      this._sweepRemove(nodeId);
      this._pollDirty.delete(nodeId);
      this._reactiveNodes.delete(nodeId);
      this._reactiveProxies.delete(nodeId);
      this._stateSnapshots.delete(nodeId);
      if (this._stateSnapshotStrs) this._stateSnapshotStrs.delete(nodeId);
      this._pollMeta.delete(nodeId);
      this._lastSnapshotSize.delete(nodeId);
    },

    // A component instance or a module scope that is still live.
    _scopeLive(id) {
      return this._instances.has(id) || this._modules.has(id);
    },

    _scopeFile(id) {
      const scope = this._instances.get(id) || this._modules.get(id);
      return scope ? scope.file : '';
    },

    _enterModule(file) {
      this._moduleFile = file;
      // a module body that throws (or awaits) never reaches _leaveModule
      queueMicrotask(() => {
        if (this._moduleFile === file) this._moduleFile = null;
      });
    },

    _leaveModule() {
      this._moduleFile = null;
    },

    trackModuleSignal(kind, target, name) {
      const file = this._moduleFile;
      let id = this._moduleByFile.get(file);
      if (id === undefined) {
        id = this._nextId++;
        const base = file.split('/').pop() || file;
        this._modules.set(id, { id, file, name: base, kind: 'module' });
        this._moduleByFile.set(file, id);
      }
      if (kind === 'proxy') this.trackProxy(target, name, id, null);
      else if (kind === 'derived') this.trackDerived(target, name, id, null);
      else this.trackState(target, name, id, null);
    },

    // A node is live while its signal is reachable, its component is mounted,
    // and the effect it was created in (an {#each} item, an effect run) has
    // not been destroyed. Svelte nulls effect.fn when it destroys an effect
    // (internal/client destroy_effect), which is checked instead of the
    // internal DESTROYED flag value. Returns the signal or null.
    _liveSignal(nodeId) {
      const entry = this._reactiveNodes.get(nodeId);
      if (!entry) return null;
      const signal = entry.signal.deref();
      if (signal && this._scopeLive(entry.meta.componentId) && this._ownerAlive(entry)) {
        if (!entry.effect) return signal;
        // a bound effect is destroyed when Svelte clears its callback
        if (signal.fn !== null) return signal;
      }
      this._forgetNode(nodeId);
      return null;
    },

    _ownerAlive(entry) {
      if (!entry.owner) return true;
      const owner = entry.owner.deref();
      return !!owner && owner.fn !== null;
    },

    _sweepAdd(nodeId) {
      if (this._sweepIndex.has(nodeId)) return;
      this._sweepIndex.set(nodeId, this._sweepIds.length);
      this._sweepIds.push(nodeId);
    },

    _sweepRemove(nodeId) {
      const i = this._sweepIndex.get(nodeId);
      if (i === undefined) return;
      const ids = this._sweepIds;
      const last = ids.pop();
      this._sweepIndex.delete(nodeId);
      if (i < ids.length) {
        ids[i] = last;
        this._sweepIndex.set(last, i);
      }
    },

    // Liveness of up to \`max\` nodes, continuing from a cursor (each poll
    // tick): nodes of destroyed {#each} items / effect runs leave the counts
    // and the graph without waiting for a graph request or GC.
    _sweepNodes(max) {
      const ids = this._sweepIds;
      for (let n = 0; n < max && ids.length > 0; n++) {
        if (this._sweepCursor >= ids.length) this._sweepCursor = 0;
        const nodeId = ids[this._sweepCursor];
        // a forgotten node's slot is refilled by the last id: re-check it
        if (this._liveSignal(nodeId)) this._sweepCursor++;
      }
    },

    // Unique node id for a signal: componentId:name, or componentId:name#k
    // when this instance already holds a live node of that name for another
    // signal. The same signal (re-tagged) keeps its id.
    _nodeIdFor(identity, byIdentity, componentId, name) {
      const known = byIdentity.get(identity);
      if (known !== undefined && this._reactiveNodes.has(known)) return known;
      const base = componentId + ':' + name;
      if (!this._reactiveNodes.has(base) || !this._liveSignal(base)) return base;
      let seq = this._nameSeq.get(componentId);
      if (!seq) {
        seq = new Map();
        this._nameSeq.set(componentId, seq);
      }
      let k = seq.get(name) || 1;
      let id;
      do {
        k++;
        id = base + '#' + k;
      } while (this._reactiveNodes.has(id) && this._liveSignal(id));
      seq.set(name, k);
      return id;
    },

    _registerNode(nodeId, componentId, type, name, signalRef, owner, extra) {
      this._trackNodeCount(nodeId, componentId, type);
      const entry = {
        signal: signalRef,
        owner: owner ? new WeakRef(owner) : null,
        meta: { id: nodeId, type, name, componentId, componentFile: this._scopeFile(componentId) },
      };
      if (extra) Object.assign(entry, extra);
      this._reactiveNodes.set(nodeId, entry);
      this._indexNode(nodeId, componentId);
      this._sweepAdd(nodeId);
      return entry;
    },

    _indexNode(nodeId, componentId) {
      let set = this._nodesByComponent.get(componentId);
      if (!set) {
        set = new Set();
        this._nodesByComponent.set(componentId, set);
      }
      set.add(nodeId);
    },

    _pollAdd(nodeId) {
      if (this._pollIndex.has(nodeId)) return;
      if (!this._stateSnapshots.has(nodeId)) this._unseeded.add(nodeId);
      this._pollIndex.set(nodeId, this._pollIds.length);
      this._pollIds.push(nodeId);
    },

    // O(1): the last id takes the removed slot. If that slot is behind the
    // cursor, the moved id is visited in the next sweep instead of this one
    // (still visited within a bounded number of ticks).
    // Before a track* call replaces/creates nodeId: move the count from the
    // previous registration (same name re-tracked) to the new one.
    _trackNodeCount(nodeId, componentId, type) {
      const prev = this._reactiveNodes.get(nodeId);
      if (prev) this._countNode(prev.meta.componentId, prev.meta.type, -1);
      this._countNode(componentId, type, 1);
    },

    _countNode(componentId, type, d) {
      const kind = type === 'derived' || type === 'effect' ? type : 'state';
      let c = this._nodeCounts.get(componentId);
      if (!c) {
        if (d < 0) return;
        c = { state: 0, derived: 0, effect: 0 };
        this._nodeCounts.set(componentId, c);
      }
      c[kind] += d;
      this._nodeTotals[kind] += d;
      if (c.state + c.derived + c.effect <= 0) this._nodeCounts.delete(componentId);
    },

    _bucket() {
      const sec = Math.floor(performance.now() / 1000);
      const slot = ((sec % 60) + 60) % 60;
      let b = this._activity[slot];
      if (!b || b.second !== sec) {
        b = { second: sec, sampledMs: 0, rows: new Map() };
        this._activity[slot] = b;
      }
      return b;
    },

    _activityRow(componentId) {
      const rows = this._bucket().rows;
      let r = rows.get(componentId);
      if (!r) {
        r = { changes: 0, renders: 0, renderMs: 0 };
        rows.set(componentId, r);
      }
      return r;
    },

    _pollRemove(nodeId) {
      const i = this._pollIndex.get(nodeId);
      if (i === undefined) return;
      this._unseeded.delete(nodeId);
      const ids = this._pollIds;
      const last = ids.pop();
      this._pollIndex.delete(nodeId);
      if (i < ids.length) {
        ids[i] = last;
        this._pollIndex.set(last, i);
      }
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
      this._activityRow(id).renders++;
      this._scheduleProfileUpdate();
    },

    recordRenderTime(id, duration) {
      const profile = this._profiles.get(id);
      if (profile) {
        profile.totalRenderTime += duration;
        profile.lastRenderTime = duration;
        this._activityRow(id).renderMs += duration;
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
        // total = all retained profiles; the message carries the newest-mounted
        // tail (§6.7 J IA1 capture policy 'newest-mounted').
        import.meta.hot.send('svelte-devtools:profiles', { epoch: this._epoch, profiles, total: all.length });
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

    // \`owner\` (optional): the effect active when the signal was created; the
    // node dies with it (an {#each} item's {@const}, a class instance created
    // in an effect run).
    trackState(signal, name, componentId, owner) {
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'state', name, new WeakRef(signal), owner);
      this._idBySignal.set(signal, nodeId);
      this._pollAdd(nodeId);
    },

    trackProxy(proxy, name, componentId, owner) {
      const nodeId = this._nodeIdFor(proxy, this._idByProxy, componentId, name);
      this._reactiveProxies.set(nodeId, new WeakRef(proxy));
      // The proxy itself stays weakly held (_reactiveProxies). The marker is
      // held strongly so the node is not GC-dropped while the component lives;
      // _cleanupComponent removes it on unmount.
      const marker = { v: '(proxy)', _isProxy: true };
      this._registerNode(nodeId, componentId, 'state', name, { deref: () => marker }, owner);
      this._idBySignal.set(marker, nodeId);
      this._idByProxy.set(proxy, nodeId);
      let named = this._proxyNames.get(name);
      if (!named) {
        named = new Set();
        this._proxyNames.set(name, named);
      }
      named.add(nodeId);
      this._pollAdd(nodeId);
    },

    trackDerived(signal, name, componentId, owner) {
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'derived', name, new WeakRef(signal), owner);
      this._idBySignal.set(signal, nodeId);
    },

    // A user effect object (already created). Kept for callers that have one.
    trackEffect(effect, name, componentId) {
      const nodeId = componentId + ':' + name;
      const target = effect || { v: undefined, _isEffect: true };
      this._registerNode(nodeId, componentId, 'effect', name, effect ? new WeakRef(target) : { deref: () => target });
      this._idBySignal.set(target, nodeId);
      return effect;
    },

    // $effect / $effect.pre being created now (the wrapper). The effect object
    // may not exist yet (deferred to mount): the node holds a placeholder
    // until bindEffect() is called on the effect's first run. kind: 'effect'
    // | 'effect_pre'; names are effect_1, effect_pre_1, ... per component.
    trackUserEffect(kind, componentId, owner) {
      let seq = this._effectSeq.get(componentId);
      if (!seq) {
        seq = { effect: 0, effect_pre: 0 };
        this._effectSeq.set(componentId, seq);
      }
      const name = kind + '_' + ++seq[kind];
      const nodeId = componentId + ':' + name;
      const placeholder = { v: undefined, _isEffect: true };
      this._registerNode(nodeId, componentId, 'effect', name, { deref: () => placeholder }, owner);
      return nodeId;
    },

    bindEffect(nodeId, effect) {
      const entry = nodeId !== null && this._reactiveNodes.get(nodeId);
      if (!entry || !effect || typeof effect !== 'object') return;
      entry.signal = new WeakRef(effect);
      entry.effect = true;
      this._idBySignal.set(effect, nodeId);
    },

    // The component's mount hook effect (the wrapper's, created at pop): its
    // parent is the effect the component's markup effects were created in.
    setComponentEffect(id, effect) {
      const instance = this._instances.get(id);
      if (instance) instance.hook = new WeakRef(effect);
    },

    // Markup effects of a component: the effects of its template
    // (template_effect, {#if}/{#each}/... blocks, <svelte:head>), i.e. the
    // effects under the hook's parent created in the component's context
    // (effect.ctx), without descending into other components or the
    // tracked $effect nodes. Svelte links child effects via first/next.
    _markupEffects(id) {
      const instance = this._instances.get(id);
      const hook = instance && instance.hook && instance.hook.deref();
      if (!hook || !hook.ctx || !hook.parent) return [];
      const ctx = hook.ctx;
      const out = [];
      const stack = [];
      for (let e = hook.parent.first; e; e = e.next) stack.push(e);
      while (stack.length) {
        const e = stack.pop();
        if (e === hook || e.ctx !== ctx) continue;
        if (e.deps && !this._idBySignal.has(e)) out.push(e);
        for (let c = e.first; c; c = c.next) stack.push(c);
      }
      return out;
    },

    // The tracked node a proxy's property source belongs to. Svelte (dev)
    // labels a proxy's sources after the proxy's path ('todos[0].text',
    // 'cart.items.length', 'todos version'); the root name is a tag_proxy
    // node name. Several live nodes may share the name (one per instance):
    // candidates are narrowed by the source's value at that path (identity
    // for objects), then the reader's component, its nearest ancestor,
    // a module scope. null when unresolved.
    _sourceOwner(source, readerCid, liveSignal) {
      const label = source.label;
      if (typeof label !== 'string' || this._proxyNames.size === 0) return null;
      let root = null;
      let rest = '';
      for (let i = label.length; i > 0; i--) {
        const ch = i === label.length ? '' : label[i];
        if (ch !== '' && ch !== '.' && ch !== '[' && ch !== ' ') continue;
        const named = this._proxyNames.get(label.slice(0, i));
        if (named) {
          root = named;
          rest = label.slice(i);
          break;
        }
      }
      if (!root) return null;
      let candidates = [...root].filter((id) => liveSignal(id));
      if (candidates.length > 1) {
        const path = this._labelPath(rest);
        if (path) {
          const v = source.v;
          const same = candidates.filter((id) => {
            const at = this._valueAt(this._reactiveProxies.get(id)?.deref(), path);
            return at !== __NO_VALUE && (Object.is(at, v) || (typeof v === 'symbol' && at === undefined));
          });
          if (same.length > 0) candidates = same;
        }
      }
      if (candidates.length <= 1) return candidates[0] || null;
      const byScope = new Map(candidates.map((id) => [this._reactiveNodes.get(id).meta.componentId, id]));
      for (let cid = readerCid; cid !== null && cid !== undefined; ) {
        if (byScope.has(cid)) return byScope.get(cid);
        const instance = this._instances.get(cid);
        cid = instance ? instance.parentId : null;
      }
      for (const [cid, id] of byScope) if (this._modules.has(cid)) return id;
      return candidates[0];
    },

    // '.items[0].text' -> ['items', '0', 'text']; null for ' version' and
    // anything else that is not a property path.
    _labelPath(rest) {
      const path = [];
      const re = /\\.([A-Za-z_$][\\w$]*)|\\[(\\d+)\\]|\\['((?:[^'\\\\]|\\\\.)*)'\\]/y;
      let m;
      while (re.lastIndex < rest.length && (m = re.exec(rest))) path.push(m[1] ?? m[2] ?? m[3]);
      return re.lastIndex === rest.length || rest.length === 0 ? path : null;
    },

    // Own-property walk (getOwnPropertyDescriptor does not create sources on
    // a Svelte proxy, unlike reading a missing property).
    _valueAt(obj, path) {
      let v = obj;
      for (const key of path) {
        if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return __NO_VALUE;
        let d;
        try { d = Object.getOwnPropertyDescriptor(v, key); } catch { return __NO_VALUE; }
        if (!d) return __NO_VALUE;
        v = 'value' in d ? d.value : __NO_VALUE;
        if (v === __NO_VALUE) return v;
      }
      return v;
    },

    // A component whose init threw (the wrapper unwinds its stack): it never
    // mounted and never will, so it leaves the tree and the init stack.
    abortInit(id) {
      const idx = this._stack.indexOf(id);
      if (idx !== -1) this._stack.splice(idx, 1);
      const instance = this._instances.get(id);
      if (!instance) return;
      if (instance.parentId !== null) {
        const parent = this._instances.get(instance.parentId);
        if (parent) parent.children.delete(id);
      }
      this._removeChildren(id);
      this._cleanupComponent(id);
      this._scheduleUpdate();
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
      } else if (node.type === 'derived' && typeof signal.v === 'symbol') {
        // Svelte computes a derived lazily: until something reads it, v is
        // the UNINITIALIZED marker (a symbol)
        node.unevaluated = true;
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

    // Reactive graph (§6.7 A/D). Caps are applied while building: past
    // maxNodes no node objects are created and only edges whose endpoints
    // are both included are emitted (the rest are counted in edgesOmitted).
    //  - scoped (componentId): that component's nodes plus the tracked nodes
    //    directly connected to them (via deps / reactions through untracked
    //    intermediates). Dependencies are resolved through _idBySignal, so
    //    the cost is O(scope + neighbours), not O(all nodes). The walk is
    //    completed even past the cap, so total.nodes/edges are exact.
    //  - global: nodes in registration order up to maxNodes ('global-head'),
    //    with their incoming dependency edges. Nodes past the cap are not
    //    dereferenced; total.nodes is the registered count (may include
    //    nodes whose signal was already collected, nodesKind 'registered')
    //    and total.edges is null when the walk stopped early (not guessed).
    // Template consumers: the compiler turns every dynamic part of the markup
    // ({expr}, attributes, {#if}/{#each}/{#key}/{#await} conditions,
    // <svelte:head>) into effects that are not tracked one by one. A read
    // from such an effect is reported as an edge to the synthetic node
    // '<componentId>:(template)' (type 'template') of the component the
    // effect belongs to (effect.ctx), so a value only the markup reads is
    // not shown without readers.
    getReactiveGraph(componentId, caps) {
      const scoped = componentId !== undefined && componentId !== null;
      const maxNodes = this._graphCap(caps && caps.maxNodes, 5000);
      const maxEdges = this._graphCap(caps && caps.maxEdges, 20000);
      const live = new Map();
      // Live signal of a tracked node, or null (forgets dead / unmounted nodes).
      const liveSignal = (nodeId) => {
        if (live.has(nodeId)) return live.get(nodeId);
        const signal = this._liveSignal(nodeId);
        live.set(nodeId, signal);
        return signal;
      };
      const idOf = (dep) => {
        const id = this._idBySignal.get(dep);
        return id !== undefined && liveSignal(id) === dep ? id : null;
      };
      // Synthetic template nodes reached in this build: id -> componentId.
      const templates = new Map();
      // Template node of an untracked effect (no reactions: not a derived),
      // or null when its component is unknown / unmounted.
      const templateOf = (effect) => {
        if (!effect || 'reactions' in effect || !effect.ctx) return null;
        const cid = this._idByContext.get(effect.ctx);
        if (cid === undefined || !this._instances.has(cid)) return null;
        const id = cid + ':(template)';
        templates.set(id, cid);
        return id;
      };

      const included = new Set();
      const seen = new Set();
      const edges = [];
      const edgeSet = new Set();
      let edgesOmitted = 0;
      let truncated = false;
      const see = (id) => {
        seen.add(id);
        if (!included.has(id) && included.size < maxNodes) included.add(id);
        return included.has(id);
      };
      const addEdge = (from, to) => {
        const key = from + '>' + to;
        if (from === to || edgeSet.has(key)) return;
        edgeSet.add(key);
        const inFrom = see(from);
        const inTo = see(to);
        if (inFrom && inTo && edges.length < maxEdges) edges.push({ from, to });
        else edgesOmitted++;
      };
      // Walk a signal's neighbours (deps or reactions) through untracked
      // intermediates until tracked nodes are reached. onTemplate (reactions
      // only) receives the template node of each untracked effect reached.
      // On the deps side an untracked leaf source (a proxy's property) is
      // resolved to its proxy's node (readerCid: the reading component).
      // nodeId -> dependencies on signals devtools does not track (created
      // in node_modules, e.g. SvelteKit's page state, or outside any
      // component/module body): reported so such a node is not "isolated"
      const untracked = new Map();
      const walk = (start, field, onHit, onTemplate, readerCid, onUntracked) => {
        if (!start) return;
        const visited = new Set();
        const queue = [...start];
        // Index cursor instead of queue.shift(): shift is O(queue) per pop.
        for (let qi = 0; qi < queue.length; qi++) {
          const dep = queue[qi];
          if (!dep || visited.has(dep)) continue;
          visited.add(dep);
          const id = idOf(dep);
          if (id) {
            if (onHit) onHit(id);
          } else if (dep[field]) {
            for (const d of dep[field]) queue.push(d);
          } else if (onTemplate) {
            const t = templateOf(dep);
            if (t) onTemplate(t);
          } else if (field === 'deps' && onHit && !('fn' in dep)) {
            const owner = this._sourceOwner(dep, readerCid, liveSignal);
            if (owner) onHit(owner);
            else if (onUntracked) onUntracked();
          }
        }
      };
      const nodeCid = (nodeId) => this._reactiveNodes.get(nodeId).meta.componentId;
      const countUntracked = (nodeId) => () => untracked.set(nodeId, (untracked.get(nodeId) || 0) + 1);
      // Reads of a component's markup effects: edges into its template node
      // (filter: keep only edges from these node ids, for neighbours).
      const markupEdges = (cid, filter) => {
        const effects = this._markupEffects(cid);
        if (effects.length === 0) return;
        const t = cid + ':(template)';
        for (const effect of effects) {
          walk(effect.deps, 'deps', (id) => {
            if (filter && !filter(id)) return;
            templates.set(t, cid);
            addEdge(id, t);
          }, null, cid);
        }
      };

      let totalNodes = 0;
      let totalEdges = null;
      if (scoped) {
        for (const nodeId of [...(this._nodesByComponent.get(componentId) || [])]) {
          const signal = liveSignal(nodeId);
          if (!signal) continue;
          see(nodeId);
          walk(signal.deps, 'deps', (depId) => addEdge(depId, nodeId), null, componentId, countUntracked(nodeId));
          const toReader = (rId) => addEdge(nodeId, rId);
          walk(signal.reactions, 'reactions', toReader, toReader);
        }
        if (this._instances.has(componentId)) markupEdges(componentId, null);
        // Readers in direct children (props): a proxy has no reactions list
        // of its own, so its readers are found from their dependencies.
        const own = (id) => nodeCid(id) === componentId;
        const instance = this._instances.get(componentId);
        for (const child of instance ? instance.children : []) {
          for (const nodeId of [...(this._nodesByComponent.get(child) || [])]) {
            const signal = liveSignal(nodeId);
            if (signal) walk(signal.deps, 'deps', (depId) => own(depId) && addEdge(depId, nodeId), null, child);
          }
          markupEdges(child, own);
        }
        totalNodes = seen.size;
        totalEdges = edgeSet.size;
        truncated = included.size < seen.size || edgesOmitted > 0;
      } else {
        let complete = true;
        for (const nodeId of [...this._reactiveNodes.keys()]) {
          if (included.size >= maxNodes && !included.has(nodeId)) {
            complete = false;
            break;
          }
          const signal = liveSignal(nodeId);
          if (!signal) continue;
          see(nodeId);
          walk(signal.deps, 'deps', (depId) => addEdge(depId, nodeId), null, nodeCid(nodeId), countUntracked(nodeId));
          // tracked readers are found from their own deps; only template
          // readers need the reactions side
          walk(signal.reactions, 'reactions', null, (t) => addEdge(nodeId, t));
        }
        if (complete) for (const cid of this._instances.keys()) markupEdges(cid, null);
        // registered count (+ template nodes reached), minus nodes found
        // dead while building
        totalNodes = this._reactiveNodes.size + templates.size;
        totalEdges = complete ? edgeSet.size : null;
        truncated = !complete || edgesOmitted > 0;
      }

      const nodes = [];
      for (const nodeId of included) {
        const cid = templates.get(nodeId);
        if (cid !== undefined) {
          const instance = this._instances.get(cid);
          nodes.push({ id: nodeId, type: 'template', name: '(template)', componentId: cid, componentFile: instance ? instance.file : '' });
          continue;
        }
        const signal = liveSignal(nodeId);
        if (!signal) continue;
        const node = this._graphNode(nodeId, this._reactiveNodes.get(nodeId), signal);
        if (untracked.has(nodeId)) node.untrackedDeps = untracked.get(nodeId);
        nodes.push(node);
      }
      return {
        scope: scoped ? componentId : null,
        nodes,
        edges,
        total: { nodes: totalNodes, nodesKind: 'registered', edges: totalEdges },
        truncated,
        edgesOmitted,
        policy: scoped ? 'scoped' : 'global-head',
      };
    },

    _graphCap(value, max) {
      const n = Math.floor(Number(value));
      return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : max;
    },

    // Request (§6.7 A + review M1): { requestId?, epoch?, componentId?,
    // maxNodes?, maxEdges? }. A request for another page load (epoch) is not
    // answered by this one; the reply echoes requestId and epoch. An old
    // server sends {} → global graph with the default caps (= its LIMITS).
    sendReactiveGraph(request) {
      const req = request || {};
      if (req.epoch !== undefined && req.epoch !== null && req.epoch !== this._epoch) return;
      const cid = typeof req.componentId === 'number' ? req.componentId : null;
      const graph = this.getReactiveGraph(cid, { maxNodes: req.maxNodes, maxEdges: req.maxEdges });
      graph.epoch = this._epoch;
      // freshness (review): when this answer was built; caches keep it
      graph.computedAt = Date.now();
      if (req.requestId !== undefined) graph.requestId = req.requestId;
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:reactive-graph', graph);
      }
    },

    // Overview aggregate (§6.7 I/J). Built from the activity buckets of the
    // window (whole seconds: the current partial second plus the previous
    // ones, ceil(windowMs / 1000) buckets) — cost O(components active in the
    // window), no graph, no node scan. Rows rank by sampled changes, then
    // renders, then render ms; rows + other = total (components and nodes).
    getReactiveSummary(opts) {
      const o = opts || {};
      const clampInt = (v, lo, hi, d) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
      };
      const topK = clampInt(o.topK, 1, 200, 50);
      const windowMs = clampInt(o.windowMs, 1000, 60000, 10000);
      const nowSec = Math.floor(performance.now() / 1000);
      const agg = new Map();
      let sampledMs = 0;
      for (let k = 0; k < Math.ceil(windowMs / 1000); k++) {
        const sec = nowSec - k;
        const b = this._activity[((sec % 60) + 60) % 60];
        if (!b || b.second !== sec) continue;
        sampledMs += b.sampledMs;
        for (const [cid, r] of b.rows) {
          if (!this._scopeLive(cid)) continue;
          let a = agg.get(cid);
          if (!a) {
            a = { changes: 0, renders: 0, renderMs: 0 };
            agg.set(cid, a);
          }
          a.changes += r.changes;
          a.renders += r.renders;
          a.renderMs += r.renderMs;
        }
      }
      const ranked = [...agg].sort(
        (x, y) =>
          y[1].changes - x[1].changes || y[1].renders - x[1].renders || y[1].renderMs - x[1].renderMs || x[0] - y[0],
      );
      let rowNodes = 0;
      const rows = ranked.slice(0, topK).map(([cid, a]) => {
        const n = this._nodeCounts.get(cid) || { state: 0, derived: 0, effect: 0 };
        rowNodes += n.state + n.derived + n.effect;
        const row = {
          componentId: cid,
          file: this._scopeFile(cid),
          nodes: { state: n.state, derived: n.derived, effect: n.effect },
          changes: a.changes,
          renders: a.renders,
          renderMs: Math.round(a.renderMs * 1000) / 1000,
        };
        // module scope (shared .svelte.js state), not a component instance
        if (this._modules.has(cid)) row.kind = 'module';
        return row;
      });
      const t = this._nodeTotals;
      // module scopes count as rows like components (rows + other = total)
      const scopes = this._instances.size + this._modules.size;
      const until = Date.now();
      return {
        epoch: this._epoch,
        window: { ms: windowMs, since: until - windowMs, until, sampledActiveMs: Math.min(windowMs, sampledMs) },
        policy: 'sampled-200ms',
        coverage: 'component-init',
        components: { total: scopes, withActivity: agg.size },
        rows,
        other: { components: scopes - rows.length, nodes: t.state + t.derived + t.effect - rowNodes },
        truncated: agg.size > topK,
        capabilities: { valueInspection: false, signalHistory: false, writeCause: false },
        // Seed coverage: changes of pending nodes are not observable yet.
        baseline: this._baselineInfo(),
      };
    },

    // Request { requestId?, epoch?, topK?, windowMs? } (same correlation as
    // the graph, review M1).
    sendReactiveSummary(request) {
      const req = request || {};
      if (req.epoch !== undefined && req.epoch !== null && req.epoch !== this._epoch) return;
      const summary = this.getReactiveSummary(req);
      if (req.requestId !== undefined) summary.requestId = req.requestId;
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:reactive-summary', summary);
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
    // how much state the app holds (§6.7 D).
    //  1. Hint pass, time-sliced: at most HINT_NODES $state nodes per tick,
    //     continuing from a cursor carried across ticks, so a full sweep over
    //     n nodes takes ceil(n / HINT_NODES) ticks (_pollSweep.lastMs is the
    //     measured sweep time = worst-case detection delay). Per node O(1):
    //     primitives are compared directly and recorded at once; objects
    //     whose reference or Svelte write version (wv) changed are added to
    //     _pollDirty, which persists across ticks until serialized.
    //  2. Serialization work is limited to BUDGET_MS per tick (dirty nodes
    //     carry over, nothing is dropped).
    //  3. In-place deep mutations (proxies don't bump an outer wv) are found by
    //     time-based re-checks: each object is re-verified no earlier than
    //     nextCheckAt = now + max(RECHECK_MS, 50 x its serialization cost),
    //     paid from a DEEP_MS-per-tick credit, so the amortized cost is bounded
    //     however many large states the app holds.
    //  4. Values serializing above MAX_SNAPSHOT_CHARS are kept as length+hash
    //     (not the string) and appear in the timeline as a summary.
    // Writes between two visits of a node are observed as one change (the
    // timeline is a sample, policy 'sampled-200ms'; not counted as dropped).
    _pollStateValues(baseline) {
      const HINT_NODES = 4096;
      const SWEEP_NODES = 2048;
      const BUDGET_MS = 2;
      const DEEP_MS = 0.5;
      const now = performance.now();
      if (!baseline) {
        // nodes of destroyed {#each} items / effect runs leave the counts
        this._sweepNodes(SWEEP_NODES);
        this._deepCredit = Math.min(10 * DEEP_MS, (this._deepCredit || 0) + DEEP_MS);
        // this tick samples 200 ms of wall time (window.sampledActiveMs)
        const bucket = this._bucket();
        bucket.sampledMs = Math.min(1000, bucket.sampledMs + 200);
      }
      const ids = this._pollIds;
      const due = [];
      const limit = Math.min(HINT_NODES, ids.length);
      for (let visited = 0; visited < limit && ids.length > 0; visited++) {
        if (this._pollCursor >= ids.length) {
          this._pollCursor = 0;
          if (!baseline) {
            if (this._pollSweep.startedAt) this._pollSweep.lastMs = now - this._pollSweep.startedAt;
            this._pollSweep.startedAt = now;
            this._pollSweep.nodes = ids.length;
          }
        }
        if (!baseline && !this._pollSweep.startedAt) this._pollSweep.startedAt = now;
        const nodeId = ids[this._pollCursor];
        const entry = this._reactiveNodes.get(nodeId);
        if (!entry || entry.meta.type !== 'state') {
          // re-tracked as another type: drop from the poll list (slot reused)
          this._pollRemove(nodeId);
          continue;
        }
        if (!this._scopeLive(entry.meta.componentId)) {
          this._forgetNode(nodeId); // swaps the last id into this slot
          continue;
        }
        this._pollCursor++;
        const signal = entry.signal.deref();
        const value = signal ? this._readStateValue(nodeId, signal) : __NO_VALUE;
        if (value === __NO_VALUE) {
          // nothing readable (collected, uninitialized, function): not pending
          this._unseeded.delete(nodeId);
          continue;
        }
        if (value === null || typeof value !== 'object') {
          const had = this._stateSnapshots.has(nodeId);
          const prev = this._stateSnapshots.get(nodeId);
          if (had && Object.is(prev, value)) continue;
          // Forget the object key so object -> primitive -> same object again
          // is still recorded as a change.
          if (this._stateSnapshotStrs) this._stateSnapshotStrs.delete(nodeId);
          this._pollDirty.delete(nodeId);
          if (!had) {
            // first observation: seed only
            this._stateSnapshots.set(nodeId, value);
            this._unseeded.delete(nodeId);
            continue;
          }
          this._recordChange(nodeId, entry, prev, value, typeof value === 'string' ? 2 * value.length : 64);
          continue;
        }
        let meta = this._pollMeta.get(nodeId);
        if (!meta) {
          meta = { ref: undefined, wv: undefined, nextCheckAt: 0 };
          this._pollMeta.set(nodeId, meta);
        }
        if (meta.ref !== value || meta.wv !== signal.wv) this._pollDirty.add(nodeId);
        else if (now >= meta.nextCheckAt) due.push(nodeId);
      }
      const start = performance.now();
      for (const nodeId of this._pollDirty) {
        if (performance.now() - start > BUDGET_MS) return;
        this._pollDirty.delete(nodeId);
        this._serializeNode(nodeId, false);
      }
      for (const nodeId of due) {
        if (this._deepCredit <= 0 || performance.now() - start > BUDGET_MS) return;
        this._serializeNode(nodeId, true);
      }
    },

    // Activation (late consumer): nodes registered while inactive have no
    // seed yet, so a write before their first visit could not be seen as a
    // change. The first slice is seeded at activation instead of 200 ms later:
    // ONE normal pass (<= HINT_NODES nodes, the per-tick serialization budget;
    // the rest follow on the usual ticks). Seeds record nothing; readiness is
    // disclosed in the summary as baseline { complete, pendingNodes }.
    _pollBaseline() {
      this._baselining = true;
      try {
        this._pollStateValues(true);
      } catch { /* never break activation */ } finally {
        this._baselining = false;
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
        const hadKey = this._stateSnapshotStrs.has(nodeId);
        if (hadKey && this._stateSnapshotStrs.get(nodeId) === key) return;
        this._stateSnapshotStrs.set(nodeId, key);
        const tooLarge = str !== undefined && str.length > MAX_SNAPSHOT_CHARS;
        const snapshot =
          str === undefined
            ? null
            : tooLarge
              ? '(object: ' + str.length + ' chars, too large to snapshot)'
              : JSON.parse(str);
        const size = typeof snapshot === 'string' ? 64 : str.length;
        if (!this._stateSnapshots.has(nodeId)) {
          // first observation: seed only (no entry, no counters)
          this._stateSnapshots.set(nodeId, snapshot);
          this._lastSnapshotSize.set(nodeId, size);
          this._unseeded.delete(nodeId);
          return;
        }
        if (tooLarge) this._valueTooLarge++;
        const prev = this._stateSnapshots.get(nodeId);
        this._recordChange(nodeId, entry, prev, snapshot, size + (this._lastSnapshotSize.get(nodeId) || 0));
        this._lastSnapshotSize.set(nodeId, size);
      } catch {
        // non-serializable (cycles, BigInt): never observable, so not pending
        this._unseeded.delete(nodeId);
      }
    },

    _recordChange(nodeId, entry, oldValue, newValue, approxBytes) {
      const change = {
        id: nodeId,
        name: entry.meta.name,
        componentFile: entry.meta.componentFile,
        oldValue,
        newValue,
        timestamp: Date.now(),
      };
      const bytes = (approxBytes || 64) + 192;
      // seq stays runtime-internal: the server assigns its own seq (§6.4).
      this._entryInfo.set(change, { seq: ++this._timelineSeq, bytes });
      this._stateTimeline.push(change);
      this._timelineBytes += bytes;
      // sampled change count (§6.7 J IA2): independent of the ring
      this._activityRow(entry.meta.componentId).changes++;
      this._stateSnapshots.set(nodeId, newValue);
      // The ring (_trimTimeline) is applied in bulk, not with one splice per
      // change (a poll tick can record thousands): before every read (each
      // push — with a hot channel and an active consumer, at least every 200
      // changes — the full snapshot, getStateTimeline() and clear), and here
      // once more than __TIMELINE_TRIM_AT entries are held or the byte budget
      // is exceeded, which bounds memory when nothing reads or pushes.
      if (this._stateTimeline.length > __TIMELINE_TRIM_AT || this._timelineBytes > __TIMELINE_BYTES) {
        this._trimTimeline();
      }
      this._scheduleTimelineUpdate();
    },

    // Ring: at most 500 entries and __TIMELINE_BYTES (the newest entry is
    // always kept). Removed entries that were never pushed are disclosed
    // as dropped (§6.7 C); pushed ones are already on the server.
    _trimTimeline() {
      const all = this._stateTimeline;
      let cut = 0;
      let bytesLeft = this._timelineBytes;
      while (cut < all.length - 1 && (all.length - cut > 500 || bytesLeft > __TIMELINE_BYTES)) {
        const info = this._entryInfo.get(all[cut]);
        const reason = all.length - cut > 500 ? 'runtime-count' : 'runtime-bytes';
        if (info.seq > this._pushedSeq) this._timelineDropped[reason]++;
        bytesLeft -= info.bytes;
        cut++;
      }
      if (cut > 0) {
        all.splice(0, cut);
        this._timelineBytes = bytesLeft;
      }
    },

    // Push (§6.7 C): a throttle, not a debounce — a pending timer is never
    // re-armed, so unsent entries leave within 300 ms of the first one even
    // under continuous change — plus an immediate flush once 200 entries
    // (one message) are unsent, since one poll tick can record thousands.
    _scheduleTimelineUpdate() {
      if (!this._active || this._baselining) return;
      if (this._timelineSeq - this._pushedSeq >= 200) {
        this._flushTimeline();
        return;
      }
      if (this._timelineDebounceTimer) return;
      this._timelineDebounceTimer = setTimeout(() => {
        this._timelineDebounceTimer = null;
        this._flushTimeline();
      }, 300);
    },

    _flushTimeline() {
      if (this._timelineDebounceTimer) {
        clearTimeout(this._timelineDebounceTimer);
        this._timelineDebounceTimer = null;
      }
      if (!import.meta.hot) return;
      for (const msg of this._timelineDeltas()) {
        import.meta.hot.send('svelte-devtools:state-timeline', msg);
      }
    },

    // Disclosure counters since the previous push, attached to (and reset
    // by) the next message: dropped [{ reason, count }] and valueTooLarge.
    _takeTimelineDisclosure(msg) {
      msg.baseline = this._baselineInfo();
      this._sentPendingNodes = msg.baseline.pendingNodes;
      const dropped = [];
      for (const reason of ['runtime-count', 'runtime-bytes']) {
        const count = this._timelineDropped[reason];
        if (count > 0) dropped.push({ reason, count });
        this._timelineDropped[reason] = 0;
      }
      if (dropped.length) msg.dropped = dropped;
      if (this._valueTooLarge > 0) msg.valueTooLarge = this._valueTooLarge;
      this._valueTooLarge = 0;
      return msg;
    },

    // Seed coverage (review B-2), on every state-timeline message and the
    // summary: pendingNodes = polled $state nodes without a first sample;
    // their writes are not observable yet.
    _baselineInfo() {
      return { complete: this._unseeded.size === 0, pendingNodes: this._unseeded.size };
    },

    _hasTimelineDisclosure() {
      return (
        this._sentPendingNodes !== this._unseeded.size ||
        this._timelineDropped['runtime-count'] > 0 ||
        this._timelineDropped['runtime-bytes'] > 0 ||
        this._valueTooLarge > 0
      );
    },

    // Delta push (docs/devframe-migration.md §6.4): only entries recorded
    // since the previous push, ≤ 200 per message, tagged with a per-page-load
    // epoch; reset after clearStateTimeline(). A message with no changes is
    // still sent when there is something to disclose (all unsent dropped).
    _timelineDeltas() {
      this._trimTimeline();
      const all = this._stateTimeline;
      let start = all.length;
      while (start > 0 && this._entryInfo.get(all[start - 1]).seq > this._pushedSeq) start--;
      const pending = all.slice(start);
      const msgs = [];
      const first = this._timelineReset || this._hasTimelineDisclosure();
      for (let i = 0; i < pending.length || (first && i === 0); i += 200) {
        const msg = { epoch: this._epoch, changes: pending.slice(i, i + 200) };
        if (i === 0 && this._timelineReset) msg.reset = true;
        if (i === 0) this._takeTimelineDisclosure(msg);
        else msg.baseline = this._baselineInfo();
        msgs.push(msg);
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return msgs;
    },

    // Full buffer (reset: true) — reply to request-state-timeline and the
    // activation snapshot. Newest entries first up to __TIMELINE_BYTES, the
    // server's own buffer budget, so nothing is sent that it would drop.
    _timelineFull() {
      this._trimTimeline();
      const all = this._stateTimeline;
      let start = all.length;
      let bytes = 0;
      while (start > 0) {
        const size = this._entryInfo.get(all[start - 1]).bytes;
        if (bytes + size > __TIMELINE_BYTES && start < all.length) break;
        bytes += size;
        start--;
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return this._takeTimelineDisclosure({ epoch: this._epoch, changes: all.slice(start), reset: true });
    },

    getStateTimeline() {
      this._trimTimeline();
      return this._stateTimeline;
    },

    clearStateTimeline() {
      // Ring first: unsent entries past the cap are disclosed as dropped,
      // exactly as if they had been removed when recorded.
      this._trimTimeline();
      this._stateTimeline = [];
      this._timelineBytes = 0;
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
      if (this._active && !wasActive) this._pollBaseline();
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
          poll: setInterval(() => {
            this._pollStateValues();
            // seed progress changed: push it even without changes (B-2)
            if (this._sentPendingNodes !== this._unseeded.size) this._scheduleTimelineUpdate();
          }, 200),
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
    import.meta.hot.on('svelte-devtools:request-reactive-summary', (data) => {
      __SVELTE_DT.sendReactiveSummary(data);
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
