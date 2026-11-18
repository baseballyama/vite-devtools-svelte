---
'@sveltejs/vite-devtools-svelte': patch
---

The Routes panel, the `get_routes` MCP tool and load profiling now use the routes directory set with `files.routes` in `sveltekit()`, instead of always `src/routes`.
