---
'@sveltejs/vite-devtools-svelte': patch
---

MCP tools now answer compact JSON, `list_performance_issues` ids start with their `kind`, `get_render_profile` uses the same rounded `*Ms` fields as `get_component_hotspots` (`initTime` is now `initTimeMs`), the endpoint answers only POST (405 otherwise), and it reports the package version. The perf skills now ask whether to save a session to disk before ending it, because an ended session cannot be saved later.
