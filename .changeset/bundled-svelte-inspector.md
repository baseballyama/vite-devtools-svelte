---
'@sveltejs/vite-devtools-svelte': minor
---

feat: add the Svelte Inspector to the Vite DevTools dock: hold `alt-x` in your app and click an element to open its source (`inspector: false` leaves it out, and `svelte` is now a peer dependency). With Vite DevTools, the dev server now fails to start while `vitePlugin.inspector` turns on vite-plugin-svelte's own inspector: remove that option, or pass `inspector: false`.
