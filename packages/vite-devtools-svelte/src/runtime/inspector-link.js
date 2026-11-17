// The in-page Svelte Inspector's link to the DevTools (packages/inspector
// imports it as `virtual:vite-devtools-svelte-inspector-devtools`): names the
// component instance of the element under the cursor, reports a click as a
// pick, and lets the DevTools' "Pick element" turn the inspector on and off.
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

// `InspectorDevtools` (packages/inspector/src/runtime/ambient.d.ts), null outside the browser
const link = store && {
  describe(element) {
    const instance = instanceOf(element);
    return instance && { name: instance.name };
  },

  pick(element) {
    const instance = instanceOf(element);
    if (instance === null) return false;
    const { file, line, column } = element.__svelte_meta.loc;
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
