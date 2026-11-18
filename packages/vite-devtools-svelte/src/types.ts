export interface RouteInfo {
  id: string;
  path: string;
  pattern: string;
  segments: string[];
  hasPage: boolean;
  hasLayout: boolean;
  hasServerPage: boolean;
  hasServerLayout: boolean;
  hasEndpoint: boolean;
  hasPageLoad: boolean;
  hasLayoutLoad: boolean;
  params: ParamInfo[];
  files: RouteFile[];
}

export interface ParamInfo {
  name: string;
  optional: boolean;
  rest: boolean;
  matcher?: string;
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
    | 'layout-load-server';
  path: string;
}

export interface AssetInfo {
  name: string;
  path: string;
  relativePath: string;
  /** Public dev-server URL of the file (Vite `base` + path under the static dir). */
  url: string;
  size: number;
  type: string;
  mtime: number;
}

export interface ProjectInfo {
  name: string;
  version: string;
  svelteVersion: string;
  sveltekitVersion: string;
  /** Whether SvelteKit's Vite plugin is active (not just installed). */
  kit: boolean;
  viteVersion: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  staticDir: string;
}

export interface ComponentRelation {
  file: string;
  name: string;
  imports: string[];
}

export interface ComponentInstance {
  id: number;
  file: string;
  name: string;
  parentId: number | null;
  mounted: boolean;
}

/** A component instance chosen with Inspect in the app page's inspector. */
export interface ElementPick {
  /** App page load the id belongs to. */
  epoch: string;
  /** Nearest tracked component instance (library components are not tracked). */
  componentId: number;
}

export interface RenderProfile {
  componentId: number;
  file: string;
  name: string;
  initTime: number;
  renderCount: number;
  totalRenderTime: number;
  lastRenderTime: number;
  lastRenderAt: number;
}

export interface ReactiveNode {
  id: string;
  /**
   * `template`: synthetic node standing for all markup effects of one
   * component (`<componentId>:(template)`); edges into it are reads from the
   * markup ({expr}, attributes, block conditions, <svelte:head>).
   */
  type: 'state' | 'derived' | 'effect' | 'template';
  name: string;
  componentId: number;
  componentFile: string;
  value?: unknown;
  /** A `$derived` nothing has read yet (Svelte computes deriveds lazily). */
  unevaluated?: true;
  /**
   * Dependencies on signals devtools does not track (created in
   * node_modules — e.g. SvelteKit's page state — or outside any component
   * init / module body). Absent when there are none.
   */
  untrackedDeps?: number;
}

export interface ReactiveEdge {
  from: string;
  to: string;
}

export interface ReactiveGraph {
  nodes: ReactiveNode[];
  edges: ReactiveEdge[];
}

export interface ReactiveGraphRequest {
  /** Within the served epoch; omitted = whole app. */
  componentId?: number;
  /**
   * The page load `componentId` came from. When it is no longer the served
   * one, the answer is empty with `staleReason: 'epoch-changed'` instead of
   * scoping a different instance that reuses the id.
   */
  epoch?: string;
  maxNodes?: number;
  maxEdges?: number;
}

/**
 * Sizes behind a (possibly capped) graph. `nodesKind: 'registered'` counts
 * every tracked node the runtime holds (an exact live count would need a full
 * scan); `'sent'` is what an older runtime sent before the server cut it.
 * `edges` is `null` when unknown (e.g. the runtime stopped at the cap).
 */
export interface ReactiveGraphTotal {
  nodes: number;
  nodesKind: 'registered' | 'sent';
  edges: number | null;
}

export interface ReactiveGraphResult extends ReactiveGraph {
  /** Component instance the graph is scoped to; `null` = whole app. */
  scope: number | null;
  epoch: string | null;
  /** `null` = unknown, never a guessed number. */
  total: ReactiveGraphTotal | null;
  /** Nodes or edges were left out because of a cap. */
  truncated: boolean;
  /** Edges left out because an endpoint was not included or the edge cap was hit. */
  edgesOmitted: number;
  /**
   * When the app built this graph (ms since epoch). Kept as is when the
   * answer is reused from the cache (≤ 1 s) or served as a stale fallback;
   * `null` for an empty fallback or a runtime that doesn't report it.
   */
  computedAt: number | null;
  /** `server-filter`: an older runtime sent the whole graph and the server scoped it. */
  policy: 'scoped' | 'global-head' | 'server-filter';
  /** Served from an earlier reply (or empty) because the runtime did not answer. */
  stale?: boolean;
  staleReason?: 'timeout' | 'no-runtime' | 'epoch-changed';
}

export interface ReactiveSummaryRequest {
  topK?: number;
}

export interface ReactiveSummaryRow {
  /** Component instance id, or the id of a module scope (`kind: 'module'`). */
  componentId: number;
  file: string;
  /**
   * `module`: shared state of a `.svelte.js` / `.svelte.ts` module (signals
   * created while its body ran), not a component instance.
   */
  kind?: 'module';
  nodes: { state: number; derived: number; effect: number };
  /**
   * Sampled state changes since the instance was registered (≤ 1 per node per
   * 200 ms tick); not a rate.
   */
  changes: number;
  /** Renders since the instance was registered. */
  renders: number;
  renderMs: number;
  /** When the last change or render was recorded (ms since epoch); `null` = unknown. */
  lastActiveAt: number | null;
}

/**
 * Whole-app overview without capturing the graph: the live instances with
 * their totals since each was registered (a destroyed instance leaves with
 * its counters). `rows` + `other` add up to `components` / the registered
 * node counts; `null` = unknown.
 */
export interface ReactiveSummary {
  epoch: string | null;
  /** When the page computed this answer (ms since epoch); `null` for an empty fallback. */
  computedAt: number | null;
  policy: 'sampled-200ms';
  /**
   * Tracked: signals created during a component's init (and its later block
   * updates / effect runs) and while a `.svelte.js`/`.ts` module body runs
   * (module scopes count as rows/components, `kind: 'module'`). Signals
   * created elsewhere (e.g. in an event handler) are not tracked.
   */
  coverage: 'component-init';
  /** `withActivity`: live instances with any change or render since they were registered. */
  components: { total: number | null; withActivity: number };
  rows: ReactiveSummaryRow[];
  other: { components: number; nodes: number } | null;
  /** More active instances than `topK`. */
  truncated: boolean;
  capabilities: { valueInspection: boolean; signalHistory: boolean; writeCause: boolean };
  /** First samples of the tracked `$state` (activity counts only real changes after them). */
  baseline?: TimelineBaseline;
  stale?: boolean;
  staleReason?: 'timeout' | 'no-runtime';
}

export type CaptureKey =
  | 'liveComponents'
  | 'renderProfiles'
  | 'stateTimeline'
  | 'reactiveNodes'
  | 'reactiveEdges'
  | 'fpsSamples'
  | 'runtimeErrors'
  | 'loadProfiles'
  | 'compilerWarnings';

/** Why entries were dropped: runtime ring/byte budget before sending, or server caps. */
export type DropReason = 'runtime-count' | 'runtime-bytes' | 'server-count' | 'server-bytes';

/**
 * Counts are monotonic until the dataset is cleared or its page load is
 * dropped; both bump the dataset version.
 */
export interface CaptureInfo {
  /** Items the server holds (what the dataset's RPC returns). */
  captured: number;
  /** Items reported before any cap; `null` = unknown. */
  total: number | null;
  truncated: boolean;
  /** How the subset is chosen, e.g. 'tail', 'roots-first', 'sampled-200ms'. */
  policy?: string;
  dropped?: Array<{ reason: DropReason; count: number }>;
  /** State values too large to snapshot (shown as a size summary). */
  valueTooLarge?: number;
  /** stateTimeline only: first samples taken at activation (never recorded as changes). */
  baseline?: TimelineBaseline;
  epoch?: string;
}

/**
 * Whether the runtime has a first sample of every tracked `$state`. Until
 * `complete`, a change to one of the `pendingNodes` is not yet observable as
 * old → new (its old value is unknown).
 */
export interface TimelineBaseline {
  complete: boolean;
  pendingNodes: number;
}

export type CaptureInfoMap = Partial<Record<CaptureKey, CaptureInfo>>;

export interface LoadProfile {
  route: string;
  file: string;
  type: 'server' | 'universal';
  duration: number;
  dataSize: number;
  timestamp: number;
}

export interface StateChange {
  id: string;
  name: string;
  componentFile: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

/** A timeline entry as served to clients: `seq` is server-assigned and monotonic. */
export interface StateTimelineEntry extends StateChange {
  seq: number;
}

export interface StateTimelineDelta {
  /** Pass back as `since` on the next call. */
  cursor: number;
  /** `true`: `changes` is the complete buffer (replace local copy). `false`: append `changes`. */
  reset: boolean;
  changes: StateTimelineEntry[];
}

/** Per-dataset change counters; refetch a dataset only when its counter moved. */
export interface DatasetVersions {
  components: number;
  renderProfiles: number;
  loadProfiles: number;
  stateTimeline: number;
  reactiveGraph: number;
  errors: number;
  fps: number;
  /** Moves on every file the dev server watches being added, changed or deleted. */
  apiEndpoints: number;
}

export interface LiveComponentsMeta {
  /** Instances the app currently has mounted. */
  total: number;
  /** Instances returned by `getLiveComponents()` (parents first). */
  kept: number;
  truncated: boolean;
  /**
   * Project root as live `file`s spell it (symlinks resolved, `/`-separated):
   * a live `file` is an absolute module id, a {@link ComponentRelation} `file`
   * is relative to this root.
   */
  root: string;
  /** App page load (epoch) being shown; several app tabs → the one that pushed most recently. */
  epoch?: string;
  /** App page loads currently tracked (≤ 4). */
  epochs: number;
}

export interface ApiEndpoint {
  route: string;
  /** Route path with params as `:name` / `:name?` / `*name`. */
  path: string;
  /**
   * `path` under the dev server's base, on the app's origin. Params stay
   * placeholders (`:id`, `:id?`, `*rest`) to fill in before sending.
   */
  url: string;
  methods: string[];
  /** False when some exports could not be followed: `methods` may miss handlers. */
  complete: boolean;
  file: string;
}

export interface CompilerWarning {
  code: string;
  message: string;
  file: string;
  line?: number;
  column?: number;
}

export interface RuntimeError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: number;
}

export interface InspectResult {
  source: string;
  compiled: string;
  file: string;
  /** VLQ-encoded source map `mappings` string (per the Source Map v3 spec). */
  mappings?: string;
  sources?: string[];
}

export interface ModuleNode {
  id: string;
  file: string;
  type: 'svelte' | 'js' | 'ts' | 'css' | 'other';
  importedBy: string[];
  imports: string[];
  isCyclic?: boolean;
  size?: number;
  /** Generated by SvelteKit under `.svelte-kit/`, not written by the user. */
  generated?: boolean;
}

export interface ModuleGraphData {
  modules: ModuleNode[];
  cycles: string[][];
}

export interface OGTag {
  property: string;
  content: string;
}

export interface OGPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  tags: OGTag[];
  issues: string[];
}

export interface BuildChunk {
  name: string;
  file: string;
  size: number;
  isEntry: boolean;
}

export interface BuildAnalysis {
  chunks: BuildChunk[];
  totalSize: number;
  timestamp: number;
}

export interface FpsSample {
  timestamp: number;
  fps: number;
}
