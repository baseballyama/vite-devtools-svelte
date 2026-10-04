/**
 * MCP tool surface (review: MCP had no tests). In-memory transport, no HTTP:
 * the tool list, and that the reactivity tools stay bounded and say what
 * they cover (docs/devframe-migration.md §6.7).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildMcpServer, MCP_TIMELINE_LIMIT } from '../mcp/server.js'
import type { McpDeps } from '../mcp/server.js'
import { SessionStore } from '../mcp/sessions.js'
import type { StateTimelineEntry } from '../types.js'

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
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function baseDeps(): McpDeps {
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-mcp-'))
  dirs.push(persistDir)
  const getters = {
    getRenderProfiles: () => [],
    getLoadProfiles: () => [],
    getFpsSamples: () => [],
  }
  return {
    getProject: () => ({}) as any,
    getRoutes: () => [],
    getLiveComponents: () => [],
    getComponentRelations: () => [],
    getRenderProfiles: () => [],
    getReactiveGraph: async () => ({ nodes: [], edges: [] }),
    getLoadProfiles: () => [],
    getFpsSamples: () => [],
    sessions: new SessionStore({ persistDir, getters: getters as any }),
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

const parse = (result: any) => JSON.parse(result.content[0].text)

describe('MCP server tools', () => {
  it('lists the 16 existing tools when no reactivity deps are given', async () => {
    const client = await connect(baseDeps())
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name).sort()).toEqual([...BASE_TOOLS].sort())
  })

  it('adds the 4 bounded reactivity tools when their deps are given', async () => {
    const client = await connect({
      ...baseDeps(),
      getReactiveSummary: async () => ({}) as any,
      getReactiveScope: async () => ({}) as any,
      getStateTimelineDelta: () => ({ cursor: 1, reset: true, changes: [] }),
      getCaptureInfo: () => ({}),
    })
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name).sort()).toEqual([...BASE_TOOLS, ...REACTIVITY_TOOLS].sort())
  })

  it('get_state_timeline returns at most `limit` newest entries and counts the omitted ones', async () => {
    const changes = Array.from(
      { length: 250 },
      (_, i) => ({ id: `n${i}`, seq: i + 1 }) as unknown as StateTimelineEntry,
    )
    let since: number | undefined
    const client = await connect({
      ...baseDeps(),
      getStateTimelineDelta: s => {
        since = s
        return { cursor: 250, reset: false, changes }
      },
    })
    const result = parse(
      await client.callTool({ name: 'get_state_timeline', arguments: { since: 7, limit: 50 } }),
    )
    expect(since).toBe(7)
    expect(result.changes).toHaveLength(50)
    expect(result.changes[0].id).toBe('n200')
    expect(result).toMatchObject({ cursor: 250, reset: false, omitted: 200 })
  })

  it('get_state_timeline rejects a limit above the cap', async () => {
    const client = await connect({
      ...baseDeps(),
      getStateTimelineDelta: () => ({ cursor: 1, reset: true, changes: [] }),
    })
    const result: any = await client.callTool({
      name: 'get_state_timeline',
      arguments: { limit: MCP_TIMELINE_LIMIT + 1 },
    })
    expect(result.isError).toBe(true)
  })

  it('get_reactive_scope forwards the scope and caps unchanged', async () => {
    const calls: unknown[] = []
    const client = await connect({
      ...baseDeps(),
      getReactiveScope: async req => {
        calls.push(req)
        return {
          nodes: [],
          edges: [],
          scope: 3,
          epoch: 'e',
          total: null,
          truncated: false,
          edgesOmitted: 0,
          computedAt: null,
          policy: 'scoped',
        }
      },
    })
    const result = parse(
      await client.callTool({
        name: 'get_reactive_scope',
        arguments: { componentId: 3, epoch: 'e', maxNodes: 10 },
      }),
    )
    expect(calls).toEqual([{ componentId: 3, epoch: 'e', maxNodes: 10, maxEdges: undefined }])
    expect(result).toMatchObject({ scope: 3, total: null, policy: 'scoped' })
  })

  it('get_reactive_scope refuses a componentId without its epoch', async () => {
    const calls: unknown[] = []
    const client = await connect({
      ...baseDeps(),
      getReactiveScope: async req => {
        calls.push(req)
        return {} as any
      },
    })
    const result: any = await client.callTool({
      name: 'get_reactive_scope',
      arguments: { componentId: 3 },
    })
    expect(result.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it('get_state_timeline replaces values above maxValueChars with a size summary', async () => {
    const big = 'x'.repeat(5000)
    const client = await connect({
      ...baseDeps(),
      getStateTimelineDelta: () => ({
        cursor: 2,
        reset: true,
        changes: [
          { id: 'n1', seq: 2, oldValue: 1, newValue: big } as unknown as StateTimelineEntry,
        ],
      }),
    })
    const result = parse(await client.callTool({ name: 'get_state_timeline', arguments: {} }))
    expect(result.changes[0].oldValue).toBe(1)
    expect(result.changes[0].newValue).toMatchObject({ omitted: 'too large', chars: 5002 })
    expect(result.changes[0].newValue.preview.length).toBeLessThanOrEqual(200)
    expect(result.maxValueChars).toBe(2048)
  })

  it('get_live_components keeps the bare array by default (older clients)', async () => {
    const comps = Array.from({ length: 3 }, (_, i) => ({ id: i, file: `/C${i}.svelte` }) as any)
    const client = await connect({
      ...baseDeps(),
      getLiveComponents: () => comps,
      getLiveSnapshot: () => ({ epoch: 'e7', total: 3, components: comps }),
    })
    const result = parse(await client.callTool({ name: 'get_live_components', arguments: {} }))
    expect(result).toEqual(comps)
  })

  it('get_live_components with includeMeta returns the snapshot epoch, bounded by limit', async () => {
    const comps = Array.from({ length: 5 }, (_, i) => ({ id: i, file: `/C${i}.svelte` }) as any)
    const client = await connect({
      ...baseDeps(),
      getLiveComponents: () => [],
      getLiveSnapshot: () => ({ epoch: 'e7', total: 9, components: comps }),
    })
    const result = parse(
      await client.callTool({
        name: 'get_live_components',
        arguments: { includeMeta: true, limit: 2 },
      }),
    )
    expect(result).toMatchObject({ epoch: 'e7', total: 9, captured: 5, truncated: true })
    expect(result.components.map((c: any) => c.id)).toEqual([0, 1])
  })
})
