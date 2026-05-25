# vite-devtools-svelte

## 0.2.0

### Minor Changes

- [#50](https://github.com/baseballyama/vite-devtools-svelte/pull/50) [`81edcfd`](https://github.com/baseballyama/vite-devtools-svelte/commit/81edcfdedd72b3444fc90b0584e70bb0b1d27718) Thanks [@baseballyama](https://github.com/baseballyama)! - Add MCP (Model Context Protocol) endpoint at `/__svelte-devtools/mcp` so AI agents such as Claude Code can read performance metrics and run measurement sessions autonomously.

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

### Patch Changes

- [#42](https://github.com/baseballyama/vite-devtools-svelte/pull/42) [`55947f6`](https://github.com/baseballyama/vite-devtools-svelte/commit/55947f6cfaa398c35d4a9e138520f217627cd955) Thanks [@renovate](https://github.com/apps/renovate)! - Bump `@vitejs/devtools-kit` to `^0.2.0` and raise the `vite` peer-dependency range floor to `^8.0.14`.

## 0.1.2

### Patch Changes

- [#39](https://github.com/baseballyama/vite-devtools-svelte/pull/39) [`8e5c7fd`](https://github.com/baseballyama/vite-devtools-svelte/commit/8e5c7fdf1beb440ef687dba836e1d06f44825a09) Thanks [@baseballyama](https://github.com/baseballyama)! - Bump `@vitejs/devtools-kit` to `^0.1.23` to track upstream Vite DevTools, and fix the upstream link in the README to point at `vitejs/devtools`.

## 0.1.1

### Patch Changes

- [`9f9f146`](https://github.com/baseballyama/vite-devtools-svelte/commit/9f9f146674663f4e69e908e17c6f78033b3bf1f6) Thanks [@baseballyama](https://github.com/baseballyama)! - Include README and LICENSE in the published npm package so the package page renders documentation, screenshots, and the MIT license alongside the source.

## 0.1.0

### Minor Changes

- initial release
