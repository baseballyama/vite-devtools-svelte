// Feeds the devtools store (runtime.js) from Svelte's own devtools
// instrumentation channel (`svelte/internal/devtools`, dev only). Compiled
// components import this file before anything else (the compiler's
// `experimental.devtools` option), so the listener is subscribed before the
// first component, signal or effect exists.

import {
  children,
  componentEffect,
  componentOf,
  deps,
  filename,
  isDestroyed,
  isFork,
  isUninitialized,
  kind,
  listen,
  location,
  parentComponent,
  reactions,
  signalValue,
  snapshot,
} from 'svelte/internal/devtools';

import { connectHot, createStore } from './runtime.js';

// Longest chain of nested $state proxies followed to find the root's node.
const MAX_PROXY_DEPTH = 64;

// `file:line:column` -> file
function fileOf(loc) {
  const end = loc.lastIndexOf(':', loc.lastIndexOf(':') - 1);
  return end === -1 ? loc : loc.slice(0, end);
}

// Library internals (SvelteKit's page state, UI kits) are not the app's code:
// they stay out of the tree and the graph, as dependencies devtools does not track.
function isLibrary(file) {
  return file.includes('/node_modules/');
}

const isObject = value => typeof value === 'object' && value !== null;

// A dependency prebundle may carry a second copy of this file and runtime.js,
// but a page has one store: the first copy creates it under this registry key,
// later copies reuse it (listening again under the same name replaces the
// earlier subscription).
const STORE_KEY = Symbol.for('vite-devtools-svelte');

function pageStore() {
  if (!Object.hasOwn(globalThis, STORE_KEY)) {
    Object.defineProperty(globalThis, STORE_KEY, { value: createStore(window) });
  }
  return globalThis[STORE_KEY];
}

const dt = typeof window === 'undefined' ? null : pageStore();

if (dt) {
  // A prebundled copy may have no HMR channel: the first copy that has one attaches it.
  if (import.meta.hot && dt._hot === null) connectHot(dt, import.meta.hot);

  // Component context -> component id (also on the runtime: the graph names
  // the component of any effect it reaches through it).
  const idByContext = dt._idByContext;

  // Which $state a deep change belongs to (Svelte announces a proxy's hidden
  // sources with the proxy they belong to): property / version signal ->
  // its proxy, nested proxy -> the proxy holding it (first holder wins, so
  // `selected = todos[0]` keeps it under `todos`), root proxy -> node id.
  const proxyOfSource = new WeakMap();
  const parentProxy = new WeakMap();
  const nodeOfProxy = new WeakMap();
  const adopt = (value, parent) => {
    if (isObject(value) && !parentProxy.has(value) && !nodeOfProxy.has(value)) {
      parentProxy.set(value, parent);
    }
  };
  // A proxy held by a tracked `$state` belongs to it, unless another proxy
  // already holds it (`selected = todos[0]`: still part of `todos`).
  const claim = (value, id) => {
    if (isObject(value) && !parentProxy.has(value) && !nodeOfProxy.has(value)) {
      nodeOfProxy.set(value, id);
    }
  };
  const sourceNode = signal => {
    let proxy = proxyOfSource.get(signal);
    for (let depth = 0; proxy !== undefined && depth < MAX_PROXY_DEPTH; depth++) {
      const id = nodeOfProxy.get(proxy);
      if (id !== undefined) return id;
      proxy = parentProxy.get(proxy);
    }
    return null;
  };

  // The tracked component a context belongs to: the context itself, else its
  // nearest tracked ancestor (the context `mount` creates around the root
  // component and library components are transparent). null when none.
  const trackedComponent = ctx => {
    for (let c = ctx; c !== null; c = parentComponent(c)) {
      const id = idByContext.get(c);
      if (id !== undefined) return id;
    }
    return null;
  };

  dt._api = {
    signalValue,
    isUninitialized,
    deps,
    reactions,
    kind,
    componentOf,
    children,
    snapshot,
    sourceNode,
    trackedComponent,
    filename,
    parentComponent,
    isFork,
  };

  // Tracked $state nodes written per batch, handed to the runtime once the
  // batch is applied: flushed, or for a fork, committed (until then the
  // committed value is unchanged). A discarded fork is forgotten.
  const writes = new WeakMap();
  const applied = batch => {
    const ids = writes.get(batch);
    if (ids === undefined) return;
    writes.delete(batch);
    for (const id of ids) dt.markWritten(id);
  };
  const wrote = (batch, id) => {
    let ids = writes.get(batch);
    if (ids === undefined) {
      ids = new Set();
      writes.set(batch, ids);
    }
    ids.add(id);
  };

  // Render effects whose first run (the mount-time paint, covered by
  // initTime) already happened.
  const painted = new WeakSet();
  // Running render effects and their start times (deriveds can run inside).
  const renders = [];

  // Scope of a signal/effect declared at `loc` (`file:line:column`): the
  // component it is created in, else (module code, class instances created
  // outside a component) the module it is declared in. null when declared in
  // a library, even when a component of the app runs that code.
  const scopeOf = (ctx, loc) => {
    const file = fileOf(loc);
    if (isLibrary(file)) return null;
    if (ctx !== null) return idByContext.get(ctx) ?? null;
    return dt.moduleScope(file);
  };

  listen({
    name: 'vite-devtools-svelte',

    componentCreated(ctx) {
      const file = filename(ctx);
      if (file === undefined || isLibrary(file)) return;
      const id = dt.register(file, trackedComponent(parentComponent(ctx)));
      idByContext.set(ctx, id);
      dt.setComponentEffect(id, componentEffect(ctx), ctx);
      dt.startInit(id);
    },

    componentInitialized(ctx) {
      const id = idByContext.get(ctx);
      if (id === undefined) return;
      dt.endInit(id);
      dt.registered(id);
    },

    componentDestroyed(ctx) {
      const id = idByContext.get(ctx);
      if (id === undefined) return;
      idByContext.delete(ctx);
      dt.unmount(id);
    },

    signalCreated(signal, info) {
      if (info.kind === 'proxy-prop' || info.kind === 'proxy-version') {
        proxyOfSource.set(signal, info.proxy);
        if (info.kind === 'proxy-prop') adopt(signalValue(signal), info.proxy);
      }
      // no declaration: template expressions and other Svelte-internal signals
      if (info.location === undefined || info.kind === 'proxy-prop') return;
      // a nested proxy, or the value of a tracked `$state`: not a node of its own
      if (
        info.kind === 'proxy-version' &&
        (parentProxy.has(info.proxy) || nodeOfProxy.has(info.proxy))
      ) {
        return;
      }
      const scope = scopeOf(info.ctx, info.location);
      if (scope === null) return;
      const label = info.label ?? '';
      if (info.kind === 'state') {
        const id = dt.trackState(signal, label, scope, info.effect, info.location);
        // `let obj = $state({...})`: the proxy is announced next, under the
        // same name; its properties belong to this node
        claim(signalValue(signal), id);
      } else if (info.kind === 'proxy-version') {
        const name = label.slice(0, -' version'.length);
        nodeOfProxy.set(
          info.proxy,
          dt.trackProxy(info.proxy, name, scope, info.effect, info.location),
        );
      } else {
        dt.trackDerived(signal, label, scope, info.effect, info.location);
      }
    },

    signalWritten(signal, { value, batch }) {
      const id = dt._idBySignal.get(signal);
      if (id !== undefined) {
        // a reassigned object state: its new proxy belongs to this node
        claim(value, id);
        wrote(batch, id);
        return;
      }
      if (!proxyOfSource.has(signal)) return;
      adopt(value, proxyOfSource.get(signal));
      const owner = sourceNode(signal);
      if (owner !== null) wrote(batch, owner);
    },

    flushEnd(batch) {
      if (!isFork(batch)) applied(batch);
    },

    batchCommitted(batch) {
      applied(batch);
    },

    batchDiscarded(batch) {
      writes.delete(batch);
    },

    effectCreated(effect) {
      // `$effect` / `$effect.pre`: the compiler passes their location
      const loc = location(effect);
      if (loc === undefined) return;
      const k = kind(effect);
      if (k !== 'effect' && k !== 'effectPre') return;
      const scope = scopeOf(componentOf(effect), loc);
      if (scope === null) return;
      const nodeId = dt.trackUserEffect(k === 'effect' ? 'effect' : 'effect_pre', scope);
      dt.bindEffect(nodeId, effect);
    },

    // Also reported for an effect Svelte drops from the tree right after its
    // first run (not destroyed: its only child, if any, takes its place).
    effectDestroyed(effect) {
      if (isDestroyed(effect)) dt.effectDestroyed(effect);
      else dt.effectElided(effect, children(effect)[0] ?? null);
    },

    // Render profiling: Svelte 5 has no virtual DOM, every dynamic part of a
    // template is a render effect, so a re-run of one IS the component
    // updating the DOM.
    reactionRunStart(reaction) {
      if (kind(reaction) !== 'render') return;
      if (!painted.has(reaction)) {
        painted.add(reaction);
        return;
      }
      const ctx = componentOf(reaction);
      const id = ctx === null ? undefined : idByContext.get(ctx);
      if (id !== undefined) renders.push({ reaction, id, start: performance.now() });
    },

    reactionRunEnd(reaction) {
      const top = renders.at(-1);
      if (top === undefined || top.reaction !== reaction) return;
      renders.pop();
      dt.recordRenderDuration(top.id, performance.now() - top.start);
    },
  });

  // Svelte (5.58+) records the component context an element was rendered in
  // as `__svelte_meta.component`. null when no tracked component rendered it.
  const instanceOf = element => {
    const ctx = element?.__svelte_meta?.component;
    const id = ctx ? trackedComponent(ctx) : null;
    return id === null ? null : (dt._instances.get(id) ?? null);
  };
  // Entries carry no component reference, so component entries are paired with
  // the context chain in order. A pair counts only when the instance is named
  // like the tag and its parent context's file is the caller's file, which
  // rules out aliased and dynamic tags and pairs shifted by an entry-less call
  // (css custom properties), except inside a self-recursive component.
  const parentInstances = element => {
    const calls = [];
    let last = null;
    for (let entry = element?.__svelte_meta?.parent ?? null; entry; entry = entry.parent) {
      if (entry.type === 'component') {
        if (calls.length > 0) calls.at(-1).caller = last.file;
        calls.push({ entry, caller: null });
      }
      last = entry;
    }
    if (calls.length > 0) calls.at(-1).caller = last.file;

    const found = new Map();
    let ctx = element?.__svelte_meta?.component ?? null;
    for (const { entry, caller } of calls) {
      if (!ctx) break;
      const parent = parentComponent(ctx);
      const id = idByContext.get(ctx);
      const instance = id === undefined ? undefined : dt._instances.get(id);
      if (instance?.name === entry.componentTag && parent !== null && filename(parent) === caller) {
        found.set(entry, instance);
      }
      ctx = parent;
    }
    return found;
  };
  window.addEventListener('svelte-inspector:describe', event => {
    const detail = event.detail;
    const instance = instanceOf(detail?.element);
    if (instance) detail.name = instance.name;
    if (detail?.parents instanceof Map) {
      for (const [entry, found] of parentInstances(detail.element)) {
        detail.parents.set(entry, found.name);
      }
    }
  });
  window.addEventListener('svelte-inspector:pick', event => {
    // only the menu's Inspect is cancelable; a click, the open key or Open only opens the editor
    if (!event.cancelable) return;
    const { element, entry } = event.detail ?? {};
    const instance = entry ? parentInstances(element).get(entry) : instanceOf(element);
    if (!instance) return;
    // the inspector then opens no editor
    event.preventDefault();
    dt._send('svelte-devtools:element-picked', { epoch: dt._epoch, componentId: instance.id });
  });

  // Performance recording: subscribed only while one is on (the runtime
  // calls this), so Svelte emits nothing more for it otherwise. Runs after
  // the listener above (subscription order), which has adopted new proxies.
  const recorder = {
    name: 'vite-devtools-svelte:performance',
    signalWritten: (signal, { batch }) => dt._perfWritten(signal, batch),
    flushStart: batch => dt._perfFlushStart(batch),
    flushEnd: batch => dt._perfFlushEnd(batch),
    batchCommitted: batch => dt._perfCommitted(batch),
    batchDiscarded: batch => dt._perfDiscarded(batch),
    reactionRunStart: reaction => dt._perfRunStart(reaction),
    reactionRunEnd: reaction => dt._perfRunEnd(reaction),
  };
  dt._subscribePerf = () => listen(recorder);
}
