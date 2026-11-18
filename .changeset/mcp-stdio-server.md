---
'@sveltejs/vite-devtools-svelte': minor
---

feat: register the MCP server once with `claude mcp add svelte-devtools -- npx @sveltejs/vite-devtools-svelte mcp`; it finds the project's running dev server by itself, and the dev server no longer prints a token. Remove the old registration first (`claude mcp remove svelte`).
