---
'vite-devtools-svelte': minor
---

Add MCP (Model Context Protocol) endpoint at `/__svelte-devtools/mcp` so AI agents such as Claude Code can read performance metrics and run measurement sessions autonomously.

The MCP server is **read + measure only** — it never edits files. Editing is left to the agent's own tools, which keeps the permission boundary clean and lets `git` own rollback.

**Tools exposed**

- `list_performance_issues` — cross-cuts render / reactive / load / fps and returns ranked issues with `suggestedTool` for drill-down.
- `get_component_hotspots`, `get_reactive_graph_problems`, `get_load_waterfall`, `get_fps_drops`, `get_render_profile` — detail views.
- `get_project_info`, `get_routes`, `get_live_components`, `get_component_relations` — context.
- `start_session`, `end_session`, `compare_sessions`, `list_sessions`, `load_session`, `delete_session` — bracket a measurement window so the agent can diff before/after a fix. `persist:true` (or `end_session` with `keep:"disk"`) writes to `node_modules/.vite-devtools-svelte/sessions/`; otherwise sessions stay in memory.

The endpoint reuses the existing per-process random token used by the panel UI. On dev-server startup the plugin prints a copy-pasteable `claude mcp add` command including the URL and token.

**Skills** shipped under `node_modules/vite-devtools-svelte/skills/`:

- `vite-devtools-svelte:perf-audit` — captures a baseline session, calls `list_performance_issues`, and presents the top issues for the user to triage.
- `vite-devtools-svelte:perf-fix` — one issue per run: baseline → edit → after → `compare_sessions`, with `verdict` reported verbatim and an explicit revert path if the change regresses or has no effect.
