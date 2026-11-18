/// <reference types="svelte" />
/// <reference types="vite/client" />

// The custom element compiled from src/lib/Badge.ce.svelte.
declare namespace svelteHTML {
  interface IntrinsicElements {
    'x-badge': { label?: string; tone?: string };
  }
}

// examples-ui-lib ships plain .js/.svelte without types (like many small libraries).
declare module 'examples-ui-lib' {
  import type { Component, Snippet } from 'svelte';

  export const Card: Component<{ title: string; children?: Snippet; footer?: Snippet }>;
  export const LibButton: Component<{ onclick?: () => void; children?: Snippet }>;
  export const Tabs: Component<
    { tabs: string[]; active?: string; panel: Snippet<[string]> },
    {},
    'active'
  >;
}
