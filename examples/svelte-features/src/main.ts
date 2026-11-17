import { mount } from 'svelte';

import App from './App.svelte';
import Badge from './lib/Badge.ce.svelte';
import Widget from './roots/Widget.svelte';

// Importing a custom-element component registers <x-badge> (used in App).
void Badge;

// Root 1: the app.
mount(App, { target: document.querySelector('#app')! });
// Root 2: an independent widget mounted next to it.
mount(Widget, { target: document.querySelector('#widget')!, props: { label: 'second root' } });
// Root 3 is mounted / unmounted at runtime: src/lib/roots.ts.
