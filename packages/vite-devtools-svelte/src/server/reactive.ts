import type {
  ReactiveEdge,
  ReactiveGraphResult,
  ReactiveGraphTotal,
  ReactiveNode,
  ReactiveSummary,
  ReactiveSummaryRow,
} from '../types.js'
import { arrayOf, asPayload, finiteOrNull, nonNegInt } from './payload.js'
import type { Payload } from './payload.js'
import { isBaseline } from './state-timeline.js'

/** Most nodes / edges one graph answer holds. */
export const GRAPH_LIMITS = { nodes: 5000, edges: 20000 } as const

/** Defaults and bounds for `get-reactive-summary` (§6.7 I). */
export const SUMMARY_DEFAULTS = {
  topK: 50,
  maxTopK: 200,
  windowMs: 10_000,
  minWindowMs: 1000,
  maxWindowMs: 60_000,
} as const

export type StaleReason = NonNullable<ReactiveGraphResult['staleReason']>

/** An empty graph answer, marked stale for `reason`. */
export function emptyGraph(
  scope: number | null,
  epoch: string | null,
  reason: StaleReason,
): ReactiveGraphResult {
  return {
    nodes: [],
    edges: [],
    scope,
    epoch,
    total: null,
    truncated: false,
    edgesOmitted: 0,
    computedAt: null,
    policy: scope === null ? 'global-head' : 'scoped',
    stale: true,
    staleReason: reason,
  }
}

/** An empty summary answer, marked stale for `reason`. */
export function emptySummary(
  epoch: string | null,
  windowMs: number,
  reason: 'timeout' | 'no-runtime',
): ReactiveSummary {
  return {
    epoch,
    window: { ms: windowMs, since: 0, until: 0, sampledActiveMs: 0 },
    policy: 'sampled-200ms',
    coverage: 'component-init',
    components: { total: null, withActivity: 0 },
    rows: [],
    other: null,
    truncated: false,
    capabilities: { valueInspection: false, signalHistory: false, writeCause: false },
    stale: true,
    staleReason: reason,
  }
}

/**
 * Shape a runtime reply into a {@link ReactiveGraphResult}: apply the caps
 * (nodes, then only edges between kept nodes, then the edge cap) and report
 * what was left out. Totals come from the runtime; an older runtime's (no
 * `requestId`) are the counts it sent (`nodesKind: 'sent'`), or unknown when
 * the server had to scope its whole-app graph.
 */
export function normalizeGraph(
  data: Payload | undefined,
  scope: number | null,
  epoch: string | null,
): ReactiveGraphResult {
  const legacy = typeof data?.requestId !== 'string'
  let nodes = arrayOf<ReactiveNode>(data?.nodes)
  const rawEdges = arrayOf<ReactiveEdge>(data?.edges)
  let policy: ReactiveGraphResult['policy'] =
    data?.policy === 'scoped' || data?.policy === 'global-head'
      ? data.policy
      : scope === null
        ? 'global-head'
        : 'scoped'
  let total: ReactiveGraphTotal | null = null
  const reportedTotal = asPayload(data?.total)
  if (!legacy && typeof reportedTotal?.nodes === 'number') {
    total = {
      nodes: reportedTotal.nodes,
      nodesKind: 'registered',
      edges: typeof reportedTotal.edges === 'number' ? reportedTotal.edges : null,
    }
  }
  if (legacy && scope !== null) {
    // Older runtime: whole app. Keep the component's nodes and their direct neighbours.
    const own = new Set(nodes.filter(n => n?.componentId === scope).map(n => n.id))
    const keep = new Set(own)
    for (const e of rawEdges) {
      if (own.has(e?.from)) keep.add(e.to)
      if (own.has(e?.to)) keep.add(e.from)
    }
    nodes = nodes.filter(n => keep.has(n?.id))
    policy = 'server-filter'
  } else if (legacy) {
    total = { nodes: nodes.length, nodesKind: 'sent', edges: rawEdges.length }
  }
  let truncated = data?.truncated === true
  if (nodes.length > GRAPH_LIMITS.nodes) {
    nodes = nodes.slice(0, GRAPH_LIMITS.nodes)
    truncated = true
  }
  const ids = new Set(nodes.map(n => n?.id))
  let edgesOmitted = nonNegInt(data?.edgesOmitted)
  const edges: ReactiveEdge[] = []
  for (const e of rawEdges) {
    if (!ids.has(e?.from) || !ids.has(e?.to)) {
      if (policy !== 'server-filter') edgesOmitted++
    } else if (edges.length < GRAPH_LIMITS.edges) {
      edges.push(e)
    } else {
      edgesOmitted++
      truncated = true
    }
  }
  return {
    nodes,
    edges,
    scope,
    epoch: typeof data?.epoch === 'string' ? data.epoch : epoch,
    total,
    truncated,
    edgesOmitted,
    // When the app built this graph; null from a runtime that doesn't say.
    computedAt: finiteOrNull(data?.computedAt),
    policy,
  }
}

/** Shape a runtime summary reply (§6.7 I); every field is validated, nothing assumed. */
export function normalizeSummary(data: Payload | undefined, epoch: string | null): ReactiveSummary {
  const rows = arrayOf<unknown>(data?.rows)
    .slice(0, SUMMARY_DEFAULTS.maxTopK)
    .map(raw => {
      const r = asPayload(raw)
      const nodes = asPayload(r?.nodes)
      const row: ReactiveSummaryRow = {
        componentId: nonNegInt(r?.componentId),
        file: typeof r?.file === 'string' ? r.file : '',
        nodes: {
          state: nonNegInt(nodes?.state),
          derived: nonNegInt(nodes?.derived),
          effect: nonNegInt(nodes?.effect),
        },
        changes: nonNegInt(r?.changes),
        renders: nonNegInt(r?.renders),
        renderMs: typeof r?.renderMs === 'number' && r.renderMs >= 0 ? r.renderMs : 0,
      }
      if (r?.kind === 'module') row.kind = 'module'
      return row
    })
  const w = asPayload(data?.window)
  const components = asPayload(data?.components)
  const other = asPayload(data?.other)
  const capabilities = asPayload(data?.capabilities)
  return {
    epoch: typeof data?.epoch === 'string' ? data.epoch : epoch,
    window: {
      ms: nonNegInt(w?.ms),
      since: nonNegInt(w?.since),
      until: nonNegInt(w?.until),
      sampledActiveMs: nonNegInt(w?.sampledActiveMs),
    },
    policy: 'sampled-200ms',
    coverage: 'component-init',
    components: {
      total: typeof components?.total === 'number' ? components.total : null,
      withActivity: nonNegInt(components?.withActivity),
    },
    rows,
    other:
      typeof other?.components === 'number' && typeof other.nodes === 'number'
        ? { components: other.components, nodes: other.nodes }
        : null,
    truncated: data?.truncated === true,
    // Only what the runtime says it implements; never assumed.
    capabilities: {
      valueInspection: capabilities?.valueInspection === true,
      signalHistory: capabilities?.signalHistory === true,
      writeCause: capabilities?.writeCause === true,
    },
    ...(isBaseline(data?.baseline) && { baseline: { ...data.baseline } }),
  }
}
