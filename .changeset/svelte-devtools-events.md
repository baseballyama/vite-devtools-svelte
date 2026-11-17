---
'@sveltejs/vite-devtools-svelte': minor
---

Track components, signals and effects through Svelte's devtools events (`svelte/internal/devtools`), which requires a Svelte build with that channel, and also record loads that run in the browser. Remove the `componentTracking` option (tracking is always on in development), the `window.__SVELTE_DEVTOOLS__` global, and the `windowMs` argument of the `get_reactive_summary` MCP tool.
