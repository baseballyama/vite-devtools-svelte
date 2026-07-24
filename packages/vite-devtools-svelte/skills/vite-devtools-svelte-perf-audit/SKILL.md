---
name: vite-devtools-svelte:perf-audit
description: Use when the user asks to audit Svelte/SvelteKit app performance, find render hotspots, or identify what to optimize. Requires the vite-devtools-svelte MCP server to be registered (the dev server prints `claude mcp add ...` on startup). Always interactive — the user picks which issues to fix; never starts editing on its own.
---

# Svelte performance audit

You are auditing a running Svelte/SvelteKit dev server through the `svelte` MCP server provided by `vite-devtools-svelte`.

## Preconditions

1. The dev server is running and the user has registered the MCP endpoint with `claude mcp add` (the dev server prints the exact command on startup).
2. The user has exercised the app at least once in a browser — render/load/fps buffers are empty until traffic flows.

If either is missing, stop and tell the user what to do; do not invent metrics.

## Workflow

1. Call `start_session` with `label: "baseline-<short description>"` and `persist: false`. Tell the user that they should now use the app in the browser (golden path + any flow they care about) for ~10–30 seconds.
2. Wait for the user to confirm they are done exercising the app. Do not poll.
3. Call `end_session` with `keep: "memory"`. Note the session id from the response — you will need it later.
4. Call `list_performance_issues` (no thresholds first; defaults are sensible). Read the `issues` array.
5. Present the top 3 issues to the user as a compact table: `severity | kind | summary | file`. Add any context from the `metric` field that aids interpretation.
6. Ask the user which issue (if any) to investigate. **Do not implement fixes in this skill.** Hand off to `/vite-devtools-svelte:perf-fix <issue id or summary>` once they pick one.

## Guardrails

- Never claim performance improved without a `compare_sessions` result. This skill produces only the _before_ baseline.
- If `list_performance_issues` returns an empty list, say so and ask the user whether to lower thresholds or exercise additional flows — do not fabricate issues.
- The reactive graph view depends on the browser being open; if `get_reactive_graph_problems` returns empty categories, ask the user to keep the page open and retry.
- Session disposal: at the end, ask whether to keep the baseline (`keep: "memory"` for this session, or persist with `keep: "disk"`). Do not silently retain or delete.
