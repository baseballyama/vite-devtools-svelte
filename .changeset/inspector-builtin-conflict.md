---
'@sveltejs/vite-devtools-svelte': minor
---

breaking: with Vite DevTools, the dev server fails to start while `vitePlugin.inspector` turns on vite-plugin-svelte's own inspector. Remove that option, or pass `inspector: false`.
