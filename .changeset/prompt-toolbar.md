---
'vite-devtools-svelte': minor
---

Add an opt-in prompt toolbar, `svelteDevtools({ promptToolbar: true })`: an Inspect button in your app's own pages (dev only) to pick elements and copy one markdown prompt with each element's source location, the components that render it, and the id an agent passes to the MCP tools to read their live state. With the toolbar enabled, element locations Svelte loses while hydrating a server-rendered page are restored.
