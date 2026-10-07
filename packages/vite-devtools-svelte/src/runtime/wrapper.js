import * as __svelte_original from 'svelte/internal/client'
export * from 'svelte/internal/client'

function __dt() {
  return typeof window === 'undefined' ? null : window.__SVELTE_DEVTOOLS__
}

// Component ID stack (parallel to runtime._stack but local to wrapper)
const __idStack = []
function __currentId() {
  return __idStack.length > 0 ? __idStack.at(-1) : null
}

// Tracks the most recently created signal for type determination in tag()
const __pendingSignal = { ref: null, type: null }

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
  const dt = __dt()
  const effect = __svelte_original.active_effect
  const ctx = effect ? effect.ctx : null
  return dt && ctx && dt._idByContext ? dt._idByContext.get(ctx) : undefined
}

// Owner of a signal/effect created right now: the component whose init (or
// wrapped block callback) is running, else — outside init, e.g. an effect
// created while another effect runs — the component of the active effect.
function __owner() {
  const cid = __currentId()
  if (cid !== null) return cid
  const fromContext = __parentFromContext()
  return fromContext === undefined ? null : fromContext
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
  let parentHint = null
  try {
    parentHint = __currentId()
  } catch {}
  if (parentHint === null) {
    try {
      parentHint = __parentFromContext()
    } catch {}
  }
  const result = __svelte_original.push.apply(null, arguments)
  try {
    const dt = __dt()
    if (dt) {
      const file = dt._pendingFile ?? 'Unknown'
      dt._pendingFile = null
      dt._pendingParent = parentHint
      const id = dt.register(file)
      __idStack.push(id)
      dt.startInit(id)
      try {
        __svelte_original.user_effect(() => {
          try {
            const own = __svelte_original.active_effect
            if (own?.ctx) dt._idByContext.set(own.ctx, id)
            if (own) dt.setComponentEffect(id, own)
          } catch {}
          return () => {
            try {
              dt.unmount(id)
            } catch {}
          }
        })
      } catch {}
    }
  } catch {}
  return result
}

export function pop() {
  // Capture devtools errors but ALWAYS forward to the original pop so the
  // Svelte component stack stays balanced.
  try {
    const dt = __dt()
    if (dt && __idStack.length > 0) {
      const id = __idStack.pop()
      try {
        dt.endInit(id)
      } catch {}
      try {
        dt.registered(id)
      } catch {}
    }
  } catch {}
  return __svelte_original.pop.apply(null, arguments)
}

// --- Signal Creation (type markers) ---

export function state() {
  const signal = __svelte_original.state.apply(null, arguments)
  try {
    __pendingSignal.ref = signal
    __pendingSignal.type = 'state'
  } catch {}
  return signal
}

export function derived() {
  const signal = __svelte_original.derived.apply(null, arguments)
  try {
    __pendingSignal.ref = signal
    __pendingSignal.type = 'derived'
  } catch {}
  return signal
}

export function proxy() {
  const p = __svelte_original.proxy.apply(null, arguments)
  try {
    __pendingSignal.ref = p
    __pendingSignal.type = 'proxy'
  } catch {}
  return p
}

// --- Signal Tagging (Svelte dev mode) ---

export function tag(signal, name) {
  const result = __svelte_original.tag.apply(null, arguments)
  try {
    const dt = __dt()
    const cid = __owner()
    const type = __pendingSignal.ref === signal ? __pendingSignal.type : 'state'
    if (dt && cid !== null) {
      const owner = __svelte_original.active_effect
      if (type === 'derived') {
        dt.trackDerived(signal, name, cid, owner)
      } else {
        dt.trackState(signal, name, cid, owner)
      }
    } else if (dt?._moduleFile) {
      // created while a .svelte.js/.ts module body runs (shared state)
      dt.trackModuleSignal(type === 'derived' ? 'derived' : 'state', signal, name)
    }
    __pendingSignal.ref = null
    __pendingSignal.type = null
  } catch {}
  return result
}

export function tag_proxy(value, name) {
  const result = __svelte_original.tag_proxy.apply(null, arguments)
  try {
    const dt = __dt()
    const cid = __owner()
    if (dt && cid !== null) {
      dt.trackProxy(value, name, cid, __svelte_original.active_effect)
    } else if (dt?._moduleFile) {
      dt.trackModuleSignal('proxy', value, name)
    }
    __pendingSignal.ref = null
    __pendingSignal.type = null
  } catch {}
  return result
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
  let cid = null
  let dt = null
  let fn = null
  try {
    dt = __dt()
    fn = args[0]
    if (dt && typeof fn === 'function') cid = __owner()
  } catch {}
  if (cid === null) return original.apply(null, args)
  let nodeId = null
  let bound = false
  const wrapped = Array.prototype.slice.call(args)
  wrapped[0] = function () {
    if (!bound) {
      bound = true
      try {
        dt.bindEffect(nodeId, __svelte_original.active_effect)
      } catch {}
    }
    return fn.apply(this, arguments)
  }
  try {
    nodeId = dt.trackUserEffect(kind, cid, __svelte_original.active_effect)
  } catch {}
  const result = original.apply(null, wrapped)
  if (result && !bound) {
    bound = true
    try {
      dt.bindEffect(nodeId, result)
    } catch {}
  }
  return result
}

export function user_effect() {
  return __trackUserEffect(__svelte_original.user_effect, 'effect', arguments)
}

export function user_pre_effect() {
  return __trackUserEffect(__svelte_original.user_pre_effect, 'effect_pre', arguments)
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

const __pendingRenderDurations = new Map()
let __renderFlushScheduled = false

function __flushRenderDurations() {
  __renderFlushScheduled = false
  const dt = __dt()
  for (const [cid, duration] of __pendingRenderDurations) {
    if (dt) {
      try {
        dt.recordRender(cid)
      } catch {}
      try {
        dt.recordRenderTime(cid, duration)
      } catch {}
    }
  }
  __pendingRenderDurations.clear()
}

function __recordRenderDuration(cid, duration) {
  __pendingRenderDurations.set(cid, (__pendingRenderDurations.get(cid) ?? 0) + duration)
  if (!__renderFlushScheduled) {
    __renderFlushScheduled = true
    queueMicrotask(__flushRenderDurations)
  }
}

// Returns a (possibly new) args array whose first element times each re-run
// of the effect closure. The owning component is whatever id is on top of
// __idStack at effect-creation time. User exceptions propagate untouched;
// only the args are built inside try so the original is called exactly once.
function __wrapTemplateEffect(args) {
  const cid = __owner()
  const fn = args[0]
  if (cid === null || typeof fn !== 'function') return args
  const wrapped = Array.prototype.slice.call(args)
  let initialRun = true
  wrapped[0] = function () {
    if (initialRun) {
      initialRun = false
      return fn.apply(this, arguments)
    }
    const start = performance.now()
    try {
      return fn.apply(this, arguments)
    } finally {
      try {
        __recordRenderDuration(cid, performance.now() - start)
      } catch {}
    }
  }
  return wrapped
}

export function template_effect() {
  let args = arguments
  try {
    args = __wrapTemplateEffect(arguments)
  } catch {}
  return __svelte_original.template_effect.apply(null, args)
}

export function deferred_template_effect() {
  let args = arguments
  try {
    args = __wrapTemplateEffect(arguments)
  } catch {}
  return __svelte_original.deferred_template_effect.apply(null, args)
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
    let depth = -1
    try {
      depth = __idStack.length
      __idStack.push(cid)
    } catch {}
    try {
      return fn.apply(this, arguments)
    } finally {
      if (depth !== -1) {
        try {
          if (__idStack.length > depth + 1) {
            const dt = __dt()
            const aborted = __idStack.slice(depth + 1)
            for (let i = aborted.length - 1; i >= 0; i--) {
              try {
                if (dt) dt.abortInit(aborted[i])
              } catch {}
            }
          }
          __idStack.length = depth
        } catch {}
      }
    }
  }
}

function __wrapBlock(args) {
  const cid = __owner()
  if (cid === null) return args
  const wrapped = Array.prototype.slice.call(args)
  for (let i = 0; i < wrapped.length; i++) {
    if (typeof wrapped[i] === 'function') wrapped[i] = __wrapBlockFn(wrapped[i], cid)
  }
  return wrapped
}

export function each() {
  let args = arguments
  try {
    args = __wrapBlock(arguments)
  } catch {}
  return __svelte_original.each.apply(null, args)
}

export function key() {
  let args = arguments
  try {
    args = __wrapBlock(arguments)
  } catch {}
  return __svelte_original.key.apply(null, args)
}

export function component() {
  let args = arguments
  try {
    args = __wrapBlock(arguments)
  } catch {}
  return __svelte_original.component.apply(null, args)
}

export function boundary() {
  let args = arguments
  try {
    args = __wrapBlock(arguments)
  } catch {}
  return __svelte_original.boundary.apply(null, args)
}

// 'if' and 'await' are reserved words, so they cannot be declared as
// function names and are exported via aliases instead.
function __if_block() {
  let args = arguments
  try {
    args = __wrapBlock(arguments)
  } catch {}
  return __svelte_original.if.apply(null, args)
}

function __await_block() {
  let args = arguments
  try {
    args = __wrapBlock(arguments)
  } catch {}
  return __svelte_original.await.apply(null, args)
}

export { __if_block as if, __await_block as await }
