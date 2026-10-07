import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
/**
 * MCP tool surface through a real client/server pair (in-memory transport):
 * the exact tool set, every tool with valid input, input validation, error
 * paths, and that the reactivity tools stay bounded and say what they cover
 * (docs/devframe-migration.md §6.7).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

import { buildMcpServer, MCP_TIMELINE_LIMIT } from '../src/mcp/server.js'
import type { McpDeps } from '../src/mcp/server.js'
import { SessionStore } from '../src/mcp/sessions.js'
import type {
  FpsSample,
  LoadProfile,
  ReactiveGraph,
  RenderProfile,
  StateTimelineEntry,
} from '../src/types.js'

const BASE_TOOLS = [
  'list_performance_issues',
  'get_component_hotspots',
  'get_reactive_graph_problems',
  'get_load_waterfall',
  'get_fps_drops',
  'get_render_profile',
  'get_project_info',
  'get_routes',
  'get_live_components',
  'get_component_relations',
  'start_session',
  'end_session',
  'compare_sessions',
  'list_sessions',
  'load_session',
  'delete_session',
]
const REACTIVITY_TOOLS = [
  'get_reactive_summary',
  'get_reactive_scope',
  'get_state_timeline',
  'get_capture_info',
]

const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const rp = (componentId: number, renderCount: number, totalRenderTime: number): RenderProfile => ({
  componentId,
  file: `/src/C${componentId}.svelte`,
  name: `C${componentId}`,
  initTime: 1,
  renderCount,
  totalRenderTime,
  lastRenderTime: 0.5,
  lastRenderAt: 99,
})
const lp = (route: string, duration: number, dataSize = 10): LoadProfile => ({
  route,
  file: `/src/routes${route}/+page.ts`,
  type: 'server',
  duration,
  dataSize,
  timestamp: 1,
})

interface Data {
  render: RenderProfile[]
  load: LoadProfile[]
  fps: FpsSample[]
  graph: ReactiveGraph
}

function makeDeps(data: Partial<Data> = {}, persistDir?: string): McpDeps & { data: Data } {
  const d: Data = { render: [], load: [], fps: [], graph: { nodes: [], edges: [] }, ...data }
  const dir = persistDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-mcp-'))
  dirs.push(dir)
  const getters = {
    getRenderProfiles: () => d.render,
    getLoadProfiles: () => d.load,
    getFpsSamples: () => d.fps,
  }
  return {
    data: d,
    getProject: () => ({ name: 'app' }) as any,
    getRoutes: () => [{ id: '/', path: '/' }] as any,
    getLiveSnapshot: () => ({ epoch: 'e1', total: 1, components: [{ id: 1 } as any] }),
    getComponentRelations: () => [{ file: 'src/A.svelte', name: 'A', imports: [] }],
    getRenderProfiles: getters.getRenderProfiles,
    getReactiveGraph: () => Promise.resolve(d.graph),
    getLoadProfiles: getters.getLoadProfiles,
    getFpsSamples: getters.getFpsSamples,
    sessions: new SessionStore({ persistDir: dir, getters }),
    getReactiveSummary: req => Promise.resolve({ req } as any),
    getReactiveScope: req => Promise.resolve({ req } as any),
    getStateTimelineDelta: () => ({ cursor: 1, reset: true, changes: [] }),
    getCaptureInfo: () => ({ components: { captured: 1 } }) as any,
  }
}

async function connect(deps: McpDeps) {
  const server = buildMcpServer(deps)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
  return client
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as ToolResult
}
const parse = (result: ToolResult) => JSON.parse(result.content[0]!.text)
/** Whether the call failed (a success may omit `isError`). */
const failed = (result: ToolResult) => result.isError === true

/** What every listed tool must carry. */
function toolShape(t: {
  name: string
  title?: string
  description?: string
  inputSchema: { type: string }
}) {
  return {
    name: t.name,
    title: typeof t.title === 'string' && t.title.length > 0,
    description: typeof t.description === 'string' && t.description.length > 10,
    schema: t.inputSchema.type,
  }
}

describe('tool registration', () => {
  it('registers exactly the documented tools', async () => {
    const { tools } = await (await connect(makeDeps())).listTools()
    expect(tools.map(t => t.name).toSorted()).toEqual(
      [...BASE_TOOLS, ...REACTIVITY_TOOLS].toSorted(),
    )
  })

  it('every tool has a title, a description and an object input schema', async () => {
    const { tools } = await (await connect(makeDeps())).listTools()
    expect(tools.map(toolShape)).toEqual(
      tools.map(t => ({ name: t.name, title: true, description: true, schema: 'object' })),
    )
  })
})

describe('every tool answers valid input', () => {
  it('calls each registered tool once and checks its answer', async () => {
    vi.useFakeTimers({ now: 10_000 })
    const deps = makeDeps({
      render: [rp(1, 40, 200), rp(2, 1, 1)],
      load: [lp('/a', 300), lp('/a', 100), lp('/b', 50)],
      fps: [
        { timestamp: 9000, fps: 20 },
        { timestamp: 9500, fps: 59 },
      ],
    })
    const client = await connect(deps)
    const { tools } = await client.listTools()

    const started = await call(client, 'start_session', { label: 'run' })
    expect(parse(started)).toMatchObject({ label: 'run', persist: false })
    const id: string = parse(started).id

    // In call order (the session tools depend on it).
    const checks: Record<string, [args: Record<string, unknown>, check: (r: any) => void]> = {
      list_performance_issues: [{}, r => expect(r.count).toBe(r.issues.length)],
      get_component_hotspots: [
        { topN: 1 },
        r => expect(r.map((x: any) => x.componentId)).toEqual([1]),
      ],
      get_reactive_graph_problems: [
        {},
        r =>
          expect(Object.keys(r).toSorted()).toEqual(['effects', 'isolatedNodes', 'orphanDeriveds']),
      ],
      get_load_waterfall: [{}, r => expect(r.map((g: any) => g.route)).toEqual(['/a', '/b'])],
      get_fps_drops: [
        {},
        r => expect(r).toMatchObject({ threshold: 40, dropCount: 1, minFps: 20 }),
      ],
      get_render_profile: [
        { file: 'C2' },
        r => expect(r.map((x: any) => x.componentId)).toEqual([2]),
      ],
      get_project_info: [{}, r => expect(r).toEqual({ name: 'app' })],
      get_routes: [{}, r => expect(r).toEqual([{ id: '/', path: '/' }])],
      get_live_components: [{}, r => expect(r).toEqual([{ id: 1 }])],
      get_component_relations: [{}, r => expect(r[0].name).toBe('A')],
      get_reactive_summary: [{ topK: 5 }, r => expect(r.req).toEqual({ topK: 5 })],
      get_reactive_scope: [{}, r => expect(r.req).toEqual({})],
      get_state_timeline: [
        {},
        r => expect(r).toMatchObject({ cursor: 1, omitted: 0, changes: [] }),
      ],
      get_capture_info: [{}, r => expect(r).toEqual({ components: { captured: 1 } })],
      end_session: [
        {},
        r => expect(r).toMatchObject({ id, keep: 'memory', delta: { durationMs: 0 } }),
      ],
      list_sessions: [{}, r => expect(r).toEqual([expect.objectContaining({ id })])],
      load_session: [
        { id },
        r => expect(r).toMatchObject({ label: 'run', delta: { durationMs: 0 } }),
      ],
      compare_sessions: [{ a: id, b: id }, r => expect(r.render.verdict).toBe('unchanged')],
      delete_session: [{ id }, r => expect(r).toEqual({ deleted: true })],
    }
    expect(['start_session', ...Object.keys(checks)].toSorted()).toEqual(
      tools.map(t => t.name).toSorted(),
    )
    for (const [name, [args, check]] of Object.entries(checks)) {
      const result = await call(client, name, args)
      expect({ name, failed: failed(result) }).toEqual({ name, failed: false })
      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.type).toBe('text')
      check(parse(result))
    }
  })
})

describe('input validation', () => {
  it.each<[tool: string, args: Record<string, unknown>]>([
    ['list_performance_issues', { avgRenderTimeMs: 0 }],
    ['list_performance_issues', { avgRenderTimeMs: -1 }],
    ['list_performance_issues', { renderCount: 0 }],
    ['list_performance_issues', { renderCount: 1.5 }],
    ['list_performance_issues', { loadDurationMs: 0 }],
    ['list_performance_issues', { fpsDropThreshold: 0 }],
    ['list_performance_issues', { fpsDropThreshold: 121 }],
    ['list_performance_issues', { effectMaxDeps: 0 }],
    ['list_performance_issues', { effectMaxDeps: 2.5 }],
    ['list_performance_issues', { avgRenderTimeMs: '4' }],
    ['get_component_hotspots', { topN: 0 }],
    ['get_component_hotspots', { topN: 201 }],
    ['get_component_hotspots', { topN: 1.5 }],
    ['get_reactive_graph_problems', { effectMaxDeps: 0 }],
    ['get_reactive_graph_problems', { effectMaxDeps: 1.5 }],
    ['get_load_waterfall', { route: 5 }],
    ['get_fps_drops', { threshold: 0 }],
    ['get_fps_drops', { threshold: 121 }],
    ['get_fps_drops', { sinceMs: -1 }],
    ['get_render_profile', {}],
    ['get_render_profile', { file: 1 }],
    ['get_live_components', { limit: 0 }],
    ['get_live_components', { limit: 50_001 }],
    ['get_live_components', { includeMeta: 'yes' }],
    ['get_reactive_summary', { topK: 0 }],
    ['get_reactive_summary', { topK: 201 }],
    ['get_reactive_summary', { windowMs: 999 }],
    ['get_reactive_summary', { windowMs: 60_001 }],
    ['get_reactive_scope', { componentId: -1, epoch: 'e' }],
    ['get_reactive_scope', { componentId: 1.5, epoch: 'e' }],
    ['get_reactive_scope', { epoch: 'x'.repeat(201) }],
    ['get_reactive_scope', { maxNodes: 0 }],
    ['get_reactive_scope', { maxNodes: 5001 }],
    ['get_reactive_scope', { maxEdges: 20_001 }],
    ['get_state_timeline', { since: -1 }],
    ['get_state_timeline', { since: 0.5 }],
    ['get_state_timeline', { limit: 0 }],
    ['get_state_timeline', { limit: MCP_TIMELINE_LIMIT + 1 }],
    ['get_state_timeline', { maxValueChars: 15 }],
    ['get_state_timeline', { maxValueChars: 32_769 }],
    ['start_session', {}],
    ['start_session', { label: 'x'.repeat(257) }],
    ['start_session', { label: 'x', persist: 'yes' }],
    ['end_session', { keep: 'forever' }],
    ['compare_sessions', { a: 's_abc_123456' }],
    ['compare_sessions', { a: '../x', b: 's_abc_123456' }],
    ['load_session', { id: '' }],
    ['load_session', { id: '../../etc/passwd' }],
    ['load_session', { id: 's_ABC_123456' }],
    ['load_session', { id: `s_${'a'.repeat(56)}_123456` }], // 65 chars
    ['delete_session', { id: 's_abc_12345' }],
  ])('%s rejects %j', async (tool, args) => {
    const deps = makeDeps()
    const spies = {
      summary: vi.spyOn(deps, 'getReactiveSummary'),
      scope: vi.spyOn(deps, 'getReactiveScope'),
      start: vi.spyOn(deps.sessions, 'start'),
    }
    const result = await call(await connect(deps), tool, args)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/validation|Invalid|expected|Too|must/i)
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
  })

  it.each<[tool: string, args: Record<string, unknown>]>([
    ['get_component_hotspots', { topN: 1 }],
    ['get_component_hotspots', { topN: 200 }],
    ['get_fps_drops', { threshold: 1 }],
    ['get_fps_drops', { threshold: 120, sinceMs: 0 }],
    ['get_live_components', { limit: 50_000 }],
    ['get_reactive_summary', { topK: 200, windowMs: 60_000 }],
    ['get_reactive_summary', { windowMs: 1000 }],
    [
      'get_reactive_scope',
      { componentId: 0, epoch: 'x'.repeat(200), maxNodes: 5000, maxEdges: 20_000 },
    ],
    ['get_state_timeline', { since: 0, limit: MCP_TIMELINE_LIMIT, maxValueChars: 16 }],
    ['get_state_timeline', { maxValueChars: 32_768 }],
    [
      'list_performance_issues',
      {
        avgRenderTimeMs: 0.1,
        renderCount: 1,
        loadDurationMs: 0.1,
        fpsDropThreshold: 120,
        effectMaxDeps: 1,
      },
    ],
  ])('%s accepts the boundary %j', async (tool, args) => {
    const result = await call(await connect(makeDeps()), tool, args)
    expect(failed(result)).toBe(false)
  })

  it('load_session accepts the longest valid id (and reports it missing)', async () => {
    const id = `s_${'a'.repeat(16)}_123456`
    const result = await call(await connect(makeDeps()), 'load_session', { id })
    expect(result.content[0]!.text).toBe(`Session not found: ${id}`)
  })
})

describe('error paths', () => {
  it('end_session without a started session is an error', async () => {
    const result = await call(await connect(makeDeps()), 'end_session')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch('No active session')
  })

  it('start_session while one is active is an error', async () => {
    const client = await connect(makeDeps())
    await call(client, 'start_session', { label: 'a' })
    const result = await call(client, 'start_session', { label: 'b' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch('already active')
  })

  it('compare_sessions with an unknown id is an error', async () => {
    const result = await call(await connect(makeDeps()), 'compare_sessions', {
      a: 's_abc_123456',
      b: 's_abc_654321',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch('Session not found: s_abc_123456')
  })

  it('compare_sessions with an unended session is an error', async () => {
    const client = await connect(makeDeps())
    const { id } = parse(await call(client, 'start_session', { label: 'a' }))
    const result = await call(client, 'compare_sessions', { a: id, b: id })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch('has not been ended yet')
  })

  it.each<[label: string, files: Record<string, string>]>([
    ['missing', {}],
    ['corrupted', { 's_abc_123456.json': '{"id": "s_abc_123456",' }],
    ['incomplete', { 's_abc_123456.json': JSON.stringify({ id: 's_abc_123456', label: 'x' }) }],
  ])('load_session of a %s file is an error result', async (_label, files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-mcp-'))
    for (const [name, content] of Object.entries(files))
      fs.writeFileSync(path.join(dir, name), content)
    const result = await call(await connect(makeDeps({}, dir)), 'load_session', {
      id: 's_abc_123456',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('Session not found: s_abc_123456')
  })

  it('load_session of an active session has no delta yet', async () => {
    const client = await connect(makeDeps())
    const { id } = parse(await call(client, 'start_session', { label: 'a' }))
    expect(parse(await call(client, 'load_session', { id }))).toMatchObject({ id, delta: null })
  })

  it('delete_session of an unknown session reports deleted: false', async () => {
    const result = await call(await connect(makeDeps()), 'delete_session', { id: 's_abc_123456' })
    expect(parse(result)).toEqual({ deleted: false })
  })

  it('a failing dependency surfaces as an error result', async () => {
    const deps = makeDeps()
    deps.getReactiveGraph = () => Promise.reject(new Error('app did not answer'))
    const result = await call(await connect(deps), 'list_performance_issues')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch('app did not answer')
  })
})

describe('session tools', () => {
  it.each<[keep: 'memory' | 'disk' | 'discard', listed: (id: string) => unknown[]]>([
    ['memory', id => [[id, false]]],
    ['disk', id => [[id, true]]],
    ['discard', () => []],
  ])(
    'end_session keep=%s returns the delta (also for a discarded session)',
    async (keep, listed) => {
      const deps = makeDeps()
      const client = await connect(deps)
      const { id } = parse(await call(client, 'start_session', { label: 'L', persist: false }))
      deps.data.render = [rp(1, 2, 8)]
      const ended = parse(await call(client, 'end_session', { keep }))
      expect(ended).toMatchObject({ id, label: 'L', keep })
      expect(ended.delta.components).toEqual([
        expect.objectContaining({ componentId: 1, renderCountDelta: 2, avgRenderTimeDelta: 4 }),
      ])
      const sessions = parse(await call(client, 'list_sessions'))
      expect(sessions.map((s: any) => [s.id, s.persisted])).toEqual(listed(id))
    },
  )

  it('start_session persist:true writes on end', async () => {
    const deps = makeDeps()
    const client = await connect(deps)
    const { id, persist } = parse(
      await call(client, 'start_session', { label: 'p', persist: true }),
    )
    expect(persist).toBe(true)
    await call(client, 'end_session')
    expect(parse(await call(client, 'list_sessions'))).toEqual([
      expect.objectContaining({ id, persisted: true }),
    ])
  })
})

describe('read tools', () => {
  it('get_component_hotspots sorts by total time, rounds, defaults to 20', async () => {
    const render = Array.from({ length: 25 }, (_, i) => rp(i, i, i * 1.111))
    render.push(rp(99, 0, 0))
    const client = await connect(makeDeps({ render }))
    const all = parse(await call(client, 'get_component_hotspots'))
    expect(all).toHaveLength(20)
    expect(all[0]).toEqual({
      file: '/src/C24.svelte',
      name: 'C24',
      componentId: 24,
      renderCount: 24,
      totalRenderTimeMs: 26.66,
      avgRenderTimeMs: 1.11,
      lastRenderTimeMs: 0.5,
      lastRenderAt: 99,
    })
    const totals = all.map((x: any) => x.totalRenderTimeMs)
    expect(totals).toEqual(totals.toSorted((a: number, b: number) => b - a))
  })

  it('get_load_waterfall groups by route, slowest average first, filterable', async () => {
    const client = await connect(
      makeDeps({ load: [lp('/a', 100, 1), lp('/b', 300, 5), lp('/a', 201, 2)] }),
    )
    const groups = parse(await call(client, 'get_load_waterfall'))
    expect(
      groups.map((g: any) => [g.route, g.count, g.avgDuration, g.maxDuration, g.totalDataBytes]),
    ).toEqual([
      ['/b', 1, 300, 300, 5],
      ['/a', 2, 150.5, 201, 3],
    ])
    expect(groups[1].file).toBe('/src/routes/a/+page.ts')
    const only = parse(await call(client, 'get_load_waterfall', { route: '/a' }))
    expect(only.map((g: any) => g.route)).toEqual(['/a'])
    expect(parse(await call(client, 'get_load_waterfall', { route: '/none' }))).toEqual([])
  })

  it('get_fps_drops: strict threshold, sinceMs window, null min without drops', async () => {
    vi.useFakeTimers({ now: 10_000 })
    const fps = [
      { timestamp: 1000, fps: 10 },
      { timestamp: 9000, fps: 39 },
      { timestamp: 9500, fps: 40 },
    ]
    const client = await connect(makeDeps({ fps }))
    expect(parse(await call(client, 'get_fps_drops'))).toMatchObject({
      sampleCount: 3,
      dropCount: 2,
      minFps: 10,
    })
    expect(parse(await call(client, 'get_fps_drops', { sinceMs: 1000 }))).toMatchObject({
      sampleCount: 2, // timestamp >= now - sinceMs
      dropCount: 1,
      minFps: 39,
    })
    expect(parse(await call(client, 'get_fps_drops', { threshold: 5 }))).toMatchObject({
      dropCount: 0,
      minFps: null,
      drops: [],
    })
  })

  it('get_render_profile matches files by substring', async () => {
    const client = await connect(makeDeps({ render: [rp(1, 4, 10), rp(12, 1, 1)] }))
    const r = parse(await call(client, 'get_render_profile', { file: 'C1' }))
    expect(r.map((x: any) => x.componentId)).toEqual([1, 12])
    expect(r[0]).toMatchObject({ initTime: 1, totalRenderTimeMs: 10, avgRenderTimeMs: 2.5 })
    expect(parse(await call(client, 'get_render_profile', { file: 'nope' }))).toEqual([])
  })

  it('list_performance_issues forwards thresholds', async () => {
    const client = await connect(makeDeps({ render: [rp(1, 5, 5)] }))
    expect(parse(await call(client, 'list_performance_issues')).count).toBe(0)
    const r = parse(await call(client, 'list_performance_issues', { renderCount: 5 }))
    expect(r.issues.map((i: any) => i.kind)).toEqual(['over-rendered-component'])
  })

  it('get_reactive_graph_problems applies the default effectMaxDeps when omitted', async () => {
    const nodes: any[] = [
      { id: 'e', type: 'effect', name: 'e', componentId: 1, componentFile: 'f' },
    ]
    const edges = []
    for (let i = 0; i < 8; i++) {
      nodes.push({ id: `s${i}`, type: 'state', name: `s${i}`, componentId: 1, componentFile: 'f' })
      edges.push({ from: `s${i}`, to: 'e' })
    }
    const client = await connect(makeDeps({ graph: { nodes, edges } }))
    // omitted: default 8 (passing `effectMaxDeps: undefined` used to disable the check)
    expect(parse(await call(client, 'get_reactive_graph_problems')).effects).toHaveLength(1)
    expect(
      parse(await call(client, 'get_reactive_graph_problems', { effectMaxDeps: 9 })).effects,
    ).toHaveLength(0)
  })
})

describe('reactivity tools', () => {
  it('get_state_timeline returns at most `limit` newest entries and counts the omitted ones', async () => {
    const changes = Array.from(
      { length: 250 },
      (_, i) => ({ id: `n${i}`, seq: i + 1 }) as unknown as StateTimelineEntry,
    )
    let since: number | undefined
    const client = await connect({
      ...makeDeps(),
      getStateTimelineDelta: s => {
        since = s
        return { cursor: 250, reset: false, changes }
      },
    })
    const result = parse(await call(client, 'get_state_timeline', { since: 7, limit: 50 }))
    expect(since).toBe(7)
    expect(result.changes).toHaveLength(50)
    expect(result.changes[0].id).toBe('n200')
    expect(result).toMatchObject({ cursor: 250, reset: false, omitted: 200 })
    // default limit 100
    expect(parse(await call(client, 'get_state_timeline')).changes).toHaveLength(100)
  })

  it('get_state_timeline caps values: large → size summary, unserializable → marker', async () => {
    const big = 'x'.repeat(5000)
    const entries = [
      { id: 'n1', seq: 2, oldValue: 1, newValue: big },
      { id: 'n2', seq: 3, oldValue: 10n, newValue: undefined },
      { id: 'n3', seq: 4, oldValue: 'x'.repeat(20), newValue: 'ok' },
    ] as unknown as StateTimelineEntry[]
    const client = await connect({
      ...makeDeps(),
      getStateTimelineDelta: () => ({ cursor: 4, reset: true, changes: entries }),
    })
    const result = parse(await call(client, 'get_state_timeline'))
    expect(result.changes[0].oldValue).toBe(1)
    expect(result.changes[0].newValue).toMatchObject({ omitted: 'too large', chars: 5002 })
    expect(result.changes[0].newValue.preview).toHaveLength(200)
    expect(result.changes[1].oldValue).toEqual({ omitted: 'not serializable' })
    expect(result.changes[1]).not.toHaveProperty('newValue')
    expect(result.maxValueChars).toBe(2048)
    const small = parse(await call(client, 'get_state_timeline', { maxValueChars: 16 }))
    expect(small.changes[2].oldValue).toEqual({
      omitted: 'too large',
      chars: 22,
      preview: `"${'x'.repeat(15)}`,
    })
    expect(small.changes[2].newValue).toBe('ok')
    // the collector's entries are not mutated
    expect((entries[0] as any).newValue).toBe(big)
  })

  it('get_reactive_scope forwards the scope and caps unchanged', async () => {
    const calls: unknown[] = []
    const client = await connect({
      ...makeDeps(),
      getReactiveScope: req => {
        calls.push(req)
        return Promise.resolve({ scope: 3, total: null, policy: 'scoped' } as any)
      },
    })
    const result = parse(
      await call(client, 'get_reactive_scope', { componentId: 3, epoch: 'e', maxNodes: 10 }),
    )
    expect(calls).toEqual([{ componentId: 3, epoch: 'e', maxNodes: 10, maxEdges: undefined }])
    expect(result).toMatchObject({ scope: 3, total: null, policy: 'scoped' })
  })

  it('get_reactive_scope refuses a componentId without its epoch', async () => {
    const calls: unknown[] = []
    const client = await connect({
      ...makeDeps(),
      getReactiveScope: req => {
        calls.push(req)
        return Promise.resolve({} as any)
      },
    })
    const result = await call(client, 'get_reactive_scope', { componentId: 3 })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch('componentId requires epoch')
    expect(calls).toEqual([])
  })

  it('get_live_components keeps the bare array by default (older clients)', async () => {
    const comps = Array.from({ length: 3 }, (_, i) => ({ id: i }) as any)
    const client = await connect({
      ...makeDeps(),
      getLiveSnapshot: () => ({ epoch: 'e7', total: 3, components: comps }),
    })
    expect(parse(await call(client, 'get_live_components'))).toEqual(comps)
    expect(parse(await call(client, 'get_live_components', { limit: 2 }))).toEqual(
      comps.slice(0, 2),
    )
  })

  it('get_live_components with includeMeta returns the snapshot epoch, bounded by limit', async () => {
    const comps = Array.from({ length: 5 }, (_, i) => ({ id: i }) as any)
    const client = await connect({
      ...makeDeps(),
      getLiveSnapshot: () => ({ epoch: 'e7', total: 9, components: comps }),
    })
    const result = parse(await call(client, 'get_live_components', { includeMeta: true, limit: 2 }))
    expect(result).toMatchObject({ epoch: 'e7', total: 9, captured: 5, truncated: true })
    expect(result.components.map((c: any) => c.id)).toEqual([0, 1])
    // complete and within the default limit: not truncated
    const client2 = await connect({
      ...makeDeps(),
      getLiveSnapshot: () => ({ epoch: null, total: 5, components: comps }),
    })
    expect(parse(await call(client2, 'get_live_components', { includeMeta: true }))).toMatchObject({
      epoch: null,
      truncated: false,
      captured: 5,
    })
  })
})
