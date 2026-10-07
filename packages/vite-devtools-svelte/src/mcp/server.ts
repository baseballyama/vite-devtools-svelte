import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type {
  RenderProfile,
  ReactiveGraph,
  LoadProfile,
  FpsSample,
  ComponentInstance,
  ProjectInfo,
  RouteInfo,
  ComponentRelation,
  CaptureInfoMap,
  ReactiveGraphRequest,
  ReactiveGraphResult,
  ReactiveSummary,
  ReactiveSummaryRequest,
  StateTimelineDelta,
} from '../types.js'
import { listPerformanceIssues, summarizeReactiveProblems } from './issues.js'
import type { SessionStore } from './sessions.js'
import { isSessionId } from './sessions.js'
import { avg, avgRenderTime, max, min, round } from './stats.js'

export interface McpDeps {
  getProject: () => ProjectInfo
  getRoutes: () => RouteInfo[]
  /** The served page load's components with its epoch, read together. */
  getLiveSnapshot: () => { epoch: string | null; total: number; components: ComponentInstance[] }
  getComponentRelations: () => ComponentRelation[]
  getRenderProfiles: () => RenderProfile[]
  /** Resolves with the current reactive graph after refreshing from the browser. */
  getReactiveGraph: () => Promise<ReactiveGraph>
  getLoadProfiles: () => LoadProfile[]
  getFpsSamples: () => FpsSample[]
  sessions: SessionStore
  // Bounded reactivity tools (docs/devframe-migration.md §6.7).
  getReactiveSummary: (req: ReactiveSummaryRequest) => Promise<ReactiveSummary>
  getReactiveScope: (req: ReactiveGraphRequest) => Promise<ReactiveGraphResult>
  getStateTimelineDelta: (since?: number) => StateTimelineDelta
  getCaptureInfo: () => CaptureInfoMap
}

/** Most timeline entries one `get_state_timeline` call returns. */
export const MCP_TIMELINE_LIMIT = 500
/** Default / largest JSON size of one old/new value in `get_state_timeline` output. */
const MCP_VALUE_CHARS = { default: 2048, max: 32768 } as const

/** A state value for MCP output: as is when small, otherwise a size summary. */
function capValue(value: unknown, maxChars: number): unknown {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    return { omitted: 'not serializable' }
  }
  if (json === undefined || json.length <= maxChars) return value
  return {
    omitted: 'too large',
    chars: json.length,
    preview: json.slice(0, Math.min(200, maxChars)),
  }
}

/** Session ids as issued by `start_session`; anything else is rejected before the store. */
const sessionId = z.string().max(64).refine(isSessionId, 'not a session id')

/** A tool answer: `value` as pretty JSON (strings as is). */
function text(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

const error = (message: string) => ({ ...text(message), isError: true })

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({
    name: 'vite-devtools-svelte',
    version: '0.1.0',
  })

  // --- read tools: issue surface ---

  server.registerTool(
    'list_performance_issues',
    {
      title: 'List performance issues',
      description:
        'Cross-cuts render/reactive/load/fps metrics and returns ranked issues. The entry point for AI-driven performance audits. Each issue carries `suggestedTool` naming the detail tool to call next.',
      // Bounded like the detail tools: 0 or a negative threshold flagged
      // every component / load, including never-rendered ones.
      inputSchema: {
        avgRenderTimeMs: z.number().positive().optional(),
        renderCount: z.number().int().min(1).optional(),
        loadDurationMs: z.number().positive().optional(),
        fpsDropThreshold: z.number().min(1).max(120).optional(),
        effectMaxDeps: z.number().int().min(1).optional(),
      },
    },
    async thresholds => {
      const issues = listPerformanceIssues(
        {
          renderProfiles: deps.getRenderProfiles(),
          reactiveGraph: await deps.getReactiveGraph(),
          loadProfiles: deps.getLoadProfiles(),
          fpsSamples: deps.getFpsSamples(),
        },
        thresholds,
      )
      return text({ count: issues.length, issues })
    },
  )

  server.registerTool(
    'get_component_hotspots',
    {
      title: 'Component render hotspots',
      description: 'Top components by total render time, with render count and per-render average.',
      inputSchema: { topN: z.number().int().min(1).max(200).optional() },
    },
    ({ topN = 20 }) => {
      const list = deps
        .getRenderProfiles()
        .map(p => ({
          file: p.file,
          name: p.name,
          componentId: p.componentId,
          renderCount: p.renderCount,
          totalRenderTimeMs: round(p.totalRenderTime),
          avgRenderTimeMs: round(avgRenderTime(p)),
          lastRenderTimeMs: round(p.lastRenderTime),
          lastRenderAt: p.lastRenderAt,
        }))
        .toSorted((a, b) => b.totalRenderTimeMs - a.totalRenderTimeMs)
        .slice(0, topN)
      return text(list)
    },
  )

  server.registerTool(
    'get_reactive_graph_problems',
    {
      title: 'Reactive graph problems',
      description:
        'Classified reactive graph issues: over-connected effects, orphan deriveds (declared but never evaluated so far — may still be read later, e.g. in a branch not shown yet), isolated nodes (no tracked dependency or reader; reads from the markup count as readers). Returns categories instead of the full graph.',
      inputSchema: { effectMaxDeps: z.number().int().min(1).optional() },
    },
    async ({ effectMaxDeps }) =>
      text(summarizeReactiveProblems(await deps.getReactiveGraph(), { effectMaxDeps })),
  )

  server.registerTool(
    'get_load_waterfall',
    {
      title: 'SvelteKit load waterfall',
      description:
        'Load profiles grouped by route, with timing and data size. Optionally filtered by route.',
      inputSchema: { route: z.string().optional() },
    },
    ({ route }) => {
      const profiles = deps.getLoadProfiles().filter(p => !route || p.route === route)
      const byRoute = new Map<string, LoadProfile[]>()
      for (const p of profiles) {
        const group = byRoute.get(p.route)
        if (group) group.push(p)
        else byRoute.set(p.route, [p])
      }
      const groups = [...byRoute].map(([r, ps]) => {
        const durations = ps.map(p => p.duration)
        return {
          route: r,
          file: ps[0]?.file,
          count: ps.length,
          avgDuration: round(avg(durations)),
          maxDuration: round(max(durations, 0)),
          totalDataBytes: ps.reduce((s, p) => s + p.dataSize, 0),
          samples: ps,
        }
      })
      return text(groups.toSorted((a, b) => b.avgDuration - a.avgDuration))
    },
  )

  server.registerTool(
    'get_fps_drops',
    {
      title: 'FPS drops',
      description: 'Samples whose FPS fell below `threshold`. Returns timestamp + fps for each.',
      inputSchema: {
        threshold: z.number().min(1).max(120).optional(),
        sinceMs: z.number().nonnegative().optional(),
      },
    },
    ({ threshold = 40, sinceMs }) => {
      const cutoff = sinceMs === undefined ? -Infinity : Date.now() - sinceMs
      const samples = deps.getFpsSamples().filter(s => s.timestamp >= cutoff)
      const drops = samples.filter(s => s.fps < threshold)
      return text({
        threshold,
        sampleCount: samples.length,
        dropCount: drops.length,
        minFps: min(
          drops.map(s => s.fps),
          null,
        ),
        drops,
      })
    },
  )

  server.registerTool(
    'get_render_profile',
    {
      title: 'Render profile for a specific file',
      description:
        'Returns render profile entries matching the given component file (substring match).',
      inputSchema: { file: z.string() },
    },
    ({ file }) => {
      const matches = deps
        .getRenderProfiles()
        .filter(p => p.file.includes(file))
        .map(p => ({
          componentId: p.componentId,
          file: p.file,
          name: p.name,
          initTime: p.initTime,
          renderCount: p.renderCount,
          totalRenderTime: p.totalRenderTime,
          lastRenderTime: p.lastRenderTime,
          lastRenderAt: p.lastRenderAt,
          totalRenderTimeMs: round(p.totalRenderTime),
          avgRenderTimeMs: round(avgRenderTime(p)),
        }))
      return text(matches)
    },
  )

  // --- context tools ---

  server.registerTool(
    'get_project_info',
    {
      title: 'Project info',
      description: 'Package name/version, Svelte / SvelteKit / Vite versions, dependency lists.',
      inputSchema: {},
    },
    () => text(deps.getProject()),
  )

  server.registerTool(
    'get_routes',
    {
      title: 'SvelteKit routes',
      description: 'Static analysis of the SvelteKit routes tree.',
      inputSchema: {},
    },
    () => text(deps.getRoutes()),
  )

  server.registerTool(
    'get_live_components',
    {
      title: 'Currently mounted components',
      description:
        'Component instances with file, parent, mounted status as currently mounted in the browser (an array, parents first). With `includeMeta: true` the answer is `{ epoch, total, captured, truncated, components }` instead, limited to `limit` (default 1000): component ids are only valid within that `epoch` (one page load), so pass both to get_reactive_scope.',
      inputSchema: {
        includeMeta: z.boolean().optional(),
        limit: z.number().int().min(1).max(50000).optional(),
      },
    },
    ({ includeMeta, limit }) => {
      const snap = deps.getLiveSnapshot()
      // Unchanged default: the bare array older clients expect (`limit` only when given).
      if (!includeMeta) return text(snap.components.slice(0, limit))
      const cap = limit ?? 1000
      return text({
        epoch: snap.epoch,
        total: snap.total,
        captured: snap.components.length,
        truncated: snap.total > snap.components.length || snap.components.length > cap,
        components: snap.components.slice(0, cap),
      })
    },
  )

  server.registerTool(
    'get_component_relations',
    {
      title: 'Component import graph',
      description: 'Static import relations between .svelte components.',
      inputSchema: {},
    },
    () => text(deps.getComponentRelations()),
  )

  // --- bounded reactivity tools (read only; every answer says what it covers) ---

  server.registerTool(
    'get_reactive_summary',
    {
      title: 'Reactive overview (top components)',
      description:
        'Busiest component instances from runtime counters over all instances, without capturing the graph. Counts are sampled state changes (at most one per state per 200 ms) and renders within the window, not rates. Tracked: state created during component init and shared state of .svelte.js/.ts modules (rows with kind "module"; their componentId is a module scope id, usable with get_reactive_scope). `rows` + `other` add up to the totals; null means unknown. Use get_reactive_scope with a componentId to look at one instance. The same request is answered from a cache for up to 1 s; `window.until` says when the answer was computed.',
      inputSchema: {
        topK: z.number().int().min(1).max(200).optional(),
        windowMs: z.number().int().min(1000).max(60000).optional(),
      },
    },
    async ({ topK, windowMs }) => text(await deps.getReactiveSummary({ topK, windowMs })),
  )

  server.registerTool(
    'get_reactive_scope',
    {
      title: 'Reactive graph of one component',
      description:
        "$state/$derived/$effect nodes of one component instance and their direct neighbours, built in the app within the caps. Edges mean 'can affect' (current dependencies), not a recorded cause. `componentId` requires the `epoch` it came from (get_live_components with includeMeta): after a reload the answer is empty with staleReason 'epoch-changed' instead of another instance. Omit componentId only for the whole-app graph (capped; see total/truncated). The same request may be answered from a cache for up to 1 s; `computedAt` says when the app built the graph (null when unknown or for an empty fallback). `stale: true` only marks a fallback after the app did not answer (an earlier answer with its own computedAt, or empty).",
      inputSchema: {
        componentId: z.number().int().nonnegative().optional(),
        epoch: z.string().max(200).optional(),
        maxNodes: z.number().int().min(1).max(5000).optional(),
        maxEdges: z.number().int().min(1).max(20000).optional(),
      },
    },
    async ({ componentId, epoch, maxNodes, maxEdges }) => {
      if (componentId !== undefined && epoch === undefined) {
        return error('componentId requires epoch (from get_live_components with includeMeta: true)')
      }
      return text(await deps.getReactiveScope({ componentId, epoch, maxNodes, maxEdges }))
    },
  )

  server.registerTool(
    'get_state_timeline',
    {
      title: 'State changes since a cursor',
      description:
        'Sampled $state changes (200 ms) after `since` (the cursor from the previous call). Contains values of state in the running app. `reset: true` means the cursor was stale and this is the whole buffer. At most `limit` newest entries are returned; `omitted` counts older ones in the range that were left out. Values larger than `maxValueChars` (JSON) are replaced by a size summary. Timestamps are detection times, so order within about a second is not causal.',
      inputSchema: {
        since: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(MCP_TIMELINE_LIMIT).optional(),
        maxValueChars: z.number().int().min(16).max(MCP_VALUE_CHARS.max).optional(),
      },
    },
    ({ since, limit = 100, maxValueChars = MCP_VALUE_CHARS.default }) => {
      const delta = deps.getStateTimelineDelta(since)
      const omitted = Math.max(0, delta.changes.length - limit)
      // Copies: the entries are the collector's stored timeline, never mutate them.
      // oxlint-disable-next-line oxc/no-map-spread -- copy-on-write of shared state is the point
      const changes = delta.changes.slice(omitted).map(c => ({
        ...c,
        oldValue: capValue(c.oldValue, maxValueChars),
        newValue: capValue(c.newValue, maxValueChars),
      }))
      return text({ ...delta, changes, omitted, maxValueChars })
    },
  )

  server.registerTool(
    'get_capture_info',
    {
      title: 'What the DevTools hold versus what the app reported',
      description:
        'Per dataset: captured count, total (null = unknown), truncated, selection policy and dropped counts by reason. Read this before drawing conclusions from capped data.',
      inputSchema: {},
    },
    () => text(deps.getCaptureInfo()),
  )

  // --- session tools ---

  server.registerTool(
    'start_session',
    {
      title: 'Start measurement session',
      description:
        'Begin capturing metrics under a labelled session. Required before compare_sessions. Set `persist:true` to write to disk on end; otherwise the session lives in memory only.',
      inputSchema: {
        label: z.string().max(256),
        persist: z.boolean().optional(),
      },
    },
    ({ label, persist = false }) => {
      const rec = deps.sessions.start(label, persist)
      return text({ id: rec.id, label: rec.label, startedAt: rec.startedAt, persist: rec.persist })
    },
  )

  server.registerTool(
    'end_session',
    {
      title: 'End current measurement session',
      description:
        'Closes the active session and returns its delta. `keep` decides disposal: "memory" keeps it for this dev-server lifetime, "disk" writes to .vite-devtools-svelte/sessions/, "discard" deletes it.',
      inputSchema: {
        keep: z.enum(['memory', 'disk', 'discard']).optional(),
      },
    },
    ({ keep = 'memory' }) => {
      const rec = deps.sessions.end(keep)
      return text({
        id: rec.id,
        label: rec.label,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        keep,
        // From the record: a discarded session is no longer in the store.
        delta: deps.sessions.deltaOf(rec),
      })
    },
  )

  server.registerTool(
    'compare_sessions',
    {
      title: 'Compare two sessions',
      description:
        'Diff render / load / fps metrics between two ended sessions. Each section carries `verdict`: improved | regressed | unchanged.',
      inputSchema: { a: sessionId, b: sessionId },
    },
    ({ a, b }) => text(deps.sessions.compare(a, b)),
  )

  server.registerTool(
    'list_sessions',
    {
      title: 'List sessions',
      description: 'In-memory + on-disk sessions, most recent first.',
      inputSchema: {},
    },
    () => text(deps.sessions.list()),
  )

  server.registerTool(
    'load_session',
    {
      title: 'Load a session by id',
      description: 'Returns the full session record (including delta if ended) by id.',
      inputSchema: { id: sessionId },
    },
    ({ id }) => {
      const rec = deps.sessions.get(id)
      if (!rec) return error(`Session not found: ${id}`)
      const delta = rec.endedAt === undefined ? null : deps.sessions.deltaOf(rec)
      return text({ ...rec, delta })
    },
  )

  server.registerTool(
    'delete_session',
    {
      title: 'Delete a session',
      description: 'Removes a session from memory and disk.',
      inputSchema: { id: sessionId },
    },
    ({ id }) => text({ deleted: deps.sessions.delete(id) }),
  )

  return server
}
