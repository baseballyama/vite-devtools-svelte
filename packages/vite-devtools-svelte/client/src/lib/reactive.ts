/**
 * Reactivity data helpers (docs/devframe-migration.md §6.7 A/I).
 *
 * Replies are normalised so the UI never shows a guessed number: anything
 * the server did not report is `null` / `false`.
 */
import { getReactiveGraph, getReactiveSummary } from './rpc.js'
import { formatValue } from './format.js'
import type {
  ReactiveGraph,
  ReactiveGraphRequest,
  ReactiveGraphResult,
  ReactiveNode,
  ReactiveSummary,
  ReactiveSummaryRequest,
  ReactiveSummaryRow,
} from './types.js'

/** Server-side caps (§6.7 A); larger requests are rejected by the RPC schema. */
export const GRAPH_CAPS = { maxNodes: 5000, maxEdges: 20000 } as const

export const EMPTY_GRAPH: ReactiveGraphResult = {
  nodes: [],
  edges: [],
  scope: null,
  epoch: null,
  total: null,
  truncated: false,
  edgesOmitted: 0,
  policy: 'global-head',
  computedAt: null,
}

/**
 * Fill the §6.7 A fields a reply without them (an older server) lacks,
 * without inventing totals. Such a server always sends the whole app; when
 * one component was asked for, it is narrowed here (`policy: 'server-filter'`).
 */
export function normalizeGraph(
  g: ReactiveGraph | ReactiveGraphResult,
  requested: number | null,
): ReactiveGraphResult {
  const r = g as Partial<ReactiveGraphResult> & ReactiveGraph
  if (r.policy !== undefined) {
    return {
      nodes: r.nodes ?? [],
      edges: r.edges ?? [],
      scope: r.scope ?? null,
      epoch: r.epoch ?? null,
      total: r.total ?? null,
      truncated: !!r.truncated,
      edgesOmitted: r.edgesOmitted ?? 0,
      policy: r.policy,
      computedAt: r.computedAt ?? null,
      ...(r.stale ? { stale: true, staleReason: r.staleReason } : {}),
    }
  }
  const nodes = requested === null ? r.nodes : r.nodes.filter(n => n.componentId === requested)
  const ids = new Set(nodes.map(n => n.id))
  const edges = requested === null ? r.edges : r.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  return {
    nodes,
    edges,
    scope: requested,
    epoch: null,
    total: null,
    truncated: false,
    edgesOmitted: r.edges.length - edges.length,
    policy: requested === null ? 'global-head' : 'server-filter',
    computedAt: null,
  }
}

/**
 * One component instance or, with `null`, the whole app within the caps.
 * A scoped request always carries the page load (`epoch`) the id came from;
 * the server then answers `staleReason: 'epoch-changed'` instead of scoping a
 * different instance that reuses the id.
 */
export async function fetchGraph(
  scope: { componentId: number; epoch: string } | null,
): Promise<ReactiveGraphResult> {
  const componentId = scope?.componentId ?? null
  const req: ReactiveGraphRequest = scope
    ? { componentId: scope.componentId, epoch: scope.epoch, ...GRAPH_CAPS }
    : { ...GRAPH_CAPS }
  return normalizeGraph(await getReactiveGraph(req), componentId)
}

export function fetchSummary(req: ReactiveSummaryRequest): Promise<ReactiveSummary> {
  return getReactiveSummary(req)
}

/**
 * The runtime sends node values as primitives or short summaries
 * ('(object)', '[n]', '{n}'), so Object.is is exact; anything else (an
 * out-of-spec sender) falls back to comparing JSON.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** The server refused a scoped request because the page reloaded (§6.7 A, epoch check). */
export const isEpochChanged = (g: { staleReason?: string }) => g.staleReason === 'epoch-changed'

/** Shown when the baseline is not reported (older runtime): unknown is not the same as complete. */
export const BASELINE_UNKNOWN =
  'Sampling baseline: unknown (not reported by this runtime) — some changes may not be visible'

/**
 * Disclosure of the runtime's first samples of every tracked `$state`:
 * pending states while incomplete, {@link BASELINE_UNKNOWN} when not
 * reported, and `null` (no notice) only when the runtime says it is complete.
 */
export function baselineNotice(
  b: { complete: boolean; pendingNodes: number } | undefined | null,
): string | null {
  if (!b) return BASELINE_UNKNOWN
  if (b.complete) return null
  return `Sampling baseline: ${b.pendingNodes.toLocaleString()} state${b.pendingNodes === 1 ? '' : 's'} pending — changes to ${b.pendingNodes === 1 ? 'it are' : 'those are'} not visible yet`
}

/** A value the runtime summarised instead of sending it. */
export const isValueSummary = (v: unknown) =>
  typeof v === 'string' && /^(\(object\)|\[\d+\]|\{\d+\})$/.test(v)

/** A node value for display: runtime summaries as they are (not as a quoted string). */
export const nodeValueText = (v: unknown, max?: number) =>
  isValueSummary(v) ? (v as string) : formatValue(v, max)

const sameNode = (a: ReactiveNode, b: ReactiveNode) =>
  a.id === b.id &&
  a.type === b.type &&
  a.name === b.name &&
  a.componentId === b.componentId &&
  a.componentFile === b.componentFile &&
  sameValue(a.value, b.value)

/** O(nodes + edges) change check, instead of serialising the whole graph every poll. */
export function sameGraph(a: ReactiveGraphResult, b: ReactiveGraphResult): boolean {
  if (
    a.scope !== b.scope ||
    a.epoch !== b.epoch ||
    a.truncated !== b.truncated ||
    a.policy !== b.policy ||
    a.edgesOmitted !== b.edgesOmitted ||
    !!a.stale !== !!b.stale ||
    a.staleReason !== b.staleReason ||
    a.total?.nodes !== b.total?.nodes ||
    a.total?.nodesKind !== b.total?.nodesKind ||
    a.total?.edges !== b.total?.edges
  )
    return false
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  for (let i = 0; i < a.nodes.length; i++) if (!sameNode(a.nodes[i], b.nodes[i])) return false
  for (let i = 0; i < a.edges.length; i++) {
    if (a.edges[i].from !== b.edges[i].from || a.edges[i].to !== b.edges[i].to) return false
  }
  return true
}

/** Overview rows folded by component file (IS5: file → instances → nodes). */
export interface SummaryFileRow {
  file: string
  instances: ReactiveSummaryRow[]
  nodes: { state: number; derived: number; effect: number }
  changes: number
  renders: number
  renderMs: number
}

export function groupByFile(rows: readonly ReactiveSummaryRow[]): SummaryFileRow[] {
  const m = new Map<string, SummaryFileRow>()
  for (const r of rows) {
    let g = m.get(r.file)
    if (!g) {
      g = {
        file: r.file,
        instances: [],
        nodes: { state: 0, derived: 0, effect: 0 },
        changes: 0,
        renders: 0,
        renderMs: 0,
      }
      m.set(r.file, g)
    }
    g.instances.push(r)
    g.nodes.state += r.nodes.state
    g.nodes.derived += r.nodes.derived
    g.nodes.effect += r.nodes.effect
    g.changes += r.changes
    g.renders += r.renders
    g.renderMs += r.renderMs
  }
  return [...m.values()]
}

/** Registered nodes of a row. */
export const nodeCount = (n: { state: number; derived: number; effect: number }) =>
  n.state + n.derived + n.effect
