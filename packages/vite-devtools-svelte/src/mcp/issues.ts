import type { RenderProfile, ReactiveGraph, LoadProfile, FpsSample } from '../types.js'
import { avgRenderTime, min, round } from './stats.js'

type IssueKind =
  | 'slow-component-render'
  | 'over-rendered-component'
  | 'slow-load'
  | 'fps-drop'
  | 'effect-overconnected'

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
  /** Per-render time (ms) at or above which a component render is considered slow. */
  avgRenderTimeMs?: number
  /** Render count at or above which a component is considered over-rendered. */
  renderCount?: number
  /** Load duration (ms) at or above which a SvelteKit load is slow. */
  loadDurationMs?: number
  /** FPS strictly below which we record a drop. */
  fpsDropThreshold?: number
  /**
   * Dependency count (incoming edges: what the effect reads) at or above
   * which an effect is over-connected.
   */
  effectMaxDeps?: number
}

const DEFAULTS: Required<IssueThresholds> = {
  avgRenderTimeMs: 4,
  renderCount: 30,
  loadDurationMs: 200,
  fpsDropThreshold: 40,
  effectMaxDeps: 8,
}

/**
 * Thresholds over the defaults. An `undefined` value keeps the default: a
 * plain spread let `{ effectMaxDeps: undefined }` (what get_reactive_graph_problems
 * passes when the argument is omitted) disable the check, as `n >= undefined`
 * is always false.
 */
function withDefaults(thresholds: IssueThresholds): Required<IssueThresholds> {
  const t = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as Array<keyof IssueThresholds>) {
    const value = thresholds[key]
    if (value !== undefined) t[key] = value
  }
  return t
}

export interface IssueInputs {
  renderProfiles: RenderProfile[]
  reactiveGraph: ReactiveGraph
  loadProfiles: LoadProfile[]
  fpsSamples: FpsSample[]
}

/** `high` from `threshold * high`, `medium` from `threshold * medium`, else `low`. */
function severity(
  value: number,
  threshold: number,
  medium: number,
  high: number,
): PerformanceIssue['severity'] {
  if (value >= threshold * high) return 'high'
  return value >= threshold * medium ? 'medium' : 'low'
}

export function listPerformanceIssues(
  inputs: IssueInputs,
  thresholds: IssueThresholds = {},
): PerformanceIssue[] {
  const t = withDefaults(thresholds)
  const out: PerformanceIssue[] = []

  for (const p of inputs.renderProfiles) {
    const avg = avgRenderTime(p)
    if (avg >= t.avgRenderTimeMs) {
      out.push({
        id: `slow-render:${p.file}:${p.componentId}`,
        kind: 'slow-component-render',
        severity: severity(avg, t.avgRenderTimeMs, 2, 4),
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
        severity: severity(p.renderCount, t.renderCount, 3, 8),
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
        severity: severity(l.duration, t.loadDurationMs, 2, 5),
        summary: `${l.type} load for ${l.route} took ${l.duration.toFixed(0)}ms`,
        file: l.file,
        metric: { durationMs: round(l.duration), dataSizeBytes: l.dataSize },
        suggestedTool: 'get_load_waterfall',
      })
    }
  }

  const fpsDrops = inputs.fpsSamples.filter(s => s.fps < t.fpsDropThreshold)
  if (fpsDrops.length > 0) {
    const minFps = min(
      fpsDrops.map(s => s.fps),
      0,
    )
    out.push({
      id: `fps-drops:${inputs.fpsSamples[0]?.timestamp ?? 0}`,
      kind: 'fps-drop',
      severity: minFps < 15 ? 'high' : minFps < 30 ? 'medium' : 'low',
      summary: `${fpsDrops.length} FPS samples below ${t.fpsDropThreshold} (min ${minFps})`,
      metric: { dropCount: fpsDrops.length, minFps, threshold: t.fpsDropThreshold },
      suggestedTool: 'get_fps_drops',
    })
  }

  for (const effect of overconnectedEffects(inputs.reactiveGraph, t.effectMaxDeps)) {
    out.push({
      id: `effect-deps:${effect.id}`,
      kind: 'effect-overconnected',
      severity: severity(effect.depCount, t.effectMaxDeps, 2, 3),
      summary: `effect "${effect.name}" depends on ${effect.depCount} reactive values`,
      file: effect.file,
      metric: { depCount: effect.depCount },
      suggestedTool: 'get_reactive_graph_problems',
    })
  }

  return out.toSorted(compareSeverity)
}

const SEV_RANK: Record<PerformanceIssue['severity'], number> = { high: 0, medium: 1, low: 2 }

function compareSeverity(a: PerformanceIssue, b: PerformanceIssue): number {
  return SEV_RANK[a.severity] - SEV_RANK[b.severity]
}

/** In / out degree per node over distinct edges (a repeated edge is one dependency). */
function degrees(graph: ReactiveGraph): {
  inDegree: Map<string, number>
  outDegree: Map<string, number>
} {
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  const seen = new Set<string>()
  for (const e of graph.edges) {
    const key = JSON.stringify([e.from, e.to])
    if (seen.has(key)) continue
    seen.add(key)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1)
  }
  return { inDegree, outDegree }
}

/** Effects with at least `maxDeps` distinct dependencies (incoming edges), in node order. */
function overconnectedEffects(graph: ReactiveGraph, maxDeps: number): ReactiveProblems['effects'] {
  const { inDegree } = degrees(graph)
  const effects: ReactiveProblems['effects'] = []
  for (const node of graph.nodes) {
    const depCount = inDegree.get(node.id) ?? 0
    if (node.type === 'effect' && depCount >= maxDeps) {
      effects.push({ id: node.id, name: node.name, file: node.componentFile, depCount })
    }
  }
  return effects
}

export interface ReactiveProblems {
  effects: Array<{ id: string; name: string; file: string; depCount: number }>
  /**
   * `$derived` values nothing has read so far (never evaluated). A derived
   * read only imperatively (event handler, plain function) is evaluated and
   * is not listed: having no effect/markup reader is not "unused".
   */
  orphanDeriveds: Array<{ id: string; name: string; file: string }>
  /**
   * Nodes without any dependency or tracked reader (markup reads included).
   * A node depending only on untracked signals (`untrackedDeps`) is not listed.
   */
  isolatedNodes: Array<{ id: string; name: string; type: string; file: string }>
}

export function summarizeReactiveProblems(
  graph: ReactiveGraph,
  t: IssueThresholds = {},
): ReactiveProblems {
  const { inDegree, outDegree } = degrees(graph)
  const orphanDeriveds: ReactiveProblems['orphanDeriveds'] = []
  const isolatedNodes: ReactiveProblems['isolatedNodes'] = []
  for (const node of graph.nodes) {
    if (node.type === 'template') continue
    if (node.type === 'derived' && node.unevaluated) {
      orphanDeriveds.push({ id: node.id, name: node.name, file: node.componentFile })
    } else if (!inDegree.has(node.id) && !outDegree.has(node.id) && !node.untrackedDeps) {
      isolatedNodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        file: node.componentFile,
      })
    }
  }
  const effects = overconnectedEffects(graph, withDefaults(t).effectMaxDeps)
  return { effects, orphanDeriveds, isolatedNodes }
}
