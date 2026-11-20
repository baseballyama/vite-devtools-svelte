---
'@sveltejs/vite-devtools-svelte': patch
---

The plugin no longer depends on `zod`; it checks RPC and MCP tool arguments with a small built-in validator. Nothing needs to change.
