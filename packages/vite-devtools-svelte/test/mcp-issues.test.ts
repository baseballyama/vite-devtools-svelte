/**
 * Issue classification (pure): every IssueKind at its threshold boundary,
 * severity bands, overridden thresholds, ordering, and the reactive problem
 * summary.
 */
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { listPerformanceIssues, summarizeReactiveProblems } from '../src/mcp/issues.js'
import type { IssueThresholds, PerformanceIssue } from '../src/mcp/issues.js'
import type {
  FpsSample,
  LoadProfile,
  ReactiveEdge,
  ReactiveGraph,
  ReactiveNode,
  RenderProfile,
} from '../src/types.js'

const EMPTY = {
  renderProfiles: [] as RenderProfile[],
  reactiveGraph: { nodes: [], edges: [] } as ReactiveGraph,
  loadProfiles: [] as LoadProfile[],
  fpsSamples: [] as FpsSample[],
}

const profile = (renderCount: number, totalRenderTime: number, id = 1): RenderProfile => ({
  componentId: id,
  file: `/src/C${id}.svelte`,
  name: `C${id}`,
  initTime: 0,
  renderCount,
  totalRenderTime,
  lastRenderTime: 0,
  lastRenderAt: 0,
})
const load = (duration: number, route = '/r'): LoadProfile => ({
  route,
  file: `/src/routes${route}/+page.ts`,
  type: 'universal',
  duration,
  dataSize: 10,
  timestamp: 5,
})
const fps = (...values: number[]): FpsSample[] =>
  values.map((v, i) => ({ timestamp: 100 + i, fps: v }))
const node = (
  id: string,
  type: ReactiveNode['type'],
  extra: Partial<ReactiveNode> = {},
): ReactiveNode => ({
  id,
  type,
  name: id,
  componentId: 1,
  componentFile: '/src/C.svelte',
  ...extra,
})
/** An effect `e` with `deps` distinct state dependencies. */
function effectWithDeps(deps: number): ReactiveGraph {
  const nodes = [node('e', 'effect')]
  const edges: ReactiveEdge[] = []
  for (let i = 0; i < deps; i++) {
    nodes.push(node(`s${i}`, 'state'))
    edges.push({ from: `s${i}`, to: 'e' })
  }
  return { nodes, edges }
}

const kinds = (issues: PerformanceIssue[]) => issues.map(i => [i.kind, i.severity])
const slow = (severity: string) => [['slow-component-render', severity]]
const over = (severity: string) => [['over-rendered-component', severity]]
const slowLoad = (severity: string) => [['slow-load', severity]]
const busy = (severity: string) => [['effect-overconnected', severity]]
const drop = (severity: string, dropCount: number, minFps: number): PerformanceIssue[] => [
  {
    id: 'fps-drops:100',
    kind: 'fps-drop',
    severity: severity as PerformanceIssue['severity'],
    summary: `${dropCount} FPS samples below 40 (min ${minFps})`,
    metric: { dropCount, minFps, threshold: 40 },
    suggestedTool: 'get_fps_drops',
  },
]

describe('slow-component-render (avg render time ≥ threshold, default 4 ms)', () => {
  it.each<[avg: number, expected: string[][]]>([
    [3.99, []],
    [4, slow('low')],
    [7.99, slow('low')],
    [8, slow('medium')],
    [15.99, slow('medium')],
    [16, slow('high')],
    [100, slow('high')],
  ])('avg %f ms → %j', (avg, expected) => {
    const issues = listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(1, avg)] })
    expect(kinds(issues)).toEqual(expected)
  })

  it('reports file, metrics and the follow-up tool', () => {
    const [issue] = listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(3, 15.005)] })
    expect(issue).toEqual({
      id: 'slow-render:/src/C1.svelte:1',
      kind: 'slow-component-render',
      severity: 'low',
      summary: 'C1 averages 5.00ms per render (3 renders)',
      file: '/src/C1.svelte',
      metric: { avgRenderTimeMs: 5, renderCount: 3, totalRenderTimeMs: 15.01 },
      suggestedTool: 'get_render_profile',
    })
  })

  it('a never-rendered component averages 0 (no division by zero)', () => {
    expect(listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(0, 50)] })).toEqual([])
  })
})

describe('over-rendered-component (render count ≥ threshold, default 30)', () => {
  it.each<[count: number, expected: string[][]]>([
    [29, []],
    [30, over('low')],
    [89, over('low')],
    [90, over('medium')],
    [239, over('medium')],
    [240, over('high')],
  ])('%i renders → %j', (count, expected) => {
    const issues = listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(count, 0)] })
    expect(kinds(issues)).toEqual(expected)
  })

  it('describes the over-rendered component', () => {
    const [issue] = listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(31, 0)] })
    expect(issue).toEqual({
      id: 'over-render:/src/C1.svelte:1',
      kind: 'over-rendered-component',
      severity: 'low',
      summary: 'C1 rendered 31 times',
      file: '/src/C1.svelte',
      metric: { renderCount: 31, avgRenderTimeMs: 0 },
      suggestedTool: 'get_component_hotspots',
    })
  })

  it('one component can be both slow and over-rendered', () => {
    const issues = listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(30, 120)] })
    expect(issues.map(i => i.kind).toSorted()).toEqual([
      'over-rendered-component',
      'slow-component-render',
    ])
  })
})

describe('slow-load (duration ≥ threshold, default 200 ms)', () => {
  it.each<[duration: number, expected: string[][]]>([
    [199.9, []],
    [200, slowLoad('low')],
    [399, slowLoad('low')],
    [400, slowLoad('medium')],
    [999, slowLoad('medium')],
    [1000, slowLoad('high')],
  ])('%f ms → %j', (duration, expected) => {
    const issues = listPerformanceIssues({ ...EMPTY, loadProfiles: [load(duration)] })
    expect(kinds(issues)).toEqual(expected)
  })

  it('describes the load', () => {
    const [issue] = listPerformanceIssues({ ...EMPTY, loadProfiles: [load(250.456)] })
    expect(issue).toEqual({
      id: 'slow-load:/r:5',
      kind: 'slow-load',
      severity: 'low',
      summary: 'universal load for /r took 250ms',
      file: '/src/routes/r/+page.ts',
      metric: { durationMs: 250.46, dataSizeBytes: 10 },
      suggestedTool: 'get_load_waterfall',
    })
  })
})

describe('fps-drop (samples strictly below threshold, default 40)', () => {
  it.each<[samples: number[], expected: PerformanceIssue[]]>([
    [[40, 60], []],
    [[39.9], drop('low', 1, 39.9)],
    [[30, 35], drop('low', 2, 30)],
    [[29.9, 60], drop('medium', 1, 29.9)],
    [[15], drop('medium', 1, 15)],
    [[14.9, 39, 50], drop('high', 2, 14.9)],
    [[0], drop('high', 1, 0)],
  ])('%j → %j', (values, expected) => {
    expect(listPerformanceIssues({ ...EMPTY, fpsSamples: fps(...values) })).toEqual(expected)
  })

  it('handles more samples than fit in a call stack', () => {
    const many = Array.from({ length: 300_000 }, (_, i) => ({ timestamp: i, fps: 10 + (i % 7) }))
    const [issue] = listPerformanceIssues({ ...EMPTY, fpsSamples: many })
    expect(issue!.metric).toMatchObject({ dropCount: 300_000, minFps: 10 })
  })
})

describe('effect-overconnected (dependencies ≥ threshold, default 8)', () => {
  it.each<[deps: number, expected: string[][]]>([
    [7, []],
    [8, busy('low')],
    [15, busy('low')],
    [16, busy('medium')],
    [23, busy('medium')],
    [24, busy('high')],
  ])('%i deps → %j', (deps, expected) => {
    const issues = listPerformanceIssues({ ...EMPTY, reactiveGraph: effectWithDeps(deps) })
    expect(kinds(issues)).toEqual(expected)
  })

  it('describes the over-connected effect', () => {
    const [issue] = listPerformanceIssues({ ...EMPTY, reactiveGraph: effectWithDeps(9) })
    expect(issue).toEqual({
      id: 'effect-deps:e',
      kind: 'effect-overconnected',
      severity: 'low',
      summary: 'effect "e" depends on 9 reactive values',
      file: '/src/C.svelte',
      metric: { depCount: 9 },
      suggestedTool: 'get_reactive_graph_problems',
    })
  })

  it('counts incoming edges only, of effects only, and a repeated edge once', () => {
    const graph = effectWithDeps(7)
    graph.edges.push({ from: 's0', to: 'e' }) // duplicate
    graph.nodes.push(node('d', 'derived'))
    for (let i = 0; i < 10; i++) graph.edges.push({ from: `s${i % 7}`, to: 'd' }) // derived: never an issue
    for (let i = 0; i < 10; i++) graph.edges.push({ from: 'e', to: `x${i}` }) // outgoing: not deps
    expect(listPerformanceIssues({ ...EMPTY, reactiveGraph: graph })).toEqual([])
  })
})

describe('overridden thresholds', () => {
  const inputs = {
    renderProfiles: [profile(10, 10)], // avg 1 ms, 10 renders
    reactiveGraph: effectWithDeps(3),
    loadProfiles: [load(50)],
    fpsSamples: fps(55),
  }

  it('defaults report nothing for these inputs', () => {
    expect(listPerformanceIssues(inputs)).toEqual([])
  })

  it.each<[thresholds: IssueThresholds, kind: string]>([
    [{ avgRenderTimeMs: 1 }, 'slow-component-render'],
    [{ renderCount: 10 }, 'over-rendered-component'],
    [{ loadDurationMs: 50 }, 'slow-load'],
    [{ fpsDropThreshold: 55.1 }, 'fps-drop'],
    [{ effectMaxDeps: 3 }, 'effect-overconnected'],
  ])('%j reports %s', (thresholds, kind) => {
    expect(listPerformanceIssues(inputs, thresholds).map(i => i.kind)).toEqual([kind])
  })

  it('an undefined threshold keeps its default instead of disabling the check', () => {
    const issues = listPerformanceIssues(
      { ...EMPTY, renderProfiles: [profile(30, 0)], reactiveGraph: effectWithDeps(8) },
      {
        avgRenderTimeMs: undefined,
        renderCount: undefined,
        loadDurationMs: undefined,
        fpsDropThreshold: undefined,
        effectMaxDeps: undefined,
      },
    )
    expect(issues.map(i => i.kind).toSorted()).toEqual([
      'effect-overconnected',
      'over-rendered-component',
    ])
  })

  it('raising a threshold above the value hides the issue', () => {
    expect(
      listPerformanceIssues({ ...EMPTY, renderProfiles: [profile(30, 0)] }, { renderCount: 31 }),
    ).toEqual([])
  })
})

describe('ordering', () => {
  it('sorts by severity, high first, stable within a severity', () => {
    const issues = listPerformanceIssues({
      ...EMPTY,
      renderProfiles: [profile(1, 5, 1), profile(1, 20, 2), profile(1, 9, 3), profile(1, 4, 4)],
      loadProfiles: [load(1000)],
    })
    expect(issues.map(i => [i.id, i.severity])).toEqual([
      ['slow-render:/src/C2.svelte:2', 'high'],
      ['slow-load:/r:5', 'high'],
      ['slow-render:/src/C3.svelte:3', 'medium'],
      ['slow-render:/src/C1.svelte:1', 'low'],
      ['slow-render:/src/C4.svelte:4', 'low'],
    ])
  })

  it('severity rank never increases along the list (property)', () => {
    const rank = { high: 0, medium: 1, low: 2 }
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(500), fc.float({ min: 0, max: 200, noNaN: true })), {
          maxLength: 8,
        }),
        fc.array(fc.float({ min: 0, max: 3000, noNaN: true }), { maxLength: 5 }),
        fc.array(fc.float({ min: 0, max: 120, noNaN: true }), { maxLength: 5 }),
        (renders, loads, fpsValues) => {
          const issues = listPerformanceIssues({
            ...EMPTY,
            renderProfiles: renders.map(([c, t], i) => profile(c, t, i)),
            loadProfiles: loads.map((d, i) => load(d, `/r${i}`)),
            fpsSamples: fps(...fpsValues),
          })
          for (let i = 1; i < issues.length; i++) {
            expect(rank[issues[i]!.severity]).toBeGreaterThanOrEqual(rank[issues[i - 1]!.severity])
          }
        },
      ),
    )
  })
})

describe('summarizeReactiveProblems', () => {
  it('classifies over-connected effects, orphan deriveds and isolated nodes', () => {
    const graph = effectWithDeps(8)
    graph.nodes.push(
      node('lonely', 'state'),
      node('unread', 'derived', { unevaluated: true }),
      node('read', 'derived'), // evaluated (read imperatively): isolated, not an orphan
      node('untracked', 'derived', { untrackedDeps: 2 }), // depends on untracked signals only
      node('zero', 'derived', { untrackedDeps: 0 }),
      node('1:(template)', 'template'),
      node('shown', 'state'),
      node('idle', 'effect'),
    )
    graph.edges.push({ from: 'shown', to: '1:(template)' })
    const result = summarizeReactiveProblems(graph)
    expect(result).toEqual({
      effects: [{ id: 'e', name: 'e', file: '/src/C.svelte', depCount: 8 }],
      orphanDeriveds: [{ id: 'unread', name: 'unread', file: '/src/C.svelte' }],
      isolatedNodes: [
        { id: 'lonely', name: 'lonely', type: 'state', file: '/src/C.svelte' },
        { id: 'read', name: 'read', type: 'derived', file: '/src/C.svelte' },
        { id: 'zero', name: 'zero', type: 'derived', file: '/src/C.svelte' },
        { id: 'idle', name: 'idle', type: 'effect', file: '/src/C.svelte' },
      ],
    })
  })

  it.each<[deps: number, threshold: number | undefined, listed: number]>([
    [7, undefined, 0],
    [8, undefined, 1],
    [2, 3, 0],
    [3, 3, 1],
    [8, 9, 0],
  ])('effect with %i deps, effectMaxDeps %s → %i listed', (deps, effectMaxDeps, listed) => {
    const { effects } = summarizeReactiveProblems(effectWithDeps(deps), { effectMaxDeps })
    expect(effects).toHaveLength(listed)
  })

  it('an unevaluated derived with readers is still an orphan (never evaluated so far)', () => {
    const graph: ReactiveGraph = {
      nodes: [node('d', 'derived', { unevaluated: true }), node('s', 'state')],
      edges: [{ from: 's', to: 'd' }],
    }
    expect(summarizeReactiveProblems(graph)).toMatchObject({
      orphanDeriveds: [{ id: 'd' }],
      isolatedNodes: [],
    })
  })

  it('an empty graph has no problems', () => {
    expect(summarizeReactiveProblems({ nodes: [], edges: [] })).toEqual({
      effects: [],
      orphanDeriveds: [],
      isolatedNodes: [],
    })
  })
})
