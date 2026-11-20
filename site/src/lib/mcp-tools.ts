// The MCP tools served at /__svelte-devtools/mcp, as registered in
// packages/vite-devtools-svelte/src/mcp/server.ts, and the one the stdio
// server adds (src/mcp/relay.ts). Keep names, inputs and limits in step with
// those files.

export interface McpTool {
  name: string;
  /** Input fields as `name?: type` (all optional unless marked). */
  input: string;
  summary: string;
  /** Shown as a note under the summary. */
  note?: string;
}

export interface McpToolGroup {
  id: string;
  title: string;
  intro: string;
  tools: McpTool[];
}

export const MCP_TOOL_GROUPS: McpToolGroup[] = [
  {
    id: 'reactivity',
    title: 'Reactivity (bounded)',
    intro:
      'New in 0.4.0. Each answer says what it covers: coverage, sampling, caps, page load (epoch) and whether it is stale. Start here in large apps.',
    tools: [
      {
        name: 'get_reactive_summary',
        input: 'topK?: 1–200',
        summary:
          'The busiest live component instances from runtime counters over all instances, without capturing the graph: sampled state changes and renders since each instance mounted and when it was last active, `rows` + `other` adding up to the totals.',
        note: 'Counts are totals (at most one change per state per 200 ms), not rates; a destroyed instance leaves with its counts. State changes are sampled only while a panel or an agent is watching. State created during component init and shared .svelte.js/.ts module state are tracked; module scopes are rows with kind "module", and their componentId works with get_reactive_scope. Answered from a cache for up to 1 s.',
      },
      {
        name: 'get_reactive_scope',
        input: 'componentId?: number, epoch?: string, maxNodes?: 1–5000, maxEdges?: 1–20000',
        summary:
          '$state / $derived / $effect nodes of one component instance and their direct neighbours. Without componentId: the whole-app graph, capped.',
        note: 'componentId requires the epoch it came from (get_live_components with includeMeta). After a reload the answer is empty with staleReason "epoch-changed". Edges mean "can affect", not a recorded cause.',
      },
      {
        name: 'get_state_timeline',
        input:
          'since?: cursor, limit?: 1–500 (default 100), maxValueChars?: 16–32768 (default 2048)',
        summary:
          'Sampled $state changes after a cursor, with old and new values. Pass the returned `cursor` as `since` on the next call.',
        note: '`reset: true` means the cursor was stale and this is the whole buffer (the latest 500). Larger values are replaced by a size summary. Timestamps are detection times.',
      },
      {
        name: 'get_capture_info',
        input: '—',
        summary:
          'Per dataset: how many items the DevTools hold versus what the app reported, the selection policy, and dropped counts by reason.',
        note: 'Read this before drawing conclusions from capped data.',
      },
    ],
  },
  {
    id: 'issues',
    title: 'Performance issues',
    intro: 'Ranked findings across render, reactivity, load functions and frame rate.',
    tools: [
      {
        name: 'list_performance_issues',
        input:
          'avgRenderTimeMs?, renderCount?, loadDurationMs?, fpsDropThreshold?, effectMaxDeps? (thresholds)',
        summary:
          'Cross-cuts all metrics and returns ranked issues. Each issue names the tool to call next in `suggestedTool`.',
        note: 'Reads the whole-app reactive graph, capped at 5000 nodes / 20000 edges.',
      },
      {
        name: 'get_component_hotspots',
        input: 'topN?: 1–200 (default 20)',
        summary: 'Top components by total render time, with render count and average per render.',
      },
      {
        name: 'get_render_profile',
        input: 'file: string (substring)',
        summary: 'Render profile entries of the components whose file contains `file`.',
      },
      {
        name: 'get_reactive_graph_problems',
        input: 'effectMaxDeps?: number',
        summary:
          'Over-connected effects, orphan deriveds (never evaluated so far) and isolated nodes (no tracked dependency or reader; reads from the markup count), as categories instead of the full graph.',
        note: 'Reads the whole-app reactive graph, capped at 5000 nodes / 20000 edges.',
      },
      {
        name: 'get_load_waterfall',
        input: 'route?: string',
        summary: 'SvelteKit load profiles grouped by route, with timing and data size.',
      },
      {
        name: 'get_fps_drops',
        input: 'threshold?: 1–120 (default 40), sinceMs?: number',
        summary: 'Frame-rate samples below the threshold.',
      },
    ],
  },
  {
    id: 'context',
    title: 'Project context',
    intro: 'What the app is made of, from static analysis and the running page.',
    tools: [
      {
        name: 'get_project_info',
        input: '—',
        summary: 'Package name and version, Svelte / SvelteKit / Vite versions, dependency lists.',
      },
      {
        name: 'get_routes',
        input: '—',
        summary: 'The SvelteKit routes tree from static analysis.',
      },
      {
        name: 'get_remote_functions',
        input: '—',
        summary:
          'SvelteKit remote functions in `*.remote.ts` files under `src`: kind, file, line and request id. `enabled: false` when remote functions are off.',
        note: 'Loads those modules in the dev server, so their top-level code runs.',
      },
      {
        name: 'get_live_components',
        input: 'includeMeta?: boolean, limit?: 1–50000',
        summary:
          'Component instances mounted in the browser, parents first. With includeMeta: `{ epoch, total, captured, truncated, components }`, limited to 1000 by default.',
        note: 'Component ids are only valid within that epoch (one page load).',
      },
      {
        name: 'get_component_relations',
        input: '—',
        summary: 'Static import relations between .svelte components.',
      },
    ],
  },
  {
    id: 'sessions',
    title: 'Measurement sessions',
    intro: 'Measure before and after a change, then compare.',
    tools: [
      {
        name: 'start_session',
        input: 'label: string, persist?: boolean',
        summary: 'Begin capturing metrics under a label. One session is active at a time.',
      },
      {
        name: 'end_session',
        input: 'keep?: "memory" | "disk" | "discard" (default "memory")',
        summary: 'Close the active session and return its delta.',
        note: '"disk" writes to node_modules/.vite-devtools-svelte/sessions/ in the project.',
      },
      {
        name: 'compare_sessions',
        input: 'a: session id, b: session id',
        summary:
          'Diff render, load and frame-rate metrics of two ended sessions. Each section has a verdict: improved, regressed or unchanged.',
      },
      {
        name: 'list_sessions',
        input: '—',
        summary: 'Sessions in memory and on disk, most recent first.',
      },
      {
        name: 'load_session',
        input: 'id: session id',
        summary: 'The full session record, including its delta once ended.',
      },
      {
        name: 'delete_session',
        input: 'id: session id',
        summary: 'Remove a session from memory and disk.',
      },
    ],
  },
];

/** Tools of the dev server endpoint; the stdio server adds MCP_STDIO_TOOL. */
export const MCP_TOOL_COUNT = MCP_TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);

/** Only through `vite-devtools-svelte mcp`, which also adds MCP_SERVER_INPUT to every tool. */
export const MCP_STDIO_TOOL: McpTool = {
  name: 'list_dev_servers',
  input: '—',
  summary:
    'Dev servers running with the plugin on this machine (id, package name, root, URL, start time), and which one the other tools use when `server` is omitted.',
  note: 'With VITE_DEVTOOLS_SVELTE_URL set, `override` shows that endpoint and no listed server is the default.',
};

export const MCP_SERVER_INPUT = 'server?: id from list_dev_servers, root or package name';
