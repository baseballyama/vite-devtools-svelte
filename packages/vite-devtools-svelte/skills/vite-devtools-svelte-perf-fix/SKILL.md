---
name: vite-devtools-svelte:perf-fix
description: Use to apply a single, scoped performance fix to a Svelte/SvelteKit app and verify the change with before/after measurements. Pairs with /vite-devtools-svelte:perf-audit (which identifies issues). One issue per invocation. Requires the vite-devtools-svelte MCP server.
---

# Svelte performance fix

You are about to fix exactly **one** performance issue and verify it with measurement. Do not bundle multiple changes.

## Inputs

The user will name an issue. Resolve it to a target by calling the matching detail tool — `get_component_hotspots`, `get_reactive_graph_problems`, `get_load_waterfall`, `get_fps_drops`, or `get_render_profile` — based on the issue `kind` / `suggestedTool` from `/vite-devtools-svelte:perf-audit`.

## Workflow

1. **Confirm scope.** Restate the target in one sentence and list the file(s) you intend to edit. Ask the user to confirm before any further work.
2. **Capture baseline.** Call `start_session({ label: "before-<issue>" , persist: false })`. Ask the user to reproduce the slow flow in the browser. When they confirm, call `end_session({ keep: "memory" })` and remember the returned `id` as `baselineId`.
3. **Propose the change.** Read the target file(s). Propose a specific diff (mention the line numbers). Ask the user to approve. Only edit after approval.
4. **Apply the change.** Use Edit/Write tools. Keep the change minimal — the goal is to attribute the diff to one cause.
5. **Capture after.** Call `start_session({ label: "after-<issue>", persist: false })`. Ask the user to repeat the same flow. On confirmation, call `end_session({ keep: "memory" })` and remember the returned `id` as `afterId`.
6. **Compare.** Call `compare_sessions({ a: baselineId, b: afterId })`. Report the three `verdict` fields (render / load / fps) verbatim alongside the absolute numbers. **Do not paraphrase "improved" if any verdict is `regressed` or `unchanged`.**
7. **Decide.** If render verdict is `regressed`, propose `git diff` and offer to revert the edit. If all verdicts are `unchanged`, ask the user whether to keep the change anyway (it may have other benefits) or revert.
8. **Dispose of sessions.** Ask: keep baseline + after in memory (default), persist with `keep: "disk"` for later analysis, or `delete_session` both.

## Guardrails

- One issue per run. If new issues become visible after the fix, surface them and end — do not chain.
- Never call `apply` / `revert` actions implicitly through Edit without showing the user the proposed change first.
- Never claim improvement without quoting the `compare_sessions` output.
- If the user has uncommitted changes before you start, point that out — the revert path becomes ambiguous otherwise.
- If the dev server restarts during the session (e.g. config change), tell the user the measurement is invalid and restart from step 2.
