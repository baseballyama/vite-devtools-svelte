declare module 'virtual:vite-devtools-svelte-inspector-options' {
  // An ambient module cannot `import` a relative path, so this takes the type through `import()`.
  // oxlint-disable-next-line typescript/consistent-type-imports
  const options: Required<import('../types.js').InspectorOptions>;
  export default options;
}

declare module 'virtual:vite-devtools-svelte-inspector-path:*.svelte' {
  import type { Component } from 'svelte';

  const component: Component;
  export default component;
}

// vite-devtools-svelte: the DevTools link (null without the DevTools), the default export of
// the module passed as `link.devtools`.
declare module 'virtual:vite-devtools-svelte-inspector-devtools' {
  /** What the runtime calls on the DevTools. */
  export interface InspectorDevtools {
    /** The component instance that rendered `element`, for the label; null when unknown. */
    describe(element: Element): { name: string } | null;
    /**
     * The component instances of the component entries of `element`'s `__svelte_meta.parent`
     * chain (the menu's parent rows), keyed by entry; an entry without a confident match is absent.
     */
    parents(element: Element): Map<object, { name: string }>;
    /**
     * Select in the DevTools the component instance of `element`, or with `entry` (one of its
     * `__svelte_meta.parent` entries) the instance of that entry; false when unknown.
     */
    pick(element: Element, entry?: object): boolean;
    /** Let the DevTools turn the inspector on and off; returns a function that unlinks it. */
    connect(controls: { enable(): void; disable(): void }): () => void;
    /** Run `fn` (the inspector's own mount) without the DevTools tracking its components. */
    untracked<T>(fn: () => T): T;
  }

  const devtools: InspectorDevtools | null;
  export default devtools;
}
