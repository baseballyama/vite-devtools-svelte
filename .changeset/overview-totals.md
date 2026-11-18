---
'@sveltejs/vite-devtools-svelte': minor
---

feat: the Reactivity Components overview and the `get_reactive_summary` MCP tool now show each live instance's totals since it mounted and when it was last active, instead of the last 10 seconds. The tool's `windowMs` argument and `window` field are removed; use `computedAt` and each row's `lastActiveAt` instead.
