---
'@sveltejs/vite-devtools-svelte': patch
---

Routes, API endpoints, the social preview and load profiling now follow the `files.routes` option of `sveltekit()` instead of assuming `src/routes`, and are empty without SvelteKit. `ProjectInfo` no longer has `routesDir`.
