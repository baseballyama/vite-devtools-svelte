export interface RouteInfo {
  id: string
  path: string
  pattern: string
  segments: string[]
  hasPage: boolean
  hasLayout: boolean
  hasServerPage: boolean
  hasServerLayout: boolean
  hasEndpoint: boolean
  hasPageLoad: boolean
  hasLayoutLoad: boolean
  params: ParamInfo[]
  files: RouteFile[]
}

export interface ParamInfo {
  name: string
  optional: boolean
  rest: boolean
  matcher?: string
}

export interface RouteFile {
  type:
    | 'page'
    | 'layout'
    | 'server-page'
    | 'server-layout'
    | 'endpoint'
    | 'page-load'
    | 'layout-load'
    | 'error'
    | 'page-load-server'
    | 'layout-load-server'
  path: string
}

export interface AssetInfo {
  name: string
  path: string
  relativePath: string
  /** Public dev-server URL of the file (Vite `base` + path under the static dir). */
  url: string
  size: number
  type: string
  mtime: number
}

export interface ProjectInfo {
  name: string
  version: string
  svelteVersion: string
  sveltekitVersion: string
  viteVersion: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  routesDir: string
  staticDir: string
}

export interface ComponentRelation {
  file: string
  name: string
  imports: string[]
}

export interface ComponentInstance {
  id: number
  file: string
  name: string
  parentId: number | null
  mounted: boolean
}

// Phase 2: Performance Analysis

export interface RenderProfile {
  componentId: number
  file: string
  name: string
  initTime: number
  renderCount: number
  totalRenderTime: number
  lastRenderTime: number
  lastRenderAt: number
}

export interface ReactiveNode {
  id: string
  /**
   * `template`: synthetic node standing for all markup effects of one
   * component (`<componentId>:(template)`); edges into it are reads from the
   * markup ({expr}, attributes, block conditions, <svelte:head>).
   */
  type: 'state' | 'derived' | 'effect' | 'template'
  name: string
  componentId: number
  componentFile: string
  value?: unknown
  /** A `$derived` nothing has read yet (Svelte computes deriveds lazily). */
  unevaluated?: true
}

export interface ReactiveEdge {
  from: string
  to: string
}

export interface ReactiveGraph {
  nodes: ReactiveNode[]
  edges: ReactiveEdge[]
}

/** `get-reactive-graph` arguments (docs/devframe-migration.md §6.7 A). Omitted = whole app. */
export interface ReactiveGraphRequest {
  /** Component instance id within the served epoch (page load). */
  componentId?: number
  /**
   * The page load `componentId` came from. When it is no longer the served
   * one, the answer is empty with `staleReason: 'epoch-changed'` instead of
   * scoping a different instance that reuses the id.
   */
  epoch?: string
  maxNodes?: number
  maxEdges?: number
}

/**
 * Sizes behind a (possibly capped) graph. `nodesKind: 'registered'` counts
 * every tracked node the runtime holds (an exact live count would need a full
 * scan); `'sent'` is what an older runtime sent before the server cut it.
 * `edges` is `null` when unknown (e.g. the runtime stopped at the cap).
 */
export interface ReactiveGraphTotal {
  nodes: number
  nodesKind: 'registered' | 'sent'
  edges: number | null
}

export interface ReactiveGraphResult extends ReactiveGraph {
  /** Component instance the graph is scoped to; `null` = whole app. */
  scope: number | null
  /** Page load the graph came from; `null` when no page load is known. */
  epoch: string | null
  /** `null` = unknown, never a guessed number. */
  total: ReactiveGraphTotal | null
  /** Nodes or edges were left out because of a cap. */
  truncated: boolean
  /** Edges left out because an endpoint was not included or the edge cap was hit. */
  edgesOmitted: number
  /**
   * When the app built this graph (ms since epoch). Kept as is when the
   * answer is reused from the cache (≤ 1 s) or served as a stale fallback;
   * `null` for an empty fallback or a runtime that doesn't report it.
   */
  computedAt: number | null
  /** `server-filter`: an older runtime sent the whole graph and the server scoped it. */
  policy: 'scoped' | 'global-head' | 'server-filter'
  /** Served from an earlier reply (or empty) because the runtime did not answer. */
  stale?: boolean
  staleReason?: 'timeout' | 'no-runtime' | 'epoch-changed'
}

/** `get-reactive-summary` arguments (§6.7 I). */
export interface ReactiveSummaryRequest {
  topK?: number
  windowMs?: number
}

/** One component instance in the overview, from runtime counters over all instances. */
export interface ReactiveSummaryRow {
  componentId: number
  file: string
  /** Tracked nodes registered for this instance, by type. */
  nodes: { state: number; derived: number; effect: number }
  /** Sampled state changes in the window (≤ 1 per node per 200 ms tick); not a rate. */
  changes: number
  /** Renders in the window. */
  renders: number
  renderMs: number
}

/**
 * Whole-app overview without capturing the graph (§6.7 I/J). `rows` + `other`
 * add up to `components` / the registered node counts; `null` = unknown.
 */
export interface ReactiveSummary {
  epoch: string | null
  window: { ms: number; since: number; until: number; sampledActiveMs: number }
  policy: 'sampled-200ms'
  /** Only state created during a component's init is tracked. */
  coverage: 'component-init'
  components: { total: number | null; withActivity: number }
  rows: ReactiveSummaryRow[]
  other: { components: number; nodes: number } | null
  /** More active instances than `topK`. */
  truncated: boolean
  capabilities: { valueInspection: boolean; signalHistory: boolean; writeCause: boolean }
  /** First samples of the tracked `$state` (activity counts only real changes after them). */
  baseline?: TimelineBaseline
  stale?: boolean
  staleReason?: 'timeout' | 'no-runtime'
}

/** Datasets with capture metadata (`get-capture-info`). */
export type CaptureKey =
  | 'liveComponents'
  | 'renderProfiles'
  | 'stateTimeline'
  | 'reactiveNodes'
  | 'reactiveEdges'
  | 'fpsSamples'
  | 'runtimeErrors'
  | 'loadProfiles'
  | 'compilerWarnings'

/** Why entries were dropped: runtime ring/byte budget before sending, or server caps. */
export type DropReason = 'runtime-count' | 'runtime-bytes' | 'server-count' | 'server-bytes'

/**
 * What the server holds versus what was reported, per dataset (§6.7 B).
 * Counts are monotonic until the dataset is cleared or its page load is
 * dropped; both bump the dataset version.
 */
export interface CaptureInfo {
  /** Items the server holds (what the dataset's RPC returns). */
  captured: number
  /** Items reported before any cap; `null` = unknown. */
  total: number | null
  truncated: boolean
  /** How the subset is chosen, e.g. 'tail', 'roots-first', 'sampled-200ms'. */
  policy?: string
  dropped?: Array<{ reason: DropReason; count: number }>
  /** State values too large to snapshot (shown as a size summary). */
  valueTooLarge?: number
  /** stateTimeline only: first samples taken at activation (never recorded as changes). */
  baseline?: TimelineBaseline
  epoch?: string
}

/**
 * Whether the runtime has a first sample of every tracked `$state`. Until
 * `complete`, a change to one of the `pendingNodes` is not yet observable as
 * old → new (its old value is unknown).
 */
export interface TimelineBaseline {
  complete: boolean
  pendingNodes: number
}

export type CaptureInfoMap = Partial<Record<CaptureKey, CaptureInfo>>

export interface LoadProfile {
  route: string
  file: string
  type: 'server' | 'universal'
  duration: number
  dataSize: number
  timestamp: number
}

// Phase 3: Debug & Developer Experience

export interface StateChange {
  id: string
  name: string
  componentFile: string
  oldValue: unknown
  newValue: unknown
  timestamp: number
}

/** A timeline entry as served to clients: `seq` is server-assigned and monotonic. */
export interface StateTimelineEntry extends StateChange {
  seq: number
}

/** Cursor-based timeline read (`getStateTimelineDelta`). */
export interface StateTimelineDelta {
  /** Pass back as `since` on the next call. */
  cursor: number
  /** `true`: `changes` is the complete buffer (replace local copy). `false`: append `changes`. */
  reset: boolean
  changes: StateTimelineEntry[]
}

/** Per-dataset change counters; refetch a dataset only when its counter moved. */
export interface DatasetVersions {
  components: number
  renderProfiles: number
  loadProfiles: number
  stateTimeline: number
  reactiveGraph: number
  errors: number
  fps: number
}

export interface LiveComponentsMeta {
  /** Instances the app currently has mounted. */
  total: number
  /** Instances returned by `getLiveComponents()` (parents first). */
  kept: number
  truncated: boolean
  /** App page load (epoch) being shown; several app tabs → the one that pushed most recently. */
  epoch?: string
  /** App page loads currently tracked (≤ 4). */
  epochs: number
}

export interface ApiEndpoint {
  route: string
  path: string
  methods: string[]
  file: string
}

export interface ApiResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
}

export interface CompilerWarning {
  code: string
  message: string
  file: string
  line?: number
  column?: number
}

export interface RuntimeError {
  message: string
  file?: string
  line?: number
  column?: number
  stack?: string
  timestamp: number
}

export interface InspectResult {
  source: string
  compiled: string
  file: string
  /** VLQ-encoded source map `mappings` string (per the Source Map v3 spec). */
  mappings?: string
  /** Source map sources array */
  sources?: string[]
}

// Phase 4: Advanced Features

export interface ModuleNode {
  id: string
  file: string
  type: 'svelte' | 'js' | 'ts' | 'css' | 'other'
  importedBy: string[]
  imports: string[]
  isCyclic?: boolean
  size?: number
}

export interface ModuleGraphData {
  modules: ModuleNode[]
  cycles: string[][]
}

export interface OGTag {
  property: string
  content: string
}

export interface OGPreview {
  url: string
  title: string
  description: string
  image: string
  tags: OGTag[]
  issues: string[]
}

export interface BuildChunk {
  name: string
  file: string
  size: number
  modules: string[]
  isEntry: boolean
}

export interface BuildAnalysis {
  chunks: BuildChunk[]
  totalSize: number
  timestamp: number
}

// FPS Monitoring

export interface FpsSample {
  timestamp: number
  fps: number
}
