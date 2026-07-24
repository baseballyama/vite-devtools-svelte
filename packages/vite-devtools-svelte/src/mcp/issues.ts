import type { RenderProfile, ReactiveGraph, LoadProfile, FpsSample } from '../types.js'

export type IssueKind =
  | 'slow-component-render'
  | 'over-rendered-component'
  | 'slow-load'
  | 'fps-drop'
  | 'effect-overconnected'
  | 'derived-orphan'

export interface PerformanceIssue {
  id: string
  kind: IssueKind
  severity: 'low' | 'medium' | 'high'
  summary: string
  file?: string
  line?: number
  metric: Record<string, number>
  /** Tool that returns more detail for this issue. */
  suggestedTool: string
}

export interface IssueThresholds {
  /** Per-render time (ms) above which a component render is considered slow. */
  avgRenderTimeMs?: number
  /** Render count above which a component is considered over-rendered. */
  renderCount?: number
  /** Load duration (ms) above which a SvelteKit load is slow. */
  loadDurationMs?: number
  /** FPS below which we record a drop. */
  fpsDropThreshold?: number
  /** Outgoing edge count from an effect above which it is over-connected. */
  effectMaxDeps?: number
}

const DEFAULTS: Required<IssueThresholds> = {
  avgRenderTimeMs: 4,
  renderCount: 30,
  loadDurationMs: 200,
  fpsDropThreshold: 40,
  effectMaxDeps: 8,
}

export interface IssueInputs {
  renderProfiles: RenderProfile[]
  reactiveGraph: ReactiveGraph
  loadProfiles: LoadProfile[]
  fpsSamples: FpsSample[]
}

export function listPerformanceIssues(
  inputs: IssueInputs,
  thresholds: IssueThresholds = {},
): PerformanceIssue[] {
  const t = { ...DEFAULTS, ...thresholds }
  const out: PerformanceIssue[] = []

  for (const p of inputs.renderProfiles) {
    const avg = p.renderCount > 0 ? p.totalRenderTime / p.renderCount : 0
    if (avg >= t.avgRenderTimeMs) {
      out.push({
        id: `slow-render:${p.file}:${p.componentId}`,
        kind: 'slow-component-render',
        severity:
          avg >= t.avgRenderTimeMs * 4 ? 'high' : avg >= t.avgRenderTimeMs * 2 ? 'medium' : 'low',
        summary: `${p.name} averages ${avg.toFixed(2)}ms per render (${p.renderCount} renders)`,
        file: p.file,
        metric: {
          avgRenderTimeMs: round(avg),
          renderCount: p.renderCount,
          totalRenderTimeMs: round(p.totalRenderTime),
        },
        suggestedTool: 'get_render_profile',
      })
    }
    if (p.renderCount >= t.renderCount) {
      out.push({
        id: `over-render:${p.file}:${p.componentId}`,
        kind: 'over-rendered-component',
        severity:
          p.renderCount >= t.renderCount * 8
            ? 'high'
            : p.renderCount >= t.renderCount * 3
              ? 'medium'
              : 'low',
        summary: `${p.name} rendered ${p.renderCount} times`,
        file: p.file,
        metric: { renderCount: p.renderCount, avgRenderTimeMs: round(avg) },
        suggestedTool: 'get_component_hotspots',
      })
    }
  }

  for (const l of inputs.loadProfiles) {
    if (l.duration >= t.loadDurationMs) {
      out.push({
        id: `slow-load:${l.route}:${l.timestamp}`,
        kind: 'slow-load',
        severity:
          l.duration >= t.loadDurationMs * 5
            ? 'high'
            : l.duration >= t.loadDurationMs * 2
              ? 'medium'
              : 'low',
        summary: `${l.type} load for ${l.route} took ${l.duration.toFixed(0)}ms`,
        file: l.file,
        metric: { durationMs: round(l.duration), dataSizeBytes: l.dataSize },
        suggestedTool: 'get_load_waterfall',
      })
    }
  }

  const fpsDrops = inputs.fpsSamples.filter(s => s.fps < t.fpsDropThreshold)
  if (fpsDrops.length > 0) {
    const min = Math.min(...fpsDrops.map(s => s.fps))
    out.push({
      id: `fps-drops:${inputs.fpsSamples[0]?.timestamp ?? 0}`,
      kind: 'fps-drop',
      severity: min < 15 ? 'high' : min < 30 ? 'medium' : 'low',
      summary: `${fpsDrops.length} FPS samples below ${t.fpsDropThreshold} (min ${min})`,
      metric: { dropCount: fpsDrops.length, minFps: min, threshold: t.fpsDropThreshold },
      suggestedTool: 'get_fps_drops',
    })
  }

  // Reactive graph: count outgoing edges per node
  const outDegree = new Map<string, number>()
  for (const e of inputs.reactiveGraph.edges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1)
  }
  const inDegree = new Map<string, number>()
  for (const e of inputs.reactiveGraph.edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }
  for (const node of inputs.reactiveGraph.nodes) {
    if (node.type === 'effect') {
      const deps = inDegree.get(node.id) ?? 0
      if (deps >= t.effectMaxDeps) {
        out.push({
          id: `effect-deps:${node.id}`,
          kind: 'effect-overconnected',
          severity:
            deps >= t.effectMaxDeps * 3 ? 'high' : deps >= t.effectMaxDeps * 2 ? 'medium' : 'low',
          summary: `effect "${node.name}" depends on ${deps} reactive values`,
          file: node.componentFile,
          metric: { depCount: deps },
          suggestedTool: 'get_reactive_graph_problems',
        })
      }
    }
    if (node.type === 'derived') {
      const fanout = outDegree.get(node.id) ?? 0
      if (fanout === 0 && (inDegree.get(node.id) ?? 0) > 0) {
        out.push({
          id: `derived-orphan:${node.id}`,
          kind: 'derived-orphan',
          severity: 'low',
          summary: `derived "${node.name}" has dependencies but is unused`,
          file: node.componentFile,
          metric: { fanout },
          suggestedTool: 'get_reactive_graph_problems',
        })
      }
    }
  }

  return out.sort(compareSeverity)
}

const SEV_RANK: Record<PerformanceIssue['severity'], number> = { high: 0, medium: 1, low: 2 }

function compareSeverity(a: PerformanceIssue, b: PerformanceIssue): number {
  return SEV_RANK[a.severity] - SEV_RANK[b.severity]
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export interface ReactiveProblems {
  effects: Array<{ id: string; name: string; file: string; depCount: number }>
  orphanDeriveds: Array<{ id: string; name: string; file: string }>
  isolatedNodes: Array<{ id: string; name: string; type: string; file: string }>
}

export function summarizeReactiveProblems(
  graph: ReactiveGraph,
  t: IssueThresholds = {},
): ReactiveProblems {
  const thresh = { ...DEFAULTS, ...t }
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const e of graph.edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1)
  }
  const effects: ReactiveProblems['effects'] = []
  const orphanDeriveds: ReactiveProblems['orphanDeriveds'] = []
  const isolatedNodes: ReactiveProblems['isolatedNodes'] = []
  for (const node of graph.nodes) {
    const ind = inDegree.get(node.id) ?? 0
    const outd = outDegree.get(node.id) ?? 0
    if (node.type === 'effect' && ind >= thresh.effectMaxDeps) {
      effects.push({ id: node.id, name: node.name, file: node.componentFile, depCount: ind })
    }
    if (node.type === 'derived' && outd === 0 && ind > 0) {
      orphanDeriveds.push({ id: node.id, name: node.name, file: node.componentFile })
    }
    if (ind === 0 && outd === 0) {
      isolatedNodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        file: node.componentFile,
      })
    }
  }
  return { effects, orphanDeriveds, isolatedNodes }
}
