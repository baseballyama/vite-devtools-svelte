---
'@sveltejs/vite-devtools-svelte': patch
---

The Overview panel now asks the dev server for counts instead of the full module graph and live component list, so opening it and mounting components cost less on large apps. `LiveComponentsMeta` gained a `files` count.
