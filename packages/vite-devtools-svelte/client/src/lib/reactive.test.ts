import { describe, expect, it, vi } from 'vitest'
import type {
  ReactiveGraph,
  ReactiveGraphResult,
  ReactiveNode,
  ReactiveSummaryRow,
} from './types.js'

// Pure helpers only; the RPC layer is not exercised here.
vi.mock('./rpc.js', () => ({ getReactiveGraph: vi.fn(), getReactiveSummary: vi.fn() }))
const {
  EMPTY_GRAPH,
  baselineNotice,
  BASELINE_UNKNOWN,
  groupByFile,
  isValueSummary,
  normalizeGraph,
  sameGraph,
  sameValue,
} = await import('./reactive.js')
const { haystack, haystackMatcher, matcher } = await import('./match.js')

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
    v.nodes[0].value = 99
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

  it('EMPTY_GRAPH is the whole-app shape with nothing known', () => {
    expect(EMPTY_GRAPH).toMatchObject({ scope: null, total: null, truncated: false })
  })
})

describe('isValueSummary', () => {
  it('recognises runtime summaries only', () => {
    expect(['(object)', '[3]', '{12}'].map(isValueSummary)).toEqual([true, true, true])
    expect(['object', '[a]', 3, null].map(isValueSummary)).toEqual([false, false, false, false])
  })
})

describe('groupByFile', () => {
  const row = (componentId: number, file: string, changes: number): ReactiveSummaryRow => ({
    componentId,
    file,
    nodes: { state: 1, derived: 2, effect: 3 },
    changes,
    renders: 1,
    renderMs: 0.5,
  })

  it('folds instances per file and sums counters', () => {
    const g = groupByFile([row(1, 'a.svelte', 2), row(2, 'b.svelte', 5), row(3, 'a.svelte', 4)])
    expect(g.map(x => x.file)).toEqual(['a.svelte', 'b.svelte'])
    expect(g[0]).toMatchObject({
      changes: 6,
      renders: 2,
      renderMs: 1,
      nodes: { state: 2, derived: 4, effect: 6 },
    })
    expect(g[0].instances.map(r => r.componentId)).toEqual([1, 3])
  })
})

describe('haystackMatcher', () => {
  it('matches exactly like matcher()', () => {
    const fields = ['count', undefined, 'src/lib/Counter.svelte', '42'] as const
    for (const q of ['', 'COUNT', 'counter 42', 'lib\ncount', 'missing', '  ']) {
      const a = matcher(q)
      const b = haystackMatcher(q)
      expect(b === null).toBe(a === null)
      expect(b ? b(haystack(...fields)) : null).toBe(a ? a(...fields) : null)
    }
  })
})

describe('baselineNotice', () => {
  it('discloses pending states, says nothing when complete, and says unknown when unreported', () => {
    expect(baselineNotice({ complete: false, pendingNodes: 3 })).toBe(
      'Sampling baseline: 3 states pending — changes to those are not visible yet',
    )
    expect(baselineNotice({ complete: false, pendingNodes: 1 })).toContain('1 state pending')
    expect(baselineNotice({ complete: true, pendingNodes: 0 })).toBeNull()
    expect(baselineNotice(undefined)).toBe(BASELINE_UNKNOWN)
    expect(baselineNotice(null)).toBe(BASELINE_UNKNOWN)
  })
})
