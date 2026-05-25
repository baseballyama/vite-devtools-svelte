import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
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
} from '../types.js'
import { SessionStore } from './sessions.js'
import {
  listPerformanceIssues,
  summarizeReactiveProblems,
  type IssueThresholds,
} from './issues.js'

export interface McpDeps {
  getProject: () => ProjectInfo
  getRoutes: () => RouteInfo[]
  getLiveComponents: () => ComponentInstance[]
  getComponentRelations: () => ComponentRelation[]
  getRenderProfiles: () => RenderProfile[]
  /** Resolves with the current reactive graph after refreshing from the browser. */
  getReactiveGraph: () => Promise<ReactiveGraph>
  getLoadProfiles: () => LoadProfile[]
  getFpsSamples: () => FpsSample[]
  sessions: SessionStore
}

const TEXT = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

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
      inputSchema: {
        avgRenderTimeMs: z.number().optional(),
        renderCount: z.number().optional(),
        loadDurationMs: z.number().optional(),
        fpsDropThreshold: z.number().optional(),
        effectMaxDeps: z.number().optional(),
      },
    },
    async (args) => {
      const thresholds: IssueThresholds = args
      const reactiveGraph = await deps.getReactiveGraph()
      const issues = listPerformanceIssues(
        {
          renderProfiles: deps.getRenderProfiles(),
          reactiveGraph,
          loadProfiles: deps.getLoadProfiles(),
          fpsSamples: deps.getFpsSamples(),
        },
        thresholds,
      )
      return TEXT({ count: issues.length, issues })
    },
  )

  server.registerTool(
    'get_component_hotspots',
    {
      title: 'Component render hotspots',
      description: 'Top components by total render time, with render count and per-render average.',
      inputSchema: { topN: z.number().int().min(1).max(200).optional() },
    },
    async ({ topN = 20 }) => {
      const list = [...deps.getRenderProfiles()]
        .map(p => ({
          file: p.file,
          name: p.name,
          componentId: p.componentId,
          renderCount: p.renderCount,
          totalRenderTimeMs: round(p.totalRenderTime),
          avgRenderTimeMs: round(p.renderCount > 0 ? p.totalRenderTime / p.renderCount : 0),
          lastRenderTimeMs: round(p.lastRenderTime),
          lastRenderAt: p.lastRenderAt,
        }))
        .sort((a, b) => b.totalRenderTimeMs - a.totalRenderTimeMs)
        .slice(0, topN)
      return TEXT(list)
    },
  )

  server.registerTool(
    'get_reactive_graph_problems',
    {
      title: 'Reactive graph problems',
      description:
        'Classified reactive graph issues: over-connected effects, orphan deriveds, isolated nodes. Returns categories instead of the full graph.',
      inputSchema: { effectMaxDeps: z.number().int().min(1).optional() },
    },
    async ({ effectMaxDeps }) => {
      const graph = await deps.getReactiveGraph()
      return TEXT(summarizeReactiveProblems(graph, { effectMaxDeps }))
    },
  )

  server.registerTool(
    'get_load_waterfall',
    {
      title: 'SvelteKit load waterfall',
      description: 'Load profiles grouped by route, with timing and data size. Optionally filtered by route.',
      inputSchema: { route: z.string().optional() },
    },
    async ({ route }) => {
      let profiles = deps.getLoadProfiles()
      if (route) profiles = profiles.filter(p => p.route === route)
      const byRoute = new Map<string, LoadProfile[]>()
      for (const p of profiles) {
        const arr = byRoute.get(p.route) ?? []
        arr.push(p)
        byRoute.set(p.route, arr)
      }
      const groups = [...byRoute.entries()].map(([r, ps]) => {
        const durations = ps.map(p => p.duration)
        return {
          route: r,
          file: ps[0]?.file,
          count: ps.length,
          avgDuration: round(avg(durations)),
          maxDuration: round(Math.max(...durations)),
          totalDataBytes: ps.reduce((s, p) => s + p.dataSize, 0),
          samples: ps,
        }
      })
      return TEXT(groups.sort((a, b) => b.avgDuration - a.avgDuration))
    },
  )

  server.registerTool(
    'get_fps_drops',
    {
      title: 'FPS drops',
      description: 'Samples whose FPS fell below `threshold`. Returns timestamp + fps for each.',
      inputSchema: {
        threshold: z.number().min(1).max(120).optional(),
        sinceMs: z.number().optional(),
      },
    },
    async ({ threshold = 40, sinceMs }) => {
      let samples = deps.getFpsSamples()
      if (sinceMs !== undefined) {
        const cutoff = Date.now() - sinceMs
        samples = samples.filter(s => s.timestamp >= cutoff)
      }
      const drops = samples.filter(s => s.fps < threshold)
      return TEXT({
        threshold,
        sampleCount: samples.length,
        dropCount: drops.length,
        minFps: drops.length ? Math.min(...drops.map(s => s.fps)) : null,
        drops,
      })
    },
  )

  server.registerTool(
    'get_render_profile',
    {
      title: 'Render profile for a specific file',
      description: 'Returns render profile entries matching the given component file (substring match).',
      inputSchema: { file: z.string() },
    },
    async ({ file }) => {
      const matches = deps
        .getRenderProfiles()
        .filter(p => p.file.includes(file))
        .map(p => ({
          ...p,
          totalRenderTimeMs: round(p.totalRenderTime),
          avgRenderTimeMs: round(p.renderCount > 0 ? p.totalRenderTime / p.renderCount : 0),
        }))
      return TEXT(matches)
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
    async () => TEXT(deps.getProject()),
  )

  server.registerTool(
    'get_routes',
    {
      title: 'SvelteKit routes',
      description: 'Static analysis of the SvelteKit routes tree.',
      inputSchema: {},
    },
    async () => TEXT(deps.getRoutes()),
  )

  server.registerTool(
    'get_live_components',
    {
      title: 'Currently mounted components',
      description: 'Component instances with file, parent, mounted status as currently mounted in the browser.',
      inputSchema: {},
    },
    async () => TEXT(deps.getLiveComponents()),
  )

  server.registerTool(
    'get_component_relations',
    {
      title: 'Component import graph',
      description: 'Static import relations between .svelte components.',
      inputSchema: {},
    },
    async () => TEXT(deps.getComponentRelations()),
  )

  // --- session tools ---

  server.registerTool(
    'start_session',
    {
      title: 'Start measurement session',
      description:
        'Begin capturing metrics under a labelled session. Required before compare_sessions. Set `persist:true` to write to disk on end; otherwise the session lives in memory only.',
      inputSchema: {
        label: z.string(),
        persist: z.boolean().optional(),
      },
    },
    async ({ label, persist = false }) => {
      const rec = deps.sessions.start(label, persist)
      return TEXT({ id: rec.id, label: rec.label, startedAt: rec.startedAt, persist: rec.persist })
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
    async ({ keep = 'memory' }) => {
      const rec = deps.sessions.end(keep)
      const delta = rec.endedAt ? deps.sessions.delta(rec.id) : null
      return TEXT({
        id: rec.id,
        label: rec.label,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        keep,
        delta,
      })
    },
  )

  server.registerTool(
    'compare_sessions',
    {
      title: 'Compare two sessions',
      description:
        'Diff render / load / fps metrics between two ended sessions. Each section carries `verdict`: improved | regressed | unchanged.',
      inputSchema: { a: z.string(), b: z.string() },
    },
    async ({ a, b }) => TEXT(deps.sessions.compare(a, b)),
  )

  server.registerTool(
    'list_sessions',
    {
      title: 'List sessions',
      description: 'In-memory + on-disk sessions, most recent first.',
      inputSchema: {},
    },
    async () => TEXT(deps.sessions.list()),
  )

  server.registerTool(
    'load_session',
    {
      title: 'Load a session by id',
      description: 'Returns the full session record (including delta if ended) by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const rec = deps.sessions.get(id)
      if (!rec) return TEXT({ error: `Session not found: ${id}` })
      const delta = rec.endedAt ? deps.sessions.delta(id) : null
      return TEXT({ ...rec, delta })
    },
  )

  server.registerTool(
    'delete_session',
    {
      title: 'Delete a session',
      description: 'Removes a session from memory and disk.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => TEXT({ deleted: deps.sessions.delete(id) }),
  )

  return server
}

export { StreamableHTTPServerTransport }

function avg(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
