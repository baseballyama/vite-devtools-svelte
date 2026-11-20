---
'@sveltejs/vite-devtools-svelte': minor
---

The Render panel is replaced by a Performance panel: press Record, use your app, then Stop to see every update with the state change that triggered it, how long it took, and where the time went per component (DOM updates, `$effect`, `$derived`), plus `$derived` re-runs that returned the same value. Old `#/render` links open it, and MCP agents can do the same with the new `start_performance_recording`, `stop_performance_recording` and `get_performance_recording` tools.
