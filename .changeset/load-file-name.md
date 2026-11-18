---
'@sveltejs/vite-devtools-svelte': patch
---

The Load functions panel shows only the load file's name (such as `+layout.server.ts`) next to the route, so layout and page loads on the same route are easy to tell apart. The full path is in the tooltip, and the Type column is removed since the file name already shows it.
