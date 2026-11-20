---
'@sveltejs/vite-devtools-svelte': minor
---

Add the `get_remote_functions` MCP tool, which lists every SvelteKit remote function in `*.remote.ts` files under `src` with its kind, file, line and request id. It loads those modules in the dev server, so their top-level code runs.
