import type {
  CaptureInfoMap,
  CompilerWarning,
  ComponentInstance,
  FpsSample,
  LoadProfile,
  ReactiveGraphRequest,
  ReactiveGraphResult,
  ReactiveSummary,
  ReactiveSummaryRequest,
  RenderProfile,
  RuntimeError,
  StateChange,
  StateTimelineDelta,
  StateTimelineEntry,
  DatasetVersions,
} from '../types.js'
import { arrayOf, asPayload, clampInt, finiteOrNull } from './payload.js'
import type { Payload } from './payload.js'
import {
  emptyGraph,
  emptySummary,
  GRAPH_LIMITS,
  normalizeGraph,
  normalizeSummary,
  SUMMARY_DEFAULTS,
} from './reactive.js'
import { Ring } from './ring.js'
import { LEGACY_EPOCH, nextSeq, STATE_TIMELINE_LIMIT, StateTimeline } from './state-timeline.js'
import type { TimelinePush } from './state-timeline.js'

export { STATE_TIMELINE_BYTES } from './state-timeline.js'

// Defensive caps on runtime-supplied data: even though the runtime already
// trims its own buffers, an out-of-spec or compromised runtime could hand us
// unbounded payloads and inflate dev-server memory.
export const LIMITS = {
  liveComponents: 50000,
  renderProfiles: 5000,
  stateTimeline: STATE_TIMELINE_LIMIT,
  reactiveNodes: GRAPH_LIMITS.nodes,
  reactiveEdges: GRAPH_LIMITS.edges,
  fpsSamples: 1200,
  runtimeErrors: 200,
  loadProfiles: 200,
  compilerWarnings: 500,
} as const

/** How long a pull request to the browser runtime may take before we answer from cache. */
export const RUNTIME_REQUEST_TIMEOUT = 1000

/** A pull answered within this window is reused instead of asking the runtime again. */
export const PULL_FRESHNESS = 1000

/** A consumer (DevTools UI tab, MCP agent) counts as watching until its lease expires. */
export const LEASE_TTL = 15_000

/** App page loads (tabs / reloads) whose component tree + profiles are kept, LRU. */
export const MAX_EPOCHS = 4

/** Keyed pull results kept for reuse / stale fallback (graph scopes, summaries), LRU. */
const MAX_CACHED_PULLS = 32

type DatasetKey = keyof DatasetVersions

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

type PullResult = ReactiveGraphResult | ReactiveSummary

/** A pull request waiting for the runtime's reply, matched by `requestId` (§6.7 A, M1). */
interface PendingPull {
  kind: 'graph' | 'summary'
  key: string
  epoch: string | null
  scope: number | null
  resolve: (value: PullResult) => void
  /** The answer when the runtime does not reply: the last result for `key`, or empty. */
  fallback: (reason: 'timeout' | 'no-runtime') => PullResult
  timer: ReturnType<typeof setTimeout>
}

export interface HotClient {
  send(event: string, payload: unknown): void
}

export interface HotChannel {
  send(event: string, payload: unknown): void
  on(event: string, listener: (payload: unknown, client: HotClient) => void): void
  off?(event: string, listener: (payload: unknown, client: HotClient) => void): void
}

export interface CollectorHooks {
  onFpsSample?: (sample: FpsSample) => void
  onLoadProfile?: (profile: LoadProfile) => void
}

const epochOf = (data: Payload | undefined) =>
  typeof data?.epoch === 'string' ? data.epoch : LEGACY_EPOCH

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
  /** Epochs we asked for a full snapshot (delta without a base); answered once per epoch. */
  private resyncRequested = new Set<string>()

  private readonly fps = new Ring<FpsSample>(LIMITS.fpsSamples)
  private readonly errors = new Ring<RuntimeError>(LIMITS.runtimeErrors)
  private readonly loads = new Ring<LoadProfile>(LIMITS.loadProfiles)
  private readonly warnings = new Ring<CompilerWarning>(LIMITS.compilerWarnings)
  private readonly timeline = new StateTimeline(() => this.bump('stateTimeline'))

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

  // Keyed pulls (graph scopes, summaries; §6.7 A/I): each request carries a
  // requestId + the served epoch, and only the matching reply resolves it, so
  // one viewer never receives another viewer's scope (review G5, M1).
  private pulls = new Map<string, PendingPull>()
  private pullCache = new Map<string, { value: PullResult; at: number }>()
  private pullInflight = new Map<string, Promise<PullResult>>()
  private requestSeq = 0
  /** The most recent graph reply, for capture info. */
  private lastGraph: ReactiveGraphResult | undefined

  private lastTimelinePull = 0
  private timelineInflight: Promise<StateChange[]> | undefined
  private timelineResolvers: Array<(changes: StateChange[]) => void> = []

  private hot: HotChannel | undefined
  private detachHot: (() => void) | undefined
  private leases = new Map<string, number>()
  private snapshotWaiters: Array<() => void> = []
  private active = false
  private sweepTimer: ReturnType<typeof setTimeout> | undefined

  private readonly hooks: CollectorHooks
  constructor(hooks: CollectorHooks = {}) {
    this.hooks = hooks
  }

  private bump(...keys: DatasetKey[]): void {
    for (const key of keys) this.versions[key] = nextSeq()
  }

  /**
   * Subscribe to the runtime's hot-channel events. Re-attaching (dev server
   * restart) detaches the previous channel first so listeners never pile up.
   */
  attach(hot: HotChannel): void {
    this.detach()
    this.hot = hot
    // Payloads come from the user's app: anything not shaped like the event's
    // message is treated as empty (or, for single records, dropped).
    const listeners: Array<[string, (payload: unknown, client: HotClient) => void]> = [
      [
        HOT_EVENTS.runtimeReady,
        (_, client) => client?.send(HOT_EVENTS.subscription, this.subscription),
      ],
      [HOT_EVENTS.components, (d, client) => this.ingestComponents(asPayload(d), client)],
      [HOT_EVENTS.profiles, d => this.ingestProfiles(asPayload(d))],
      [HOT_EVENTS.stateTimeline, d => this.ingestStateTimeline(asPayload(d))],
      [
        HOT_EVENTS.fps,
        d => {
          const v = asPayload(d)
          if (typeof v?.timestamp === 'number' && typeof v.fps === 'number') {
            this.ingestFps(v as unknown as FpsSample)
          }
        },
      ],
      [
        HOT_EVENTS.runtimeError,
        d => {
          const v = asPayload(d)
          if (typeof v?.message === 'string') this.ingestRuntimeError(v as unknown as RuntimeError)
        },
      ],
      [HOT_EVENTS.reactiveGraph, d => this.ingestReactiveGraph(asPayload(d))],
      [HOT_EVENTS.reactiveSummary, d => this.ingestReactiveSummary(asPayload(d))],
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
    for (const id of this.pulls.keys()) this.settle(id, 'no-runtime')
    this.flushStateTimeline()
  }

  /** What the runtime is told: collect/poll only while somebody is watching. */
  get subscription(): { active: boolean; componentDeltas: true } {
    // `componentDeltas` advertises that the delta form of `components` is
    // accepted (§6.5), so a runtime never sends deltas to an older server.
    return { active: this.active, componentDeltas: true }
  }

  // --- datasets ---

  get fpsSamples(): FpsSample[] {
    return this.fps.items
  }

  get runtimeErrors(): RuntimeError[] {
    return this.errors.items
  }

  get loadProfiles(): LoadProfile[] {
    return this.loads.items
  }

  get compilerWarnings(): CompilerWarning[] {
    return this.warnings.items
  }

  /** The server-side timeline (all tracked epochs, oldest first). */
  get stateTimeline(): StateTimelineEntry[] {
    return this.timeline.entries
  }

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

  // --- epochs ---

  private servedState(): EpochState | undefined {
    if (this.servedEpoch !== undefined) return this.epochs.get(this.servedEpoch)
    // No page load has sent a component snapshot yet: show the most recent
    // pusher (its profiles; its tree is empty either way).
    return [...this.epochs.values()].at(-1)
  }

  /**
   * Get (creating, LRU-bounded) the state for `epoch` and mark it as the most
   * recent pusher. It becomes the served epoch only once it holds a full
   * component snapshot — an epoch known only from profiles/timeline would
   * otherwise show an empty tree (review B1).
   */
  private touchEpoch(epoch: string): EpochState {
    const state = this.epochs.get(epoch) ?? {
      components: new Map(),
      overflow: new Set(),
      hasBase: false,
      profiles: [],
      profilesTotal: null,
    }
    this.epochs.delete(epoch)
    this.epochs.set(epoch, state) // re-insert: Map order = recency
    while (this.epochs.size > MAX_EPOCHS) {
      const evicted = this.epochs.keys().next().value!
      this.epochs.delete(evicted)
      this.resyncRequested.delete(evicted)
      this.timeline.forget(evicted)
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

  // --- consumers ---

  /**
   * Mark `id` as watching for `ttl` ms (renewed by heartbeats). The first
   * lease activates the runtime's polling/FPS sampling, the last expiry or
   * release pauses it. Returns whether this call activated it.
   */
  lease(id: string, ttl = LEASE_TTL): boolean {
    const wasActive = this.active
    this.leases.set(id, Date.now() + ttl)
    this.updateSubscription()
    return !wasActive && this.active
  }

  release(id: string): void {
    if (this.leases.delete(id)) this.updateSubscription()
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

  // --- ingest ---

  /**
   * Full form `{ epoch?, reset?, components }` replaces the epoch's tree;
   * delta form `{ epoch, added, removed }` (ids) patches it (§6.5). A delta
   * for an epoch we hold no full snapshot of (new to us, or evicted) is not
   * applied — a partial tree would persist — and the sender is asked to
   * resync. Entries stay in registration order (parents first); an instance
   * is stored only while its parent is and the cap allows, otherwise only its
   * id is tracked, so the stored part is always a rooted, orphan-free tree.
   * Entries that are not objects with a numeric `id` are ignored.
   */
  ingestComponents(data: Payload | undefined, client?: HotClient): void {
    const epoch = epochOf(data)
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
    if (isDelta) {
      for (const id of arrayOf<number>(data?.removed)) {
        if (!state.components.delete(id)) state.overflow.delete(id)
      }
    } else {
      this.resyncRequested.delete(epoch)
      state.hasBase = true
      this.serve(epoch)
      state.components = new Map()
      state.overflow = new Set()
    }
    for (const c of arrayOf<ComponentInstance>(isDelta ? data?.added : data?.components)) {
      if (typeof c?.id !== 'number') continue
      if (state.components.has(c.id)) {
        state.components.set(c.id, c)
        continue
      }
      const parentStored =
        c.parentId === null || c.parentId === undefined || state.components.has(c.parentId)
      if (parentStored && state.components.size < LIMITS.liveComponents) {
        state.overflow.delete(c.id)
        state.components.set(c.id, c)
      } else {
        state.overflow.add(c.id)
      }
    }
    this.liveCache = undefined
    this.bump('components')
  }

  ingestProfiles(data?: Payload): void {
    const state = this.touchEpoch(epochOf(data))
    state.profiles = arrayOf<RenderProfile>(data?.profiles).slice(-LIMITS.renderProfiles)
    state.profilesTotal = finiteOrNull(data?.total)
    this.bump('renderProfiles')
  }

  ingestStateTimeline(data: TimelinePush | undefined): void {
    if (typeof data?.epoch === 'string') this.touchEpoch(data.epoch)
    this.timeline.ingest(data)
    this.lastTimelinePull = Date.now()
    this.flushStateTimeline()
    // The runtime's activation snapshot ends with a `reset: true` timeline
    // (after components and profiles), so that completes a snapshot (D4).
    if (data?.reset === true) {
      // Copy: each waiter removes itself from the list while we iterate.
      for (const done of this.snapshotWaiters.slice()) done()
    }
  }

  ingestFps(sample: FpsSample): void {
    this.fps.push(sample)
    this.bump('fps')
    this.hooks.onFpsSample?.(sample)
  }

  ingestRuntimeError(error: RuntimeError): void {
    this.errors.push(error)
    this.bump('errors')
  }

  recordLoadProfile(profile: LoadProfile): void {
    this.loads.push(profile)
    this.bump('loadProfiles')
    this.hooks.onLoadProfile?.(profile)
  }

  /**
   * A warning identical to one held is not recorded again: a component is
   * compiled once per environment (client and SSR), each time warning anew.
   */
  recordCompilerWarning(warning: CompilerWarning): void {
    const held = this.warnings.items.some(
      w =>
        w.file === warning.file &&
        w.line === warning.line &&
        w.column === warning.column &&
        w.code === warning.code &&
        w.message === warning.message,
    )
    if (held) return
    this.warnings.push(warning)
    this.bump('errors')
  }

  clearLoadProfiles(): void {
    this.loads.clear()
    this.bump('loadProfiles')
  }

  clearErrors(): void {
    this.warnings.clear()
    this.errors.clear()
    this.bump('errors')
  }

  clearFps(): void {
    this.fps.clear()
    this.bump('fps')
  }

  clearStateTimeline(): void {
    this.timeline.clear()
    this.hot?.send(HOT_EVENTS.clearStateTimeline, {})
  }

  // --- reads ---

  /** Changes after `since` (a previous `cursor`), or the whole buffer when the cursor is stale. */
  getStateTimelineDelta(since?: number): StateTimelineDelta {
    return this.timeline.delta(since)
  }

  /**
   * What the server holds versus what was reported, per dataset (§6.7 B).
   * `total: null` means unknown; nothing is estimated.
   */
  getCaptureInfo(): CaptureInfoMap {
    const state = this.servedState()
    const epoch = this.servedEpoch
    const withEpoch = epoch !== undefined && { epoch }
    const profiles = state?.profiles.length ?? 0
    const profilesTotal = state?.profilesTotal ?? null
    const info: CaptureInfoMap = {
      liveComponents: {
        captured: state?.components.size ?? 0,
        total: this.liveComponentsTotal,
        truncated: (state?.overflow.size ?? 0) > 0,
        policy: 'roots-first',
        ...withEpoch,
      },
      renderProfiles: {
        captured: profiles,
        total: profilesTotal,
        truncated: profilesTotal !== null && profilesTotal > profiles,
        // The runtime keeps first-render order and sends the tail: the newest-mounted instances (review IA1).
        policy: 'newest-mounted',
        ...withEpoch,
      },
      stateTimeline: this.timeline.captureInfo(epoch),
      fpsSamples: this.fps.info,
      runtimeErrors: this.errors.info,
      loadProfiles: this.loads.info,
      compilerWarnings: this.warnings.info,
    }
    const graph = this.lastGraph
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

  // --- pulls (the runtime answers on request) ---

  /**
   * A graph reply. With a `requestId` (§6.7 A) it resolves only that request,
   * and only if its epoch matches the one asked for; a reply nobody waits for
   * (another app tab, too late) is ignored. Without one (an older runtime) it
   * is a whole-app graph and answers every pending graph pull, scoped ones by
   * filtering here.
   */
  ingestReactiveGraph(data: Payload | undefined): void {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined
    if (requestId === undefined) {
      let answered = false
      for (const [id, pull] of this.pulls) {
        if (pull.kind !== 'graph') continue
        answered = true
        this.settle(id, normalizeGraph(data, pull.scope, pull.epoch))
      }
      if (!answered) this.lastGraph = normalizeGraph(data, null, this.servedEpoch ?? null)
    } else {
      const pull = this.matchingPull(requestId, 'graph', data)
      if (!pull) return
      this.settle(requestId, normalizeGraph(data, pull.scope, pull.epoch))
    }
    this.bump('reactiveGraph')
  }

  /** A summary reply (§6.7 I): resolves only the matching request. */
  ingestReactiveSummary(data: Payload | undefined): void {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined
    const pull = requestId === undefined ? undefined : this.matchingPull(requestId, 'summary', data)
    if (pull) this.settle(requestId!, normalizeSummary(data, pull.epoch))
  }

  /** The pending pull `requestId` names, if the reply is of its kind and from its epoch. */
  private matchingPull(
    requestId: string,
    kind: PendingPull['kind'],
    data: Payload | undefined,
  ): PendingPull | undefined {
    const pull = this.pulls.get(requestId)
    if (pull?.kind !== kind) return undefined
    if (pull.epoch !== null && typeof data?.epoch === 'string' && data.epoch !== pull.epoch) {
      return undefined
    }
    return pull
  }

  /**
   * Ask the browser runtime for the graph of one component instance (or the
   * whole app), built by the runtime within the caps (§6.7 A). Falls back to
   * the last result for the same scope, marked `stale`.
   */
  requestReactiveGraph(req: ReactiveGraphRequest = {}): Promise<ReactiveGraphResult> {
    const id = req.componentId
    const scope = typeof id === 'number' && Number.isInteger(id) && id >= 0 ? id : null
    const maxNodes = clampInt(req.maxNodes, 1, LIMITS.reactiveNodes, LIMITS.reactiveNodes)
    const maxEdges = clampInt(req.maxEdges, 1, LIMITS.reactiveEdges, LIMITS.reactiveEdges)
    const epoch = this.servedEpoch ?? null
    // No page load has sent its tree: a component id means nothing yet, and
    // asking every tab would let any of them answer for it (review MUST-1).
    if (scope !== null && epoch === null) {
      return Promise.resolve(emptyGraph(scope, epoch, 'no-runtime'))
    }
    // The id belongs to an earlier page load; another instance may reuse it now.
    if (scope !== null && typeof req.epoch === 'string' && req.epoch !== epoch) {
      return Promise.resolve(emptyGraph(scope, epoch, 'epoch-changed'))
    }
    return this.keyedPull<ReactiveGraphResult>({
      kind: 'graph',
      key: `graph|${epoch ?? ''}|${scope ?? '*'}|${maxNodes}|${maxEdges}`,
      epoch,
      scope,
      event: HOT_EVENTS.requestReactiveGraph,
      payload: { ...(scope !== null && { componentId: scope }), maxNodes, maxEdges },
      empty: reason => emptyGraph(scope, epoch, reason),
    })
  }

  /** Ask the runtime for the overview aggregate (§6.7 I); never captures the graph. */
  requestReactiveSummary(req: ReactiveSummaryRequest = {}): Promise<ReactiveSummary> {
    const { topK: defaultTopK, maxTopK, windowMs: defaultWindow } = SUMMARY_DEFAULTS
    const topK = clampInt(req.topK, 1, maxTopK, defaultTopK)
    const windowMs = clampInt(
      req.windowMs,
      SUMMARY_DEFAULTS.minWindowMs,
      SUMMARY_DEFAULTS.maxWindowMs,
      defaultWindow,
    )
    const epoch = this.servedEpoch ?? null
    return this.keyedPull<ReactiveSummary>({
      kind: 'summary',
      key: `summary|${epoch ?? ''}|${topK}|${windowMs}`,
      epoch,
      scope: null,
      event: HOT_EVENTS.requestReactiveSummary,
      payload: { topK, windowMs },
      empty: reason => emptySummary(epoch, windowMs, reason),
    })
  }

  /**
   * One pull per key at a time; a result younger than {@link PULL_FRESHNESS}
   * is reused. The request carries a requestId and the served epoch; only
   * the matching reply resolves it. On timeout (or without a runtime) the
   * last result for the same key is returned with `stale: true`.
   */
  private keyedPull<T extends PullResult>(req: {
    kind: PendingPull['kind']
    key: string
    epoch: string | null
    scope: number | null
    event: string
    payload: Record<string, unknown>
    empty: (reason: 'timeout' | 'no-runtime') => T
  }): Promise<T> {
    const { key, epoch } = req
    const fallback = (reason: 'timeout' | 'no-runtime'): T => {
      const last = this.pullCache.get(key)
      return last ? ({ ...last.value, stale: true, staleReason: reason } as T) : req.empty(reason)
    }
    const hot = this.hot
    if (!hot) return Promise.resolve(fallback('no-runtime'))
    const cached = this.pullCache.get(key)
    if (cached && Date.now() - cached.at < PULL_FRESHNESS) return Promise.resolve(cached.value as T)
    const existing = this.pullInflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const requestId = `r${++this.requestSeq}`
    const promise = new Promise<T>(resolve => {
      this.pulls.set(requestId, {
        kind: req.kind,
        key,
        epoch,
        scope: req.scope,
        resolve: resolve as PendingPull['resolve'],
        fallback,
        timer: setTimeout(() => this.settle(requestId, 'timeout'), RUNTIME_REQUEST_TIMEOUT),
      })
      hot.send(req.event, { requestId, ...(epoch !== null && { epoch }), ...req.payload })
    }).finally(() => {
      if (this.pullInflight.get(key) === promise) this.pullInflight.delete(key)
    })
    this.pullInflight.set(key, promise)
    return promise
  }

  /**
   * Resolve a pending pull: with a fresh result (cached under its key), or
   * with its fallback when the runtime did not answer.
   */
  private settle(requestId: string, outcome: PullResult | 'timeout' | 'no-runtime'): void {
    const pull = this.pulls.get(requestId)
    if (!pull) return
    this.pulls.delete(requestId)
    clearTimeout(pull.timer)
    if (typeof outcome === 'string') {
      pull.resolve(pull.fallback(outcome))
      return
    }
    this.pullCache.delete(pull.key)
    this.pullCache.set(pull.key, { value: outcome, at: Date.now() })
    while (this.pullCache.size > MAX_CACHED_PULLS) {
      this.pullCache.delete(this.pullCache.keys().next().value!)
    }
    if (pull.kind === 'graph') this.lastGraph = outcome as ReactiveGraphResult
    pull.resolve(outcome)
  }

  /**
   * Ask the browser runtime for a fresh state timeline; falls back to the
   * last one. Concurrent callers share one in-flight pull, and a result
   * younger than {@link PULL_FRESHNESS} is reused, so several polling clients
   * never make the user's app rebuild the same data more than once a second.
   */
  requestStateTimeline(): Promise<StateChange[]> {
    const hot = this.hot
    if (!hot || Date.now() - this.lastTimelinePull < PULL_FRESHNESS) {
      return Promise.resolve(this.stateTimeline)
    }
    if (this.timelineInflight) return this.timelineInflight
    const promise = new Promise<StateChange[]>(resolve => {
      const resolver = (value: StateChange[]) => {
        clearTimeout(timeout)
        resolve(value)
      }
      const timeout = setTimeout(() => {
        // Remove this resolver to prevent a leak, then answer from cache.
        this.timelineResolvers = this.timelineResolvers.filter(r => r !== resolver)
        resolve(this.stateTimeline)
      }, RUNTIME_REQUEST_TIMEOUT)
      this.timelineResolvers.push(resolver)
      hot.send(HOT_EVENTS.requestStateTimeline, {})
    }).finally(() => {
      if (this.timelineInflight === promise) this.timelineInflight = undefined
    })
    this.timelineInflight = promise
    return promise
  }

  // Snapshot then reset before resolving so concurrent requests that push
  // during the resolve loop are not silently dropped.
  private flushStateTimeline(): void {
    const pending = this.timelineResolvers
    this.timelineResolvers = []
    for (const resolve of pending) resolve(this.stateTimeline)
  }
}
