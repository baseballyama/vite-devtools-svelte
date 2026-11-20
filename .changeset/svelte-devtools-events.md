---
'@sveltejs/vite-devtools-svelte': minor
---

Track components, signals and effects through Svelte's devtools events (`svelte/internal/devtools`), which requires a Svelte build with that channel (with an older Svelte, the plugin warns and the app runs without tracking). Remove the `componentTracking` option (tracking is always on in development) and the `window.__SVELTE_DEVTOOLS__` global.
