---
'@sveltejs/vite-devtools-svelte': patch
---

The MCP server no longer depends on `@modelcontextprotocol/sdk`, so installing the plugin pulls in about 90 fewer packages. MCP clients get the same tools and answers, so nothing needs to change.
