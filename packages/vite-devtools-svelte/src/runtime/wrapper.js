import * as __svelte_original from 'svelte/internal/client';
export * from 'svelte/internal/client';

function __dt() {
  return typeof window === 'undefined' ? null : window.__SVELTE_DEVTOOLS__;
}

const __idStack = [];
function __currentId() {
  return __idStack.length > 0 ? __idStack.at(-1) : null;
}

const __pendingSignal = { ref: null, type: null };

// A component created later by a block update ({#each}/{#if} after mount)
// runs outside its parent's push..pop, where the init stack is empty. The
// block effect creating it belongs to the parent's template, so
// active_effect.ctx at push time IS the parent's context (Svelte 5.56.8).
// The map lives on the runtime so the reactive graph can name the component
// of any effect it reaches.
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

// Observer must not break the observed: every devtools side-effect is wrapped
// in try/catch so a bug or an out-of-shape runtime cannot tear down the app.

export function push() {
  // Parent hint, read before this component's own id exists:
  // 1. the wrapper stack: the component whose init is running (children
  //    rendered directly by a template, where active_effect still belongs to
  //    an outer block), or the block owner re-pushed by __wrapBlockFn for a
  //    later {#each}/{#if}/{#key} update (see Block Attribution below);
  // 2. else the context-derived owner, for re-creation paths the wrapper
  //    does not wrap (snippet, svelte:element, ...).
  let parentHint = null;
  try {
    parentHint = __currentId();
  } catch {}
  if (parentHint === null) {
    try {
      parentHint = __parentFromContext();
    } catch {}
  }
  const result = __svelte_original.push.apply(null, arguments);
  try {
    const dt = __dt();
    if (dt) {
      const file = dt._pendingFile ?? 'Unknown';
      dt._pendingFile = null;
      dt._pendingParent = parentHint;
      const id = dt.register(file);
      __idStack.push(id);
      dt.startInit(id);
      try {
        __svelte_original.user_effect(() => {
          try {
            // Inside its own deferred effect, active_effect.ctx is this component's
            // context; at push time it is still the parent's.
            const own = __svelte_original.active_effect;
            if (own?.ctx) dt._idByContext.set(own.ctx, id);
            if (own) dt.setComponentEffect(id, own);
          } catch {}
          return () => {
            try {
              dt.unmount(id);
            } catch {}
          };
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
      try {
        dt.endInit(id);
      } catch {}
      try {
        dt.registered(id);
      } catch {}
    }
  } catch {}
  return __svelte_original.pop.apply(null, arguments);
}

// The created signal/proxy is remembered with its type for the tag() call
// the compiler (dev) emits right after it.
function __marking(original, type) {
  return function () {
    const signal = original.apply(null, arguments);
    __pendingSignal.ref = signal;
    __pendingSignal.type = type;
    return signal;
  };
}

export const state = __marking(__svelte_original.state, 'state');
export const derived = __marking(__svelte_original.derived, 'derived');
export const proxy = __marking(__svelte_original.proxy, 'proxy');

export function tag(signal, name) {
  const result = __svelte_original.tag.apply(null, arguments);
  try {
    const dt = __dt();
    const cid = __owner();
    const type = __pendingSignal.ref === signal ? __pendingSignal.type : 'state';
    if (dt && cid !== null) {
      const owner = __svelte_original.active_effect;
      if (type === 'derived') {
        dt.trackDerived(signal, name, cid, owner);
      } else {
        dt.trackState(signal, name, cid, owner);
      }
    } else if (dt?._moduleFile) {
      dt.trackModuleSignal(type === 'derived' ? 'derived' : 'state', signal, name);
    }
    __pendingSignal.ref = null;
    __pendingSignal.type = null;
  } catch {}
  return result;
}

export function tag_proxy(value, name) {
  const result = __svelte_original.tag_proxy.apply(null, arguments);
  try {
    const dt = __dt();
    const cid = __owner();
    if (dt && cid !== null) {
      dt.trackProxy(value, name, cid, __svelte_original.active_effect);
    } else if (dt?._moduleFile) {
      dt.trackModuleSignal('proxy', value, name);
    }
    __pendingSignal.ref = null;
    __pendingSignal.type = null;
  } catch {}
  return result;
}

// A top-level $effect is deferred by Svelte until mount (user_effect()
// returns undefined; the effect object is created in pop()), so the node is
// registered now and bound to the real effect on its first run.
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
      try {
        dt.bindEffect(nodeId, __svelte_original.active_effect);
      } catch {}
    }
    return fn.apply(this, arguments);
  };
  try {
    nodeId = dt.trackUserEffect(kind, cid, __svelte_original.active_effect);
  } catch {}
  const result = original.apply(null, wrapped);
  if (result && !bound) {
    bound = true;
    try {
      dt.bindEffect(nodeId, result);
    } catch {}
  }
  return result;
}

export function user_effect() {
  return __trackUserEffect(__svelte_original.user_effect, 'effect', arguments);
}

export function user_pre_effect() {
  return __trackUserEffect(__svelte_original.user_pre_effect, 'effect_pre', arguments);
}

// Svelte 5 has no virtual DOM: a re-run of a template_effect IS the component
// updating the DOM. The first run is the mount paint, already counted in
// initTime, so it is skipped. One state change re-runs several effects of the
// same component, so durations are pooled per microtask.
const __pendingRenderDurations = new Map();
let __renderFlushScheduled = false;

function __flushRenderDurations() {
  __renderFlushScheduled = false;
  const dt = __dt();
  if (dt) {
    for (const [cid, duration] of __pendingRenderDurations) {
      try {
        dt.recordRender(cid);
      } catch {}
      try {
        dt.recordRenderTime(cid, duration);
      } catch {}
    }
  }
  __pendingRenderDurations.clear();
}

function __recordRenderDuration(cid, duration) {
  __pendingRenderDurations.set(cid, (__pendingRenderDurations.get(cid) ?? 0) + duration);
  if (!__renderFlushScheduled) {
    __renderFlushScheduled = true;
    queueMicrotask(__flushRenderDurations);
  }
}

// User exceptions propagate untouched: only the args are built inside try,
// so the original is called exactly once.
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
      try {
        __recordRenderDuration(cid, performance.now() - start);
      } catch {}
    }
  };
  return wrapped;
}

function __withArgs(original, wrapArgs) {
  return function () {
    let args = arguments;
    try {
      args = wrapArgs(arguments);
    } catch {}
    return original.apply(null, args);
  };
}

export const template_effect = __withArgs(__svelte_original.template_effect, __wrapTemplateEffect);
export const deferred_template_effect = __withArgs(
  __svelte_original.deferred_template_effect,
  __wrapTemplateEffect,
);

// Effects for {#each} items added later or re-created {#if} branches are
// created during a batch flush, when __idStack is empty. Block helpers are
// always called during their owner's init or inside an outer block's callback,
// so the owner id is on the stack then; it is captured and re-pushed around every callback the block invokes later.

// A component whose init throws (caught by <svelte:boundary>, or by the
// block's caller) never reaches pop(): its id would stay on both stacks and
// every later signal/child would be attributed to it. On the way out — normal
// or thrown — the stack is cut back to its depth on entry, and ids left
// above it are dropped as aborted inits (registered, never mounted).
function __wrapBlockFn(fn, cid) {
  return function () {
    let depth = -1;
    try {
      depth = __idStack.length;
      __idStack.push(cid);
    } catch {}
    try {
      return fn.apply(this, arguments);
    } finally {
      if (depth !== -1) {
        try {
          if (__idStack.length > depth + 1) {
            const dt = __dt();
            const aborted = __idStack.slice(depth + 1);
            for (let i = aborted.length - 1; i >= 0; i--) {
              try {
                if (dt) dt.abortInit(aborted[i]);
              } catch {}
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

export const each = __withArgs(__svelte_original.each, __wrapBlock);
export const key = __withArgs(__svelte_original.key, __wrapBlock);
export const component = __withArgs(__svelte_original.component, __wrapBlock);
export const boundary = __withArgs(__svelte_original.boundary, __wrapBlock);
// 'if' and 'await' are reserved words: exported via aliases.
const __if_block = __withArgs(__svelte_original.if, __wrapBlock);
const __await_block = __withArgs(__svelte_original.await, __wrapBlock);

export { __if_block as if, __await_block as await };
