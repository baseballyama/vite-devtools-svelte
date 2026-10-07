import { describe, expect, it, vi } from 'vitest'

import type {
  ReactiveGraph,
  ReactiveGraphResult,
  ReactiveNode,
  ReactiveSummaryRow,
} from './types.js'

// The RPC layer is mocked: fetchGraph / fetchSummary are checked for the request they send.
const rpc = vi.hoisted(() => ({ getReactiveGraph: vi.fn(), getReactiveSummary: vi.fn() }))
vi.mock('./rpc.js', () => rpc)
const {
  baselineNotice,
  fetchGraph,
  fetchSummary,
  fileNeighbourhood,
  isEpochChanged,
  nodeCount,
  BASELINE_UNKNOWN,
  groupByFile,
  isValueSummary,
  nodeValueText,
  normalizeGraph,
  sameGraph,
  sameValue,
} = await import('./reactive.js')

const node = (id: string, componentId: number, value?: unknown): ReactiveNode => ({
  id,
  type: 'state',
  name: id.split(':')[1] ?? id,
  componentId,
  componentFile: `src/C${componentId}.svelte`,
  value,
})

const legacy: ReactiveGraph = {
  nodes: [node('1:a', 1, 1), node('1:b', 1, 2), node('2:c', 2, 3)],
  edges: [
    { from: '1:a', to: '1:b' },
    { from: '1:b', to: '2:c' },
  ],
}

describe('normalizeGraph', () => {
  it('keeps §6.7 A fields from a current server', () => {
    const g: ReactiveGraphResult = {
      ...legacy,
      scope: 1,
      epoch: 'e1',
      total: { nodes: 10, nodesKind: 'registered', edges: null },
      truncated: true,
      edgesOmitted: 4,
      policy: 'scoped',
      computedAt: 1700000000000,
      stale: true,
      staleReason: 'timeout',
    }
    expect(normalizeGraph(g, 1)).toEqual(g)
  })

  it('never invents totals for a reply without them (whole app)', () => {
    const g = normalizeGraph(legacy, null)
    expect(g).toMatchObject({
      scope: null,
      epoch: null,
      total: null,
      truncated: false,
      policy: 'global-head',
      edgesOmitted: 0,
      computedAt: null,
    })
    expect(g.nodes).toHaveLength(3)
  })

  it('narrows a whole-app reply to the requested component and counts omitted edges', () => {
    const g = normalizeGraph(legacy, 1)
    expect(g.policy).toBe('server-filter')
    expect(g.scope).toBe(1)
    expect(g.nodes.map(n => n.id)).toEqual(['1:a', '1:b'])
    expect(g.edges).toEqual([{ from: '1:a', to: '1:b' }])
    expect(g.edgesOmitted).toBe(1)
    expect(g.total).toBeNull()
  })
})

describe('sameGraph / sameValue', () => {
  const base = normalizeGraph(legacy, null)

  it('is true for an equal copy', () => {
    expect(sameGraph(base, structuredClone(base))).toBe(true)
  })

  it('detects a value, edge, scope or disclosure change', () => {
    const v = structuredClone(base)
    v.nodes[0]!.value = 99
    expect(sameGraph(base, v)).toBe(false)
    const e = structuredClone(base)
    e.edges[0] = { from: '1:b', to: '1:a' }
    expect(sameGraph(base, e)).toBe(false)
    expect(sameGraph(base, { ...base, scope: 1 })).toBe(false)
    expect(sameGraph(base, { ...base, stale: true, staleReason: 'timeout' })).toBe(false)
    expect(
      sameGraph(base, { ...base, total: { nodes: 3, nodesKind: 'registered', edges: 2 } }),
    ).toBe(false)
  })

  it('compares primitives exactly and objects by JSON', () => {
    expect(sameValue(NaN, NaN)).toBe(true)
    expect(sameValue(0, -0)).toBe(false)
    expect(sameValue('1', 1)).toBe(false)
    expect(sameValue({ a: [1] }, { a: [1] })).toBe(true)
    expect(sameValue({ a: 1 }, null)).toBe(false)
  })
})

describe('isValueSummary', () => {
  it('recognises runtime summaries only', () => {
    expect(['(object)', '[3]', '{12}'].map(isValueSummary)).toEqual([true, true, true])
    expect(['object', '[a]', 3, null].map(isValueSummary)).toEqual([false, false, false, false])
  })

  it('shows runtime summaries unquoted and real strings quoted', () => {
    expect(['(object)', '[3]', '{12}'].map(v => nodeValueText(v))).toEqual([
      '(object)',
      '[3]',
      '{12}',
    ])
    expect([nodeValueText('object'), nodeValueText(false), nodeValueText(null)]).toEqual([
      '"object"',
      'false',
      'null',
    ])
  })
})

const row = (componentId: number, file: string, changes: number): ReactiveSummaryRow => ({
  componentId,
  file,
  nodes: { state: 1, derived: 2, effect: 3 },
  changes,
  renders: 1,
  renderMs: 0.5,
})

describe('groupByFile', () => {
  it('folds instances per file and sums counters', () => {
    const g = groupByFile([row(1, 'a.svelte', 2), row(2, 'b.svelte', 5), row(3, 'a.svelte', 4)])
    expect(g.map(x => x.file)).toEqual(['a.svelte', 'b.svelte'])
    expect(g[0]).toMatchObject({
      changes: 6,
      renders: 2,
      renderMs: 1,
      nodes: { state: 2, derived: 4, effect: 6 },
    })
    expect(g[0]!.instances.map(r => r.componentId)).toEqual([1, 3])
  })
})

describe('baselineNotice', () => {
  it('discloses pending states, says nothing when complete, and says unknown when unreported', () => {
    expect(baselineNotice({ complete: false, pendingNodes: 3 })).toBe(
      'Sampling baseline: 3 states pending — changes to those are not visible yet',
    )
    expect(baselineNotice({ complete: false, pendingNodes: 1 })).toContain('1 state pending')
    expect(baselineNotice({ complete: true, pendingNodes: 0 })).toBeNull()
    expect(baselineNotice()).toBe(BASELINE_UNKNOWN)
    expect(baselineNotice(null)).toBe(BASELINE_UNKNOWN)
  })
})

describe('normalizeGraph (current server, partial reply)', () => {
  it('fills missing optional fields without inventing data and drops a false stale flag', () => {
    const g = normalizeGraph({ policy: 'scoped' } as unknown as ReactiveGraphResult, 3)
    expect(g).toEqual({
      nodes: [],
      edges: [],
      scope: null,
      epoch: null,
      total: null,
      truncated: false,
      edgesOmitted: 0,
      policy: 'scoped',
      computedAt: null,
    })
    const notStale = normalizeGraph(
      { ...legacy, policy: 'global-head', stale: false } as unknown as ReactiveGraphResult,
      null,
    )
    expect('stale' in notStale).toBe(false)
  })

  it('narrowing to a component with no nodes leaves nothing and counts every edge as omitted', () => {
    const g = normalizeGraph(legacy, 42)
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.edgesOmitted).toBe(2)
  })
})

describe('fetchGraph / fetchSummary', () => {
  it('asks for the whole app within the caps', async () => {
    rpc.getReactiveGraph.mockResolvedValueOnce(legacy)
    const g = await fetchGraph(null)
    expect(rpc.getReactiveGraph).toHaveBeenLastCalledWith({ maxNodes: 5000, maxEdges: 20000 })
    expect(g.policy).toBe('global-head')
  })

  it('sends the component and its page load (epoch) for a scoped request and narrows an old reply', async () => {
    rpc.getReactiveGraph.mockResolvedValueOnce(legacy)
    const g = await fetchGraph({ componentId: 2, epoch: 'e7' })
    expect(rpc.getReactiveGraph).toHaveBeenLastCalledWith({
      componentId: 2,
      epoch: 'e7',
      maxNodes: 5000,
      maxEdges: 20000,
    })
    expect(g.nodes.map(n => n.id)).toEqual(['2:c'])
    expect(g.policy).toBe('server-filter')
  })

  it('propagates RPC failures', async () => {
    rpc.getReactiveGraph.mockRejectedValueOnce(new Error('down'))
    await expect(fetchGraph(null)).rejects.toThrow('down')
  })

  it('fetchSummary forwards the request and the reply', async () => {
    const reply = { rows: [] }
    rpc.getReactiveSummary.mockResolvedValueOnce(reply)
    await expect(fetchSummary({ topK: 5 })).resolves.toBe(reply)
    expect(rpc.getReactiveSummary).toHaveBeenLastCalledWith({ topK: 5 })
  })
})

describe('sameGraph field by field', () => {
  const base = normalizeGraph(legacy, null)
  const total = { nodes: 3, nodesKind: 'registered' as const, edges: 2 }
  it.each<[string, Partial<ReactiveGraphResult>]>([
    ['epoch', { epoch: 'x' }],
    ['truncated', { truncated: true }],
    ['policy', { policy: 'scoped' }],
    ['edgesOmitted', { edgesOmitted: 1 }],
    ['staleReason', { staleReason: 'timeout' }],
    ['total.nodes', { total }],
  ])('differs on %s', (_, patch) => {
    expect(sameGraph(base, { ...base, ...patch })).toBe(false)
  })

  it('compares totals by content, and ignores computedAt (a cache timestamp)', () => {
    const a = { ...base, total: { ...total } }
    expect(sameGraph(a, { ...base, total: { ...total } })).toBe(true)
    expect(sameGraph(a, { ...base, total: { ...total, nodesKind: 'sent' } })).toBe(false)
    expect(sameGraph(a, { ...base, total: { ...total, edges: null } })).toBe(false)
    expect(sameGraph(base, { ...base, computedAt: 123 })).toBe(true)
  })

  it.each<[string, (n: ReactiveNode) => ReactiveNode]>([
    ['id', n => ({ ...n, id: 'z' })],
    ['type', n => ({ ...n, type: 'derived' })],
    ['name', n => ({ ...n, name: 'z' })],
    ['componentId', n => ({ ...n, componentId: 9 })],
    ['componentFile', n => ({ ...n, componentFile: 'z' })],
  ])('differs on node %s', (_, change) => {
    expect(
      sameGraph(base, { ...base, nodes: [change(base.nodes[0]!), ...base.nodes.slice(1)] }),
    ).toBe(false)
  })

  it('differs on node or edge count', () => {
    expect(sameGraph(base, { ...base, nodes: base.nodes.slice(1) })).toBe(false)
    expect(sameGraph(base, { ...base, edges: base.edges.slice(1) })).toBe(false)
    expect(sameGraph(base, { ...base, edges: [base.edges[0]!, { from: '1:b', to: '1:a' }] })).toBe(
      false,
    )
  })
})

describe('sameValue', () => {
  it('falls back to false for unserialisable objects', () => {
    const a: Record<string, unknown> = {}
    a['self'] = a
    expect(sameValue(a, { self: {} })).toBe(false)
    expect(sameValue(a, a)).toBe(true)
    expect(sameValue(1, { a: 1 })).toBe(false)
  })
})

describe('small helpers', () => {
  it('isEpochChanged only for that stale reason', () => {
    expect(isEpochChanged({ staleReason: 'epoch-changed' })).toBe(true)
    expect(isEpochChanged({ staleReason: 'timeout' })).toBe(false)
    expect(isEpochChanged({})).toBe(false)
  })

  it('nodeCount sums the three node kinds', () => {
    expect(nodeCount({ state: 1, derived: 2, effect: 4 })).toBe(7)
  })

  it('nodeValueText truncates real values but never runtime summaries', () => {
    expect(nodeValueText('x'.repeat(20), 5)).toBe('"xxx…')
    expect(nodeValueText('[123456]', 3)).toBe('[123456]')
  })

  it('baselineNotice formats large counts with grouping', () => {
    expect(baselineNotice({ complete: false, pendingNodes: 1234 })).toContain(
      (1234).toLocaleString(),
    )
  })

  it('groupByFile of nothing is nothing', () => {
    expect(groupByFile([])).toEqual([])
  })
})

describe('fileNeighbourhood', () => {
  const ns = [node('1:a', 1), node('1:b', 1), node('2:c', 2), node('3:d', 3), node('4:e', 4)]

  it('is the file nodes plus both ends of edges that touch them', () => {
    const edges = [
      { from: '1:a', to: '2:c' },
      { from: '3:d', to: '1:b' },
      { from: '4:e', to: '3:d' }, // touches d, which joined via the previous edge
    ]
    expect([...fileNeighbourhood(ns, edges, 'src/C1.svelte')].toSorted()).toEqual([
      '1:a',
      '1:b',
      '2:c',
      '3:d',
      '4:e',
    ])
  })

  it('a single pass: an edge seen before its endpoint joins is not followed', () => {
    const edges = [
      { from: '4:e', to: '3:d' },
      { from: '3:d', to: '1:b' },
    ]
    expect([...fileNeighbourhood(ns, edges, 'src/C1.svelte')].toSorted()).toEqual([
      '1:a',
      '1:b',
      '3:d',
    ])
  })

  it('is empty for an unknown file without edges to it', () => {
    expect(fileNeighbourhood(ns, [{ from: '1:a', to: '2:c' }], 'nope').size).toBe(0)
  })
})
