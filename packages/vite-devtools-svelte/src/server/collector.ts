import type {
  CaptureInfo,
  CaptureInfoMap,
  CompilerWarning,
  DropReason,
  ComponentInstance,
  FpsSample,
  LoadProfile,
  ReactiveGraph,
  ReactiveGraphRequest,
  ReactiveGraphResult,
  ReactiveGraphTotal,
  ReactiveSummary,
  ReactiveSummaryRequest,
  RenderProfile,
  RuntimeError,
  StateChange,
  StateTimelineDelta,
  StateTimelineEntry,
  DatasetVersions,
  TimelineBaseline,
} from '../types.js'

// Defensive caps on runtime-supplied data: even though the runtime already
// trims its own buffers, an out-of-spec or compromised runtime could hand us
// unbounded payloads and inflate dev-server memory.
export const LIMITS = {
  liveComponents: 50000,
  renderProfiles: 5000,
  stateTimeline: 500,
  reactiveNodes: 5000,
  reactiveEdges: 20000,
  fpsSamples: 1200,
  runtimeErrors: 200,
  loadProfiles: 200,
  compilerWarnings: 500,
} as const

/** How long a pull request to the browser runtime may take before we answer from cache. */
export const RUNTIME_REQUEST_TIMEOUT = 1000

/** A pull answered within this window is reused instead of asking the runtime again. */
export const PULL_FRESHNESS = 1000

/** Byte budget (JSON length, measured once at ingest) for the server-side state timeline. */
export const STATE_TIMELINE_BYTES = 4 * 1024 * 1024

export type DatasetKey = keyof DatasetVersions

// Timeline `seq` values come from one process-wide counter, seeded from the
// clock: a cursor issued by an earlier collector in this process (inline or
// config-file restart) is always below a newer collector's `timelineResetAt`,
// and one from a previous process is too unless it issued more than 1 000
// entries per millisecond of downtime (review D2).
let lastSeq = Date.now() * 1000
const nextSeq = () => ++lastSeq

/** Epoch for runtimes that send payloads without an epoch. */
const LEGACY_EPOCH = '(legacy)'

/** App page loads (tabs / reloads) whose component tree + profiles are kept, LRU. */
export const MAX_EPOCHS = 4

interface EpochState {
  /** Insertion order = registration order (parents first). */
  components: Map<number, ComponentInstance>
  /**
   * Ids of mounted instances not stored: beyond the cap, or whose parent
   * isn't stored (admitting them would show orphans). Ids only, so the total
   * and removals stay exact.
   */
  overflow: Set<number>
  /** A full components snapshot was applied, so deltas have a base. */
  hasBase: boolean
  profiles: RenderProfile[]
  /** Profiles the runtime holds before its tail cap (sent as `total`); `null` = unknown. */
  profilesTotal: number | null
}

/** Hot-channel event names shared with `runtime.ts` (stable contract, see docs/devframe-migration.md §6). */
export const HOT_EVENTS = {
  components: 'svelte-devtools:components',
  profiles: 'svelte-devtools:profiles',
  stateTimeline: 'svelte-devtools:state-timeline',
  fps: 'svelte-devtools:fps',
  runtimeError: 'svelte-devtools:runtime-error',
  reactiveGraph: 'svelte-devtools:reactive-graph',
  requestReactiveGraph: 'svelte-devtools:request-reactive-graph',
  /** server → runtime `{ requestId, epoch?, topK, windowMs }`; reply `reactiveSummary` (§6.7 I). */
  requestReactiveSummary: 'svelte-devtools:request-reactive-summary',
  reactiveSummary: 'svelte-devtools:reactive-summary',
  requestStateTimeline: 'svelte-devtools:request-state-timeline',
  clearStateTimeline: 'svelte-devtools:clear-state-timeline',
  /** runtime → server, once per page load: "send me the current subscription state". */
  runtimeReady: 'svelte-devtools:runtime-ready',
  /** server → runtime(s): `{ active: boolean }` — whether any consumer is watching. */
  subscription: 'svelte-devtools:subscription',
} as const

/** Keyed pull results kept for reuse / stale fallback (graph scopes, summaries), LRU. */
const MAX_CACHED_PULLS = 32

/** Defaults and bounds for `get-reactive-summary` (§6.7 I). */
export const SUMMARY_DEFAULTS = {
  topK: 50,
  maxTopK: 200,
  windowMs: 10_000,
  minWindowMs: 1000,
  maxWindowMs: 60_000,
} as const

const DROP_REASONS: readonly DropReason[] = [
  'runtime-count',
  'runtime-bytes',
  'server-count',
  'server-bytes',
]

/** An integer within [min, max], or `fallback` when absent / not a number. */
function validBaseline(b: unknown): b is TimelineBaseline {
  const v = b as Partial<TimelineBaseline> | undefined
  return (
    !!v &&
    typeof v.complete === 'boolean' &&
    Number.isInteger(v.pendingNodes) &&
    (v.pendingNodes as number) >= 0
  )
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** A pull request waiting for the runtime's reply, matched by `requestId` (§6.7 A, M1). */
interface PendingPull {
  kind: 'graph' | 'summary'
  key: string
  epoch: string | null
  scope: number | null
  resolve: (value: ReactiveGraphResult | ReactiveSummary) => void
  timer: ReturnType<typeof setTimeout>
}

/** A consumer (DevTools UI tab, MCP agent) counts as watching until its lease expires. */
export const LEASE_TTL = 15_000

export interface HotClient {
  send(event: string, payload: unknown): void
}

export interface HotChannel {
  send(event: string, payload: unknown): void
  on(event: string, listener: (payload: any, client: HotClient) => void): void
  off?(event: string, listener: (payload: any, client: HotClient) => void): void
}

export interface CollectorHooks {
  onFpsSample?: (sample: FpsSample) => void
  onLoadProfile?: (profile: LoadProfile) => void
}

function tail<T>(arr: unknown, max: number): T[] {
  const list = Array.isArray(arr) ? (arr as T[]) : []
  return list.length > max ? list.slice(-max) : list
}

function head<T>(arr: unknown, max: number): T[] {
  const list = Array.isArray(arr) ? (arr as T[]) : []
  return list.length > max ? list.slice(0, max) : list
}

/**
 * Host-side store for everything the browser runtime and the instrumentation
 * transforms report. Independent of Vite and of devframe: the Vite plugin
 * feeds it, the devframe RPC layer and the MCP server read from it.
 */
export class Collector {
  // Component tree + render profiles are kept per app page load (`epoch`),
  // so several app tabs / a reload don't overwrite each other; the epoch that
  // pushed most recently is the one served (review D3, perf R-A8).
  private epochs = new Map<string, EpochState>()
  private servedEpoch: string | undefined
  private liveCache: ComponentInstance[] | undefined
  loadProfiles: LoadProfile[] = []
  reactiveGraph: ReactiveGraph = { nodes: [], edges: [] }
  compilerWarnings: CompilerWarning[] = []
  runtimeErrors: RuntimeError[] = []
  fpsSamples: FpsSample[] = []
  // Opaque change tokens drawn from the process-wide counter (like timeline
  // seqs): a restarted server's collector never reports a value a client saw
  // before, so "unchanged version → skip refetch" stays correct across
  // restarts (review B1).
  readonly versions: DatasetVersions = {
    components: nextSeq(),
    renderProfiles: nextSeq(),
    loadProfiles: nextSeq(),
    stateTimeline: nextSeq(),
    reactiveGraph: nextSeq(),
    errors: nextSeq(),
    fps: nextSeq(),
  }

  private bump(...keys: DatasetKey[]): void {
    for (const key of keys) this.versions[key] = nextSeq()
  }

  private timeline: StateTimelineEntry[] = []
  /** Parallel to `timeline`: JSON size and source epoch (app page load) of each entry. */
  private timelineSizes: number[] = []
  private timelineEpochs: string[] = []
  private timelineBytes = 0
  /** Newest seq issued by this collector (= the current cursor). */
  private timelineSeq = nextSeq()
  /** Cursor value at the last removal; older cursors must start over. */
  private timelineResetAt = this.timelineSeq
  /** Seq of the newest entry trimmed by the caps; cursors below it missed entries. */
  private timelineTrimmedAt = this.timelineSeq
  private lastPull = { stateTimeline: 0 }
  private inflight: { stateTimeline?: Promise<StateChange[]> } = {}

  // Keyed pulls (graph scopes, summaries; §6.7 A/I): each request carries a
  // requestId + the served epoch, and only the matching reply resolves it, so
  // one viewer never receives another viewer's scope (review G5, M1).
  private pulls = new Map<string, PendingPull>()
  private pullCache = new Map<
    string,
    { value: ReactiveGraphResult | ReactiveSummary; at: number }
  >()
  private pullInflight = new Map<string, Promise<ReactiveGraphResult | ReactiveSummary>>()
  private requestSeq = 0
  /** The most recent graph reply, for capture info. */
  private lastGraph: ReactiveGraphResult | undefined

  // Timeline losses per epoch, by reason; monotonic until the epoch is
  // evicted or the timeline is cleared (§6.7 B/C).
  private timelineDrops = new Map<string, Record<DropReason, number>>()
  /** Per epoch: whether the runtime has a first sample of every tracked $state yet. */
  private timelineBaseline = new Map<string, TimelineBaseline>()
  private timelineTooLarge = new Map<string, number>()
  // Items received since the last clear, for the ring datasets' totals.
  private received = { fps: 0, runtimeErrors: 0, loadProfiles: 0, compilerWarnings: 0 }

  private hot: HotChannel | undefined
  private detachHot: (() => void) | undefined
  private leases = new Map<string, number>()
  private snapshotWaiters: Array<() => void> = []
  private active = false
  private sweepTimer: ReturnType<typeof setTimeout> | undefined
  private stateTimelineResolvers: Array<(changes: StateChange[]) => void> = []

  constructor(private readonly hooks: CollectorHooks = {}) {}

  /**
   * Subscribe to the runtime's hot-channel events. Re-attaching (dev server
   * restart) detaches the previous channel first so listeners never pile up.
   */
  attach(hot: HotChannel): void {
    this.detach()
    this.hot = hot
    const listeners: Array<[string, (payload: any, client: HotClient) => void]> = [
      [
        HOT_EVENTS.runtimeReady,
        (_, client) => client?.send(HOT_EVENTS.subscription, this.subscription),
      ],
      [HOT_EVENTS.components, (d, client) => this.ingestComponents(d, client)],
      [HOT_EVENTS.profiles, d => this.ingestProfiles(d)],
      [HOT_EVENTS.stateTimeline, d => this.ingestStateTimeline(d)],
      [HOT_EVENTS.fps, d => this.ingestFps(d)],
      [HOT_EVENTS.runtimeError, d => this.ingestRuntimeError(d)],
      [HOT_EVENTS.reactiveGraph, d => this.ingestReactiveGraph(d)],
      [HOT_EVENTS.reactiveSummary, d => this.ingestReactiveSummary(d)],
    ]
    for (const [event, listener] of listeners) hot.on(event, listener)
    this.detachHot = () => {
      for (const [event, listener] of listeners) hot.off?.(event, listener)
    }
  }

  detach(): void {
    clearTimeout(this.sweepTimer)
    this.sweepTimer = undefined
    this.detachHot?.()
    this.detachHot = undefined
    this.hot = undefined
    // Answer pending pulls from cache instead of leaving them to time out.
    this.flushPulls('no-runtime')
    this.flushStateTimeline()
  }

  /** What the runtime is told: collect/poll only while somebody is watching. */
  get subscription(): { active: boolean; componentDeltas: true } {
    // `componentDeltas` advertises that the delta form of `components` is
    // accepted (§6.5), so a runtime never sends deltas to an older server.
    return { active: this.active, componentDeltas: true }
  }

  /** Epochs we asked for a full snapshot (delta without a base); answered once per epoch. */
  private resyncRequested = new Set<string>()

  /** Components of the served epoch, parents first, capped at {@link LIMITS.liveComponents}. */
  get liveComponents(): ComponentInstance[] {
    if (!this.liveCache) {
      const state = this.servedState()
      this.liveCache = state ? [...state.components.values()] : []
    }
    return this.liveCache
  }

  /**
   * The served epoch's components with that epoch, read together, so a
   * component id is never paired with another page load's epoch (several app
   * tabs keep separate trees; nothing is merged).
   */
  get liveSnapshot(): {
    epoch: string | null
    total: number
    components: ComponentInstance[]
  } {
    const state = this.servedState()
    return {
      epoch: state ? (this.servedEpoch ?? null) : null,
      total: this.liveComponentsTotal,
      components: this.liveComponents,
    }
  }

  /** Instances the served epoch has mounted, including those beyond the cap. */
  get liveComponentsTotal(): number {
    const state = this.servedState()
    return state ? state.components.size + state.overflow.size : 0
  }

  get renderProfiles(): RenderProfile[] {
    return this.servedState()?.profiles ?? []
  }

  /** The epoch currently served and how many app page loads are tracked. */
  get epochInfo(): { epoch: string | undefined; epochs: number } {
    return { epoch: this.servedEpoch ?? [...this.epochs.keys()].at(-1), epochs: this.epochs.size }
  }

  private servedState(): EpochState | undefined {
    if (this.servedEpoch !== undefined) return this.epochs.get(this.servedEpoch)
    // No page load has sent a component snapshot yet: show the most recent
    // pusher (its profiles; its tree is empty either way).
    let newest: EpochState | undefined
    for (const state of this.epochs.values()) newest = state
    return newest
  }

  /**
   * Get (creating, LRU-bounded) the state for `epoch` and mark it as the most
   * recent pusher. It becomes the served epoch only once it holds a full
   * component snapshot — an epoch known only from profiles/timeline would
   * otherwise show an empty tree (review B1).
   */
  private touchEpoch(epoch: string): EpochState {
    let state = this.epochs.get(epoch)
    if (state) this.epochs.delete(epoch)
    else
      state = {
        components: new Map(),
        overflow: new Set(),
        hasBase: false,
        profiles: [],
        profilesTotal: null,
      }
    this.epochs.set(epoch, state) // re-insert: Map order = recency
    while (this.epochs.size > MAX_EPOCHS) {
      const evicted = this.epochs.keys().next().value!
      this.epochs.delete(evicted)
      this.resyncRequested.delete(evicted)
      this.dropEpoch(evicted)
      this.timelineDrops.delete(evicted)
      this.timelineTooLarge.delete(evicted)
      this.timelineBaseline.delete(evicted)
      if (this.servedEpoch === evicted) this.serve(this.newestBasedEpoch())
    }
    if (state.hasBase) this.serve(epoch)
    return state
  }

  private newestBasedEpoch(): string | undefined {
    let newest: string | undefined
    for (const [epoch, state] of this.epochs) if (state.hasBase) newest = epoch
    return newest
  }

  private serve(epoch: string | undefined): void {
    if (this.servedEpoch === epoch) return
    // Switching from another tab's data changes what both datasets serve.
    if (this.servedEpoch !== undefined) this.bump('components', 'renderProfiles')
    this.servedEpoch = epoch
    this.liveCache = undefined
  }

  /**
   * Mark `id` as watching for `ttl` ms (renewed by heartbeats). The first
   * lease activates the runtime's polling/FPS sampling, the last expiry or
   * release pauses it.
   */
  lease(id: string, ttl = LEASE_TTL): boolean {
    const wasActive = this.active
    this.leases.set(id, Date.now() + ttl)
    this.updateSubscription()
    return !wasActive && this.active
  }

  /**
   * Resolve once the runtime has sent its activation snapshot (components,
   * profiles, then a `reset: true` timeline — the last part) or after
   * `timeout`, so a consumer that just activated the runtime doesn't read
   * the stale pre-activation state.
   */
  waitForSnapshot(timeout: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        const idx = this.snapshotWaiters.indexOf(done)
        if (idx !== -1) this.snapshotWaiters.splice(idx, 1)
        resolve()
      }
      const timer = setTimeout(done, timeout)
      this.snapshotWaiters.push(done)
    })
  }

  release(id: string): void {
    if (this.leases.delete(id)) this.updateSubscription()
  }

  private updateSubscription(): void {
    const now = Date.now()
    let next = Infinity
    for (const [id, expiresAt] of this.leases) {
      if (expiresAt <= now) this.leases.delete(id)
      else next = Math.min(next, expiresAt)
    }
    const active = this.leases.size > 0
    if (active !== this.active) {
      this.active = active
      this.hot?.send(HOT_EVENTS.subscription, this.subscription)
    }
    clearTimeout(this.sweepTimer)
    this.sweepTimer = undefined
    if (next !== Infinity) {
      this.sweepTimer = setTimeout(() => this.updateSubscription(), next - now + 1)
      this.sweepTimer.unref?.()
    }
  }

  /**
   * Full form `{ epoch?, reset?, components }` replaces the epoch's tree;
   * delta form `{ epoch, added, removed }` (ids) patches it (§6.5). A delta
   * for an epoch we hold no full snapshot of (new to us, or evicted) is not
   * applied — a partial tree would persist — and the sender is asked to
   * resync. Entries stay in registration order (parents first); an instance
   * is stored only while its parent is and the cap allows, otherwise only its
   * id is tracked, so the stored part is always a rooted, orphan-free tree.
   */
  ingestComponents(
    data: { components?: unknown; epoch?: unknown; added?: unknown; removed?: unknown } | undefined,
    client?: HotClient,
  ): void {
    const epoch = typeof data?.epoch === 'string' ? data.epoch : LEGACY_EPOCH
    const isDelta =
      !Array.isArray(data?.components) &&
      (Array.isArray(data?.added) || Array.isArray(data?.removed))
    if (isDelta && !this.epochs.get(epoch)?.hasBase) {
      if (!this.resyncRequested.has(epoch)) {
        this.resyncRequested.add(epoch)
        client?.send(HOT_EVENTS.subscription, { ...this.subscription, resync: true })
      }
      return
    }
    const state = this.touchEpoch(epoch)
    if (!isDelta) {
      this.resyncRequested.delete(epoch)
      state.hasBase = true
      this.serve(epoch)
      state.components = new Map()
      state.overflow = new Set()
    }
    if (isDelta && Array.isArray(data?.removed)) {
      for (const id of data.removed as unknown[]) {
        if (!state.components.delete(id as number)) state.overflow.delete(id as number)
      }
    }
    const incoming = isDelta ? data?.added : data?.components
    if (Array.isArray(incoming)) {
      for (const c of incoming as ComponentInstance[]) {
        const id = c?.id
        if (state.components.has(id)) {
          state.components.set(id, c)
          continue
        }
        const parentStored = c?.parentId == null || state.components.has(c.parentId)
        if (parentStored && state.components.size < LIMITS.liveComponents) {
          state.overflow.delete(id)
          state.components.set(id, c)
        } else {
          state.overflow.add(id)
        }
      }
    }
    this.liveCache = undefined
    this.bump('components')
  }

  ingestProfiles(data: { profiles?: unknown; epoch?: unknown; total?: unknown } | undefined): void {
    const epoch = typeof data?.epoch === 'string' ? data.epoch : LEGACY_EPOCH
    const state = this.touchEpoch(epoch)
    state.profiles = tail(data?.profiles, LIMITS.renderProfiles)
    state.profilesTotal =
      typeof data?.total === 'number' && Number.isFinite(data.total) ? data.total : null
    this.bump('renderProfiles')
  }

  /**
   * What the server holds versus what was reported, per dataset (§6.7 B).
   * `total: null` means unknown; nothing is estimated.
   */
  getCaptureInfo(): CaptureInfoMap {
    const state = this.servedState()
    const epoch = this.servedEpoch
    const ring = (captured: number, received: number): CaptureInfo => ({
      captured,
      total: received,
      truncated: received > captured,
      policy: 'tail',
    })
    const drops: Record<DropReason, number> = {
      'runtime-count': 0,
      'runtime-bytes': 0,
      'server-count': 0,
      'server-bytes': 0,
    }
    for (const counts of this.timelineDrops.values()) {
      for (const reason of DROP_REASONS) drops[reason] += counts[reason]
    }
    const dropped = DROP_REASONS.filter(r => drops[r] > 0).map(reason => ({
      reason,
      count: drops[reason],
    }))
    let tooLarge = 0
    for (const n of this.timelineTooLarge.values()) tooLarge += n
    const profiles = state?.profiles.length ?? 0
    const profilesTotal = state?.profilesTotal ?? null
    const graph = this.lastGraph
    const info: CaptureInfoMap = {
      liveComponents: {
        captured: state?.components.size ?? 0,
        total: this.liveComponentsTotal,
        truncated: (state?.overflow.size ?? 0) > 0,
        policy: 'roots-first',
        ...(epoch !== undefined && { epoch }),
      },
      renderProfiles: {
        captured: profiles,
        total: profilesTotal,
        truncated: profilesTotal !== null && profilesTotal > profiles,
        // The runtime keeps first-render order and sends the tail: the newest-mounted instances (review IA1).
        policy: 'newest-mounted',
        ...(epoch !== undefined && { epoch }),
      },
      stateTimeline: {
        captured: this.timeline.length,
        total: null,
        truncated: dropped.length > 0,
        policy: 'sampled-200ms',
        ...(dropped.length > 0 && { dropped }),
        ...(tooLarge > 0 && { valueTooLarge: tooLarge }),
        ...(epoch !== undefined &&
          this.timelineBaseline.has(epoch) && { baseline: this.timelineBaseline.get(epoch) }),
      },
      fpsSamples: ring(this.fpsSamples.length, this.received.fps),
      runtimeErrors: ring(this.runtimeErrors.length, this.received.runtimeErrors),
      loadProfiles: ring(this.loadProfiles.length, this.received.loadProfiles),
      compilerWarnings: ring(this.compilerWarnings.length, this.received.compilerWarnings),
    }
    if (graph) {
      const common = {
        truncated: graph.truncated,
        policy: graph.policy,
        ...(graph.epoch !== null && { epoch: graph.epoch }),
      }
      info.reactiveNodes = {
        captured: graph.nodes.length,
        total: graph.total?.nodes ?? null,
        ...common,
      }
      info.reactiveEdges = {
        captured: graph.edges.length,
        total: graph.total?.edges ?? null,
        ...common,
      }
    }
    return info
  }

  /** The server-side timeline (all tracked epochs, oldest first). */
  get stateTimeline(): StateTimelineEntry[] {
    return this.timeline
  }

  /**
   * Two payload shapes (docs/devframe-migration.md §6.4):
   * - delta: `{ epoch, changes, reset? }` — `changes` are new since the
   *   previous push from that page load (`epoch`); `reset` replaces that
   *   epoch's entries. Entries are kept per epoch, so several app tabs (or a
   *   reload) interleave instead of wiping each other.
   * - legacy full snapshot: `{ changes }` — we append only the entries after
   *   the newest one we already hold, so clients still get deltas.
   */
  ingestStateTimeline(
    data:
      | {
          changes?: unknown
          epoch?: unknown
          reset?: unknown
          dropped?: unknown
          valueTooLarge?: unknown
          baseline?: unknown
        }
      | undefined,
  ): void {
    const incoming = tail<StateChange>(data?.changes, LIMITS.stateTimeline)
    if (typeof data?.epoch === 'string') {
      this.touchEpoch(data.epoch)
      this.countRuntimeLosses(data.epoch, data.dropped, data.valueTooLarge)
      if (data.reset === true) this.dropEpoch(data.epoch)
      this.appendTimeline(incoming, data.epoch)
      if (validBaseline(data.baseline))
        this.timelineBaseline.set(data.epoch, {
          complete: data.baseline.complete,
          pendingNodes: data.baseline.pendingNodes,
        })
    } else {
      let last: StateTimelineEntry | undefined
      for (let i = this.timeline.length - 1; i >= 0 && !last; i--) {
        if (this.timelineEpochs[i] === LEGACY_EPOCH) last = this.timeline[i]
      }
      let start = -1
      if (last) {
        for (let i = incoming.length - 1; i >= 0; i--) {
          if (incoming[i].timestamp === last.timestamp && incoming[i].id === last.id) {
            start = i + 1
            break
          }
        }
      }
      if (start === -1) {
        this.dropEpoch(LEGACY_EPOCH)
        start = 0
      }
      this.appendTimeline(incoming.slice(start), LEGACY_EPOCH)
    }
    this.lastPull.stateTimeline = Date.now()
    this.flushStateTimeline()
    // The runtime's activation snapshot ends with a `reset: true` timeline
    // (after components and profiles), so that completes a snapshot (D4).
    if (data?.reset === true) this.resolveSnapshotWaiters()
  }

  /**
   * Add the runtime's own losses (unsent entries it evicted, §6.7 C) and
   * too-large values to the epoch's counters. Only runtime reasons are
   * accepted from the runtime; server reasons are counted here.
   */
  private countRuntimeLosses(epoch: string, dropped: unknown, valueTooLarge: unknown): void {
    if (Array.isArray(dropped)) {
      for (const d of dropped as Array<{ reason?: unknown; count?: unknown }>) {
        if (d?.reason !== 'runtime-count' && d?.reason !== 'runtime-bytes') continue
        const count = clampInt(d.count, 0, Number.MAX_SAFE_INTEGER, 0)
        if (count > 0) this.addDrop(epoch, d.reason, count)
      }
    }
    const tooLarge = clampInt(valueTooLarge, 0, Number.MAX_SAFE_INTEGER, 0)
    if (tooLarge > 0) {
      this.timelineTooLarge.set(epoch, (this.timelineTooLarge.get(epoch) ?? 0) + tooLarge)
    }
  }

  private addDrop(epoch: string, reason: DropReason, count: number): void {
    let counts = this.timelineDrops.get(epoch)
    if (!counts) {
      counts = { 'runtime-count': 0, 'runtime-bytes': 0, 'server-count': 0, 'server-bytes': 0 }
      this.timelineDrops.set(epoch, counts)
    }
    counts[reason] += count
  }

  /** Changes after `since` (a previous `cursor`), or the whole buffer when the cursor is stale. */
  getStateTimelineDelta(since?: number): StateTimelineDelta {
    const cursor = this.timelineSeq
    if (
      since === undefined ||
      since < this.timelineResetAt ||
      since < this.timelineTrimmedAt ||
      since > cursor
    ) {
      return { cursor, reset: true, changes: this.timeline }
    }
    let i = this.timeline.length
    while (i > 0 && this.timeline[i - 1].seq > since) i--
    return { cursor, reset: false, changes: this.timeline.slice(i) }
  }

  /** Invalidate every cursor issued so far (entries were removed, not just appended). */
  private markTimelineReset(): void {
    this.timelineResetAt = this.timelineSeq = nextSeq()
    this.bump('stateTimeline')
  }

  private dropEpoch(epoch: string): void {
    if (!this.timelineEpochs.includes(epoch)) return
    const keep = this.timelineEpochs.map(e => e !== epoch)
    this.timeline = this.timeline.filter((_, i) => keep[i])
    this.timelineSizes = this.timelineSizes.filter((_, i) => keep[i])
    this.timelineEpochs = this.timelineEpochs.filter((_, i) => keep[i])
    this.timelineBytes = this.timelineSizes.reduce((a, b) => a + b, 0)
    this.markTimelineReset()
  }

  private appendTimeline(changes: StateChange[], epoch: string): void {
    if (changes.length === 0) return
    for (const change of changes) {
      let size = 0
      try {
        size = JSON.stringify(change).length
      } catch {
        continue // not serializable: never reaches a client anyway
      }
      this.timeline.push({ ...change, seq: (this.timelineSeq = nextSeq()) })
      this.timelineSizes.push(size)
      this.timelineEpochs.push(epoch)
      this.timelineBytes += size
    }
    let drop = Math.max(0, this.timeline.length - LIMITS.stateTimeline)
    let bytes = this.timelineBytes
    for (let i = 0; i < drop; i++) {
      bytes -= this.timelineSizes[i]
      this.addDrop(this.timelineEpochs[i], 'server-count', 1)
    }
    // Keep at least the newest entry even if it alone exceeds the budget.
    while (bytes > STATE_TIMELINE_BYTES && drop < this.timeline.length - 1) {
      this.addDrop(this.timelineEpochs[drop], 'server-bytes', 1)
      bytes -= this.timelineSizes[drop++]
    }
    if (drop > 0) {
      this.timelineTrimmedAt = this.timeline[drop - 1].seq
      this.timeline = this.timeline.slice(drop)
      this.timelineSizes = this.timelineSizes.slice(drop)
      this.timelineEpochs = this.timelineEpochs.slice(drop)
    }
    this.timelineBytes = bytes
    this.bump('stateTimeline')
  }

  private resolveSnapshotWaiters(): void {
    // Copy: each waiter removes itself from the list while we iterate.
    for (const done of this.snapshotWaiters.slice()) done()
  }

  /**
   * A graph reply. With a `requestId` (§6.7 A) it resolves only that request,
   * and only if its epoch matches the one asked for; a reply nobody waits for
   * (another app tab, too late) is ignored. Without one (an older runtime) it
   * is a whole-app graph and answers every pending graph pull, scoped ones by
   * filtering here.
   */
  ingestReactiveGraph(data: Record<string, any> | undefined): void {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined
    if (requestId !== undefined) {
      const pull = this.pulls.get(requestId)
      if (!pull || pull.kind !== 'graph') return
      if (pull.epoch !== null && typeof data?.epoch === 'string' && data.epoch !== pull.epoch)
        return
      this.settle(requestId, this.normalizeGraph(data, pull.scope, pull.epoch))
    } else {
      let answered = false
      for (const [id, pull] of this.pulls) {
        if (pull.kind !== 'graph') continue
        answered = true
        this.settle(id, this.normalizeGraph(data, pull.scope, pull.epoch))
      }
      if (!answered) this.storeGraph(this.normalizeGraph(data, null, this.servedEpoch ?? null))
    }
    this.bump('reactiveGraph')
  }

  /**
   * Shape a runtime reply into a {@link ReactiveGraphResult}: apply the
   * collector caps (nodes, then only edges between kept nodes, then the edge
   * cap) and report what was left out. Totals come from the runtime; an older
   * runtime's are the counts it sent (`nodesKind: 'sent'`), or unknown when
   * the server had to scope its whole-app graph.
   */
  private normalizeGraph(
    data: Record<string, any> | undefined,
    scope: number | null,
    epoch: string | null,
  ): ReactiveGraphResult {
    const legacy = typeof data?.requestId !== 'string'
    let nodes = head<ReactiveGraph['nodes'][number]>(data?.nodes, Infinity)
    const rawEdges = head<ReactiveGraph['edges'][number]>(data?.edges, Infinity)
    let policy: ReactiveGraphResult['policy'] =
      data?.policy === 'scoped' || data?.policy === 'global-head'
        ? data.policy
        : scope === null
          ? 'global-head'
          : 'scoped'
    let total: ReactiveGraphTotal | null = null
    if (!legacy && data?.total && typeof data.total.nodes === 'number') {
      total = {
        nodes: data.total.nodes,
        nodesKind: 'registered',
        edges: typeof data.total.edges === 'number' ? data.total.edges : null,
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
    if (nodes.length > LIMITS.reactiveNodes) {
      nodes = nodes.slice(0, LIMITS.reactiveNodes)
      truncated = true
    }
    const ids = new Set(nodes.map(n => n?.id))
    let edgesOmitted = clampInt(data?.edgesOmitted, 0, Number.MAX_SAFE_INTEGER, 0)
    const edges: ReactiveGraph['edges'] = []
    for (const e of rawEdges) {
      if (!ids.has(e?.from) || !ids.has(e?.to)) {
        if (policy !== 'server-filter') edgesOmitted++
      } else if (edges.length < LIMITS.reactiveEdges) {
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
      computedAt:
        typeof data?.computedAt === 'number' && Number.isFinite(data.computedAt)
          ? data.computedAt
          : null,
      policy,
    }
  }

  private storeGraph(result: ReactiveGraphResult): void {
    this.lastGraph = result
    if (result.scope === null) this.reactiveGraph = { nodes: result.nodes, edges: result.edges }
  }

  /** A summary reply (§6.7 I): resolves only the matching request. */
  ingestReactiveSummary(data: Record<string, any> | undefined): void {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined
    const pull = requestId === undefined ? undefined : this.pulls.get(requestId)
    if (!pull || pull.kind !== 'summary') return
    if (pull.epoch !== null && typeof data?.epoch === 'string' && data.epoch !== pull.epoch) return
    this.settle(requestId!, this.normalizeSummary(data, pull.epoch))
  }

  private normalizeSummary(
    data: Record<string, any> | undefined,
    epoch: string | null,
  ): ReactiveSummary {
    const count = (v: unknown) => clampInt(v, 0, Number.MAX_SAFE_INTEGER, 0)
    const rows = head<Record<string, any>>(data?.rows, SUMMARY_DEFAULTS.maxTopK).map(r => ({
      componentId: count(r?.componentId),
      file: typeof r?.file === 'string' ? r.file : '',
      nodes: {
        state: count(r?.nodes?.state),
        derived: count(r?.nodes?.derived),
        effect: count(r?.nodes?.effect),
      },
      changes: count(r?.changes),
      renders: count(r?.renders),
      renderMs: typeof r?.renderMs === 'number' && r.renderMs >= 0 ? r.renderMs : 0,
      ...(r?.kind === 'module' && { kind: 'module' as const }),
    }))
    const w = data?.window
    return {
      epoch: typeof data?.epoch === 'string' ? data.epoch : epoch,
      window: {
        ms: count(w?.ms),
        since: count(w?.since),
        until: count(w?.until),
        sampledActiveMs: count(w?.sampledActiveMs),
      },
      policy: 'sampled-200ms',
      coverage: 'component-init',
      components: {
        total: typeof data?.components?.total === 'number' ? data.components.total : null,
        withActivity: count(data?.components?.withActivity),
      },
      rows,
      other:
        data?.other &&
        typeof data.other.components === 'number' &&
        typeof data.other.nodes === 'number'
          ? { components: data.other.components, nodes: data.other.nodes }
          : null,
      truncated: data?.truncated === true,
      // Only what the runtime says it implements; never assumed.
      capabilities: {
        valueInspection: data?.capabilities?.valueInspection === true,
        signalHistory: data?.capabilities?.signalHistory === true,
        writeCause: data?.capabilities?.writeCause === true,
      },
      ...(validBaseline(data?.baseline) && { baseline: { ...data!.baseline } }),
    }
  }

  ingestFps(sample: FpsSample): void {
    this.received.fps++
    this.fpsSamples.push(sample)
    if (this.fpsSamples.length > LIMITS.fpsSamples) {
      this.fpsSamples = this.fpsSamples.slice(-LIMITS.fpsSamples)
    }
    this.bump('fps')
    this.hooks.onFpsSample?.(sample)
  }

  ingestRuntimeError(error: RuntimeError): void {
    this.received.runtimeErrors++
    this.runtimeErrors.push(error)
    if (this.runtimeErrors.length > LIMITS.runtimeErrors) {
      this.runtimeErrors = this.runtimeErrors.slice(-LIMITS.runtimeErrors)
    }
    this.bump('errors')
  }

  recordLoadProfile(profile: LoadProfile): void {
    this.received.loadProfiles++
    this.loadProfiles.push(profile)
    if (this.loadProfiles.length > LIMITS.loadProfiles) {
      this.loadProfiles = this.loadProfiles.slice(-LIMITS.loadProfiles)
    }
    this.bump('loadProfiles')
    this.hooks.onLoadProfile?.(profile)
  }

  recordCompilerWarning(warning: CompilerWarning): void {
    this.received.compilerWarnings++
    this.compilerWarnings.push(warning)
    if (this.compilerWarnings.length > LIMITS.compilerWarnings) {
      this.compilerWarnings = this.compilerWarnings.slice(-LIMITS.compilerWarnings)
    }
    this.bump('errors')
  }

  clearLoadProfiles(): void {
    this.loadProfiles = []
    this.received.loadProfiles = 0
    this.bump('loadProfiles')
  }

  clearErrors(): void {
    this.compilerWarnings = []
    this.runtimeErrors = []
    this.received.compilerWarnings = 0
    this.received.runtimeErrors = 0
    this.bump('errors')
  }

  clearFps(): void {
    this.fpsSamples = []
    this.received.fps = 0
    this.bump('fps')
  }

  clearStateTimeline(): void {
    this.timeline = []
    this.timelineSizes = []
    this.timelineEpochs = []
    this.timelineBytes = 0
    this.timelineDrops.clear()
    this.timelineTooLarge.clear()
    this.markTimelineReset()
    this.hot?.send(HOT_EVENTS.clearStateTimeline, {})
  }

  /**
   * Ask the browser runtime for the graph of one component instance (or the
   * whole app), built by the runtime within the caps (§6.7 A). Falls back to
   * the last result for the same scope, marked `stale`.
   */
  requestReactiveGraph(req: ReactiveGraphRequest = {}): Promise<ReactiveGraphResult> {
    const scope =
      typeof req.componentId === 'number' &&
      Number.isInteger(req.componentId) &&
      req.componentId >= 0
        ? req.componentId
        : null
    const maxNodes = clampInt(req.maxNodes, 1, LIMITS.reactiveNodes, LIMITS.reactiveNodes)
    const maxEdges = clampInt(req.maxEdges, 1, LIMITS.reactiveEdges, LIMITS.reactiveEdges)
    const epoch = this.servedEpoch ?? null
    if (scope !== null && epoch === null) {
      // No page load has sent its tree: a component id means nothing yet, and
      // asking every tab would let any of them answer for it (review MUST-1).
      return Promise.resolve({
        nodes: [],
        edges: [],
        scope,
        epoch,
        total: null,
        truncated: false,
        edgesOmitted: 0,
        computedAt: null,
        policy: 'scoped',
        stale: true,
        staleReason: 'no-runtime',
      })
    }
    if (scope !== null && typeof req.epoch === 'string' && req.epoch !== epoch) {
      // The id belongs to an earlier page load; another instance may reuse it now.
      return Promise.resolve({
        nodes: [],
        edges: [],
        scope,
        epoch,
        total: null,
        truncated: false,
        edgesOmitted: 0,
        computedAt: null,
        policy: 'scoped',
        stale: true,
        staleReason: 'epoch-changed',
      })
    }
    const key = `graph|${epoch ?? ''}|${scope ?? '*'}|${maxNodes}|${maxEdges}`
    return this.keyedPull<ReactiveGraphResult>(
      'graph',
      key,
      epoch,
      scope,
      HOT_EVENTS.requestReactiveGraph,
      { ...(scope !== null && { componentId: scope }), maxNodes, maxEdges },
      reason => ({
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
      }),
    )
  }

  /** Ask the runtime for the overview aggregate (§6.7 I); never captures the graph. */
  requestReactiveSummary(req: ReactiveSummaryRequest = {}): Promise<ReactiveSummary> {
    const topK = clampInt(req.topK, 1, SUMMARY_DEFAULTS.maxTopK, SUMMARY_DEFAULTS.topK)
    const windowMs = clampInt(
      req.windowMs,
      SUMMARY_DEFAULTS.minWindowMs,
      SUMMARY_DEFAULTS.maxWindowMs,
      SUMMARY_DEFAULTS.windowMs,
    )
    const epoch = this.servedEpoch ?? null
    const key = `summary|${epoch ?? ''}|${topK}|${windowMs}`
    return this.keyedPull<ReactiveSummary>(
      'summary',
      key,
      epoch,
      null,
      HOT_EVENTS.requestReactiveSummary,
      { topK, windowMs },
      reason => ({
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
      }),
    )
  }

  /**
   * One pull per key at a time; a result younger than {@link PULL_FRESHNESS}
   * is reused. The request carries a requestId and the served epoch; only
   * the matching reply resolves it. On timeout (or without a runtime) the
   * last result for the same key is returned with `stale: true`.
   */
  private keyedPull<T extends ReactiveGraphResult | ReactiveSummary>(
    kind: PendingPull['kind'],
    key: string,
    epoch: string | null,
    scope: number | null,
    event: string,
    payload: Record<string, unknown>,
    empty: (reason: 'timeout' | 'no-runtime') => T,
  ): Promise<T> {
    const fallback = (reason: 'timeout' | 'no-runtime'): T => {
      const last = this.pullCache.get(key)
      return last ? ({ ...last.value, stale: true, staleReason: reason } as T) : empty(reason)
    }
    const cached = this.pullCache.get(key)
    if (!this.hot) return Promise.resolve(fallback('no-runtime'))
    if (cached && Date.now() - cached.at < PULL_FRESHNESS) return Promise.resolve(cached.value as T)
    const existing = this.pullInflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const hot = this.hot
    const requestId = `r${++this.requestSeq}`
    const promise = new Promise<T>(resolve => {
      const timer = setTimeout(() => {
        this.pulls.delete(requestId)
        resolve(fallback('timeout'))
      }, RUNTIME_REQUEST_TIMEOUT)
      this.pulls.set(requestId, {
        kind,
        key,
        epoch,
        scope,
        resolve: resolve as PendingPull['resolve'],
        timer,
      })
      hot.send(event, { requestId, ...(epoch !== null && { epoch }), ...payload })
    }).finally(() => {
      if (this.pullInflight.get(key) === promise) this.pullInflight.delete(key)
    })
    this.pullInflight.set(key, promise)
    return promise
  }

  /** Resolve a pending pull with a fresh result and cache it under its key. */
  private settle(requestId: string, value: ReactiveGraphResult | ReactiveSummary): void {
    const pull = this.pulls.get(requestId)
    if (!pull) return
    this.pulls.delete(requestId)
    clearTimeout(pull.timer)
    this.pullCache.delete(pull.key)
    this.pullCache.set(pull.key, { value, at: Date.now() })
    while (this.pullCache.size > MAX_CACHED_PULLS) {
      this.pullCache.delete(this.pullCache.keys().next().value!)
    }
    if (pull.kind === 'graph') this.storeGraph(value as ReactiveGraphResult)
    pull.resolve(value)
  }

  /** Answer every pending keyed pull from its cache (or empty), marked stale. */
  private flushPulls(reason: 'timeout' | 'no-runtime'): void {
    for (const [id, pull] of this.pulls) {
      this.pulls.delete(id)
      clearTimeout(pull.timer)
      const cached = this.pullCache.get(pull.key)
      if (cached) {
        pull.resolve({ ...cached.value, stale: true, staleReason: reason })
      } else if (pull.kind === 'graph') {
        pull.resolve({
          nodes: [],
          edges: [],
          scope: pull.scope,
          epoch: pull.epoch,
          total: null,
          truncated: false,
          edgesOmitted: 0,
          computedAt: null,
          policy: pull.scope === null ? 'global-head' : 'scoped',
          stale: true,
          staleReason: reason,
        })
      } else {
        pull.resolve({
          epoch: pull.epoch,
          window: { ms: 0, since: 0, until: 0, sampledActiveMs: 0 },
          policy: 'sampled-200ms',
          coverage: 'component-init',
          components: { total: null, withActivity: 0 },
          rows: [],
          other: null,
          truncated: false,
          capabilities: { valueInspection: false, signalHistory: false, writeCause: false },
          stale: true,
          staleReason: reason,
        })
      }
    }
  }

  /** Ask the browser runtime for a fresh state timeline; falls back to the last one. */
  requestStateTimeline(): Promise<StateChange[]> {
    return this.pull(
      'stateTimeline',
      HOT_EVENTS.requestStateTimeline,
      this.stateTimelineResolvers,
      () => this.stateTimeline,
    )
  }

  /**
   * Concurrent callers share one in-flight pull, and a result younger than
   * {@link PULL_FRESHNESS} is reused, so several polling clients never make
   * the user's app rebuild the same data more than once a second.
   */
  private pull<K extends 'stateTimeline', T>(
    key: K,
    event: string,
    resolvers: Array<(value: T) => void>,
    cached: () => T,
  ): Promise<T> {
    if (!this.hot || Date.now() - this.lastPull[key] < PULL_FRESHNESS) {
      return Promise.resolve(cached())
    }
    const existing = this.inflight[key] as Promise<T> | undefined
    if (existing) return existing
    const hot = this.hot
    const promise = new Promise<T>(resolve => {
      const resolver = (value: T) => {
        clearTimeout(timeout)
        resolve(value)
      }
      const timeout = setTimeout(() => {
        // Remove this resolver to prevent a leak, then answer from cache.
        const idx = resolvers.indexOf(resolver)
        if (idx !== -1) resolvers.splice(idx, 1)
        resolve(cached())
      }, RUNTIME_REQUEST_TIMEOUT)
      resolvers.push(resolver)
      hot.send(event, {})
    }).finally(() => {
      if (this.inflight[key] === promise) this.inflight[key] = undefined
    })
    this.inflight[key] = promise as never
    return promise
  }

  // Snapshot then reset before resolving so concurrent requests that push
  // during the resolve loop are not silently dropped.
  private flushStateTimeline(): void {
    const pending = this.stateTimelineResolvers
    this.stateTimelineResolvers = []
    for (const resolve of pending) resolve(this.stateTimeline)
  }
}
