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
    /** Select the component instance of `element` in the DevTools; false when unknown. */
    pick(element: Element): boolean;
    /** Let the DevTools turn the inspector on and off; returns a function that unlinks it. */
    connect(controls: { enable(): void; disable(): void }): () => void;
    /** Run `fn` (the inspector's own mount) without the DevTools tracking its components. */
    untracked<T>(fn: () => T): T;
  }

  const devtools: InspectorDevtools | null;
  export default devtools;
}
