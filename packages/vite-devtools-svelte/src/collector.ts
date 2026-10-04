import type {
  CompilerWarning,
  ComponentInstance,
  FpsSample,
  LoadProfile,
  ReactiveGraph,
  RenderProfile,
  RuntimeError,
  StateChange,
  StateTimelineDelta,
  StateTimelineEntry,
  DatasetVersions,
} from './types.js'

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
  requestStateTimeline: 'svelte-devtools:request-state-timeline',
  clearStateTimeline: 'svelte-devtools:clear-state-timeline',
  /** runtime → server, once per page load: "send me the current subscription state". */
  runtimeReady: 'svelte-devtools:runtime-ready',
  /** server → runtime(s): `{ active: boolean }` — whether any consumer is watching. */
  subscription: 'svelte-devtools:subscription',
} as const

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
  private lastPull = { reactiveGraph: 0, stateTimeline: 0 }
  private inflight: {
    reactiveGraph?: Promise<ReactiveGraph>
    stateTimeline?: Promise<StateChange[]>
  } = {}

  private hot: HotChannel | undefined
  private detachHot: (() => void) | undefined
  private leases = new Map<string, number>()
  private snapshotWaiters: Array<() => void> = []
  private active = false
  private sweepTimer: ReturnType<typeof setTimeout> | undefined
  private reactiveGraphResolvers: Array<(graph: ReactiveGraph) => void> = []
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
    this.flushReactiveGraph()
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
    else state = { components: new Map(), overflow: new Set(), hasBase: false, profiles: [] }
    this.epochs.set(epoch, state) // re-insert: Map order = recency
    while (this.epochs.size > MAX_EPOCHS) {
      const evicted = this.epochs.keys().next().value!
      this.epochs.delete(evicted)
      this.resyncRequested.delete(evicted)
      this.dropEpoch(evicted)
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

  ingestProfiles(data: { profiles?: unknown; epoch?: unknown } | undefined): void {
    const epoch = typeof data?.epoch === 'string' ? data.epoch : LEGACY_EPOCH
    this.touchEpoch(epoch).profiles = tail(data?.profiles, LIMITS.renderProfiles)
    this.bump('renderProfiles')
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
    data: { changes?: unknown; epoch?: unknown; reset?: unknown } | undefined,
  ): void {
    const incoming = tail<StateChange>(data?.changes, LIMITS.stateTimeline)
    if (typeof data?.epoch === 'string') {
      this.touchEpoch(data.epoch)
      if (data.reset === true) this.dropEpoch(data.epoch)
      this.appendTimeline(incoming, data.epoch)
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
    for (let i = 0; i < drop; i++) bytes -= this.timelineSizes[i]
    // Keep at least the newest entry even if it alone exceeds the budget.
    while (bytes > STATE_TIMELINE_BYTES && drop < this.timeline.length - 1) {
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

  ingestReactiveGraph(data: Partial<ReactiveGraph> | undefined): void {
    this.reactiveGraph = {
      nodes: head(data?.nodes, LIMITS.reactiveNodes),
      edges: head(data?.edges, LIMITS.reactiveEdges),
    }
    this.bump('reactiveGraph')
    this.lastPull.reactiveGraph = Date.now()
    this.flushReactiveGraph()
  }

  ingestFps(sample: FpsSample): void {
    this.fpsSamples.push(sample)
    if (this.fpsSamples.length > LIMITS.fpsSamples) {
      this.fpsSamples = this.fpsSamples.slice(-LIMITS.fpsSamples)
    }
    this.bump('fps')
    this.hooks.onFpsSample?.(sample)
  }

  ingestRuntimeError(error: RuntimeError): void {
    this.runtimeErrors.push(error)
    if (this.runtimeErrors.length > LIMITS.runtimeErrors) {
      this.runtimeErrors = this.runtimeErrors.slice(-LIMITS.runtimeErrors)
    }
    this.bump('errors')
  }

  recordLoadProfile(profile: LoadProfile): void {
    this.loadProfiles.push(profile)
    if (this.loadProfiles.length > LIMITS.loadProfiles) {
      this.loadProfiles = this.loadProfiles.slice(-LIMITS.loadProfiles)
    }
    this.bump('loadProfiles')
    this.hooks.onLoadProfile?.(profile)
  }

  recordCompilerWarning(warning: CompilerWarning): void {
    this.compilerWarnings.push(warning)
    if (this.compilerWarnings.length > LIMITS.compilerWarnings) {
      this.compilerWarnings = this.compilerWarnings.slice(-LIMITS.compilerWarnings)
    }
    this.bump('errors')
  }

  clearLoadProfiles(): void {
    this.loadProfiles = []
    this.bump('loadProfiles')
  }

  clearErrors(): void {
    this.compilerWarnings = []
    this.runtimeErrors = []
    this.bump('errors')
  }

  clearFps(): void {
    this.fpsSamples = []
    this.bump('fps')
  }

  clearStateTimeline(): void {
    this.timeline = []
    this.timelineSizes = []
    this.timelineEpochs = []
    this.timelineBytes = 0
    this.markTimelineReset()
    this.hot?.send(HOT_EVENTS.clearStateTimeline, {})
  }

  /** Ask the browser runtime for a fresh reactive graph; falls back to the last one. */
  requestReactiveGraph(): Promise<ReactiveGraph> {
    return this.pull(
      'reactiveGraph',
      HOT_EVENTS.requestReactiveGraph,
      this.reactiveGraphResolvers,
      () => this.reactiveGraph,
    )
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
  private pull<K extends 'reactiveGraph' | 'stateTimeline', T>(
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
  private flushReactiveGraph(): void {
    const pending = this.reactiveGraphResolvers
    this.reactiveGraphResolvers = []
    for (const resolve of pending) resolve(this.reactiveGraph)
  }

  private flushStateTimeline(): void {
    const pending = this.stateTimelineResolvers
    this.stateTimelineResolvers = []
    for (const resolve of pending) resolve(this.stateTimeline)
  }
}
