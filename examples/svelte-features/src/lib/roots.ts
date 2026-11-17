import { mount, unmount } from 'svelte';

import Floating from '../roots/Floating.svelte';

// Root 3: mounted into document.body / unmounted at runtime.
let floating: Record<string, unknown> | null = null;

export function toggleFloatingRoot(): boolean {
  if (floating) {
    void unmount(floating);
    floating = null;
  } else {
    floating = mount(Floating, { target: document.body, props: { createdAt: Date.now() } });
  }
  return floating !== null;
}
