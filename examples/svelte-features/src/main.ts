import { mount } from 'svelte';

import App from './App.svelte';
import Badge from './lib/Badge.ce.svelte';
import Widget from './roots/Widget.svelte';

// Importing a custom-element component registers <x-badge> (used in App).
void Badge;

mount(App, { target: document.querySelector('#app')! });
mount(Widget, { target: document.querySelector('#widget')!, props: { label: 'second root' } });
// A third root is mounted / unmounted at runtime: src/lib/roots.ts.
