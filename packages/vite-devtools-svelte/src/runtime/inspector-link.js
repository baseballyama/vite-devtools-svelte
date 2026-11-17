// The in-page Svelte Inspector's link to the DevTools (packages/inspector
// imports it as `virtual:vite-devtools-svelte-inspector-devtools`): names the
// component instance of the element under the cursor and of the components
// around it, reports a click as a pick, and lets the DevTools' "Pick element"
// turn the inspector on and off.
// Browser code served from disk next to hooks.js; idle until the inspector is.

// Creates the page's store first (and subscribes it to Svelte's events).
// oxlint-disable-next-line import/no-unassigned-import
import './hooks.js';

// The page's store, under the registry key hooks.js creates it at (none
// outside the browser).
const store = globalThis[Symbol.for('vite-devtools-svelte')] ?? null;

const ELEMENT_PICKED = 'svelte-devtools:element-picked';

// The tracked instance that rendered `element` (Svelte records the component
// on each element in development; content passed to a child belongs to the
// child, a library component to its nearest tracked ancestor), or null.
function instanceOf(element) {
  const ctx = element.__svelte_meta?.component;
  if (!ctx) return null;
  const id = store._api.trackedComponent(ctx);
  return id === null ? null : (store._instances.get(id) ?? null);
}

// The instance of each component entry of `element`'s `__svelte_meta.parent`
// chain (the inspector menu's parent rows), keyed by the entry. Each component
// call pushes one entry and creates one context, so the component entries and
// the contexts from the element's own outwards pair up in order. A pair counts
// only when the context is tracked, its component is named like the tag, and
// its parent context is the component whose template made the call: the file
// of the entry just inside the next component entry (the call itself, a
// block, or the {@render} of a snippet passed in). Dynamic and aliased tags
// fail that check; a call without an entry (css custom properties) shifts the
// pairs, which then fail it too.
function parentInstances(element) {
  const calls = [];
  let last = null;
  for (let entry = element.__svelte_meta?.parent ?? null; entry !== null; entry = entry.parent) {
    if (entry.type === 'component') {
      if (calls.length > 0) calls.at(-1).caller = last.file;
      calls.push({ entry, caller: null });
    }
    last = entry;
  }
  if (calls.length > 0) calls.at(-1).caller = last.file;

  const { filename, parentComponent } = store._api;
  const found = new Map();
  let ctx = element.__svelte_meta?.component ?? null;
  for (const { entry, caller } of calls) {
    if (ctx === null) break;
    const parent = parentComponent(ctx);
    const id = store._idByContext.get(ctx);
    const instance = id === undefined ? undefined : store._instances.get(id);
    if (instance?.name === entry.componentTag && parent !== null && filename(parent) === caller) {
      found.set(entry, instance);
    }
    ctx = parent;
  }
  return found;
}

// `InspectorDevtools` (packages/inspector/src/runtime/ambient.d.ts), null outside the browser
const link = store && {
  describe(element) {
    const instance = instanceOf(element);
    return instance && { name: instance.name };
  },

  parents(element) {
    const names = new Map();
    for (const [entry, instance] of parentInstances(element)) {
      names.set(entry, { name: instance.name });
    }
    return names;
  },

  pick(element, entry) {
    const instance =
      entry === undefined ? instanceOf(element) : (parentInstances(element).get(entry) ?? null);
    if (instance === null) return false;
    const { file, line, column } = entry ?? element.__svelte_meta.loc;
    store._send(ELEMENT_PICKED, {
      epoch: store._epoch,
      componentId: instance.id,
      loc: { file, line, column },
    });
    return true;
  },

  connect(controls) {
    store._inspector = controls;
    return () => {
      if (store._inspector === controls) store._inspector = null;
    };
  },

  untracked(fn) {
    store._untracked = true;
    try {
      return fn();
    } finally {
      store._untracked = false;
    }
  },
};

export default link;
