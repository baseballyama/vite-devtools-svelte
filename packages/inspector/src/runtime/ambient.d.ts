declare module 'virtual:vite-devtools-svelte-inspector-options' {
  // An ambient module cannot `import` a relative path, so this takes the type through `import()`.
  // oxlint-disable-next-line typescript/consistent-type-imports
  const options: Required<import('../public.d.ts').InspectorOptions>;
  export default options;
}

declare module 'virtual:vite-devtools-svelte-inspector-path:*.svelte' {
  import type { Component } from 'svelte';

  const component: Component;
  export default component;
}
