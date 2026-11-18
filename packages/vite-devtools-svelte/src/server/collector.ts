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
  ElementPick,
} from '../types.js';
import { arrayOf, asPayload, clampInt, finiteOrNull } from './payload.js';
import type { Payload } from './payload.js';
import {
  emptyGraph,
  emptySummary,
  GRAPH_LIMITS,
  normalizeGraph,
  normalizeSummary,
  SUMMARY_DEFAULTS,
} from './reactive.js';
import { Ring } from './ring.js';
import { LEGACY_EPOCH, nextSeq, STATE_TIMELINE_LIMIT, StateTimeline } from './state-timeline.js';
import type { TimelinePush } from './state-timeline.js';

export { STATE_TIMELINE_BYTES } from './state-timeline.js';

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
} as const;

/** After this, a pull to the browser runtime is answered from cache. */
export const RUNTIME_REQUEST_TIMEOUT = 1000;

/** A pull answered within this window is reused instead of asking the runtime again. */
export const PULL_FRESHNESS = 1000;

export const LEASE_TTL = 15_000;

/** App page loads (tabs / reloads) kept, LRU. */
export const MAX_EPOCHS = 4;

const MAX_CACHED_PULLS = 32;

type DatasetKey = keyof DatasetVersions;

/** Stable contract with the browser runtime. */
export const HOT_EVENTS = {
  components: 'svelte-devtools:components',
  profiles: 'svelte-devtools:profiles',
  stateTimeline: 'svelte-devtools:state-timeline',
  fps: 'svelte-devtools:fps',
  runtimeError: 'svelte-devtools:runtime-error',
  reactiveGraph: 'svelte-devtools:reactive-graph',
  requestReactiveGraph: 'svelte-devtools:request-reactive-graph',
  /** server → runtime `{ requestId, epoch?, topK }`; reply `reactiveSummary`. */
  requestReactiveSummary: 'svelte-devtools:request-reactive-summary',
  reactiveSummary: 'svelte-devtools:reactive-summary',
  requestStateTimeline: 'svelte-devtools:request-state-timeline',
  clearStateTimeline: 'svelte-devtools:clear-state-timeline',
  /** runtime → server, once per page load: "send me the current subscription state". */
  runtimeReady: 'svelte-devtools:runtime-ready',
  /** server → runtime(s): `{ active: boolean }`, whether any consumer is watching. */
  subscription: 'svelte-devtools:subscription',
  /** runtime → server: `{ epoch, componentId }`, a component chosen with Inspect in the inspector. */
  elementPicked: 'svelte-devtools:element-picked',
  /** browser → server: a `load` run in the browser, which has no recorder (see load-profile.ts). */
  loadProfile: 'svelte-devtools:load-profile',
} as const;

// A DevTools UI that connects this soon after a pick (the dock opening the
// Svelte panel for it) still gets it.
export const RECENT_PICK_MS = 10_000;

const MAX_EPOCH = 200;

function parseElementPick(value: unknown): ElementPick | null {
  const { epoch, componentId } = asPayload(value) ?? {};
  if (typeof epoch !== 'string' || epoch.length === 0 || epoch.length > MAX_EPOCH) return null;
  if (typeof componentId !== 'number' || !Number.isSafeInteger(componentId) || componentId < 0) {
    return null;
  }
  return { epoch, componentId };
}

interface EpochState {
  /** Insertion order = registration order (parents first). */
  components: Map<number, ComponentInstance>;
  // Mounted instances not stored: past the cap, or under an unstored parent
  // (storing it would show an orphan). Ids only, so the total and removals stay exact.
  overflow: Set<number>;
  hasBase: boolean;
  profiles: RenderProfile[];
  /** Runtime's count before its tail cap; `null` = unknown. */
  profilesTotal: number | null;
}

type PullResult = ReactiveGraphResult | ReactiveSummary;

interface PendingPull {
  kind: 'graph' | 'summary';
  key: string;
  epoch: string | null;
  scope: number | null;
  resolve: (value: PullResult) => void;
  fallback: (reason: 'timeout' | 'no-runtime') => PullResult;
  timer: ReturnType<typeof setTimeout>;
}

export interface HotClient {
  send(event: string, payload: unknown): void;
}

export interface HotChannel {
  send(event: string, payload: unknown): void;
  on(event: string, listener: (payload: unknown, client: HotClient) => void): void;
  off?(event: string, listener: (payload: unknown, client: HotClient) => void): void;
}

export interface CollectorHooks {
  onFpsSample?: (sample: FpsSample) => void;
  onLoadProfile?: (profile: LoadProfile) => void;
}

const epochOf = (data: Payload | undefined) =>
  typeof data?.epoch === 'string' ? data.epoch : LEGACY_EPOCH;

export class Collector {
  // Component tree + render profiles are kept per app page load (`epoch`),
  // so several app tabs / a reload don't overwrite each other; the epoch that
  // pushed most recently is the one served.
  private epochs = new Map<string, EpochState>();
  private servedEpoch: string | undefined;
  private liveCache: ComponentInstance[] | undefined;
  /** Epochs asked for a full snapshot after a delta without a base; asked once per epoch. */
  private resyncRequested = new Set<string>();

  private readonly fps = new Ring<FpsSample>(LIMITS.fpsSamples);
  private readonly errors = new Ring<RuntimeError>(LIMITS.runtimeErrors);
  private readonly loads = new Ring<LoadProfile>(LIMITS.loadProfiles);
  private readonly warnings = new Ring<CompilerWarning>(LIMITS.compilerWarnings);
  private readonly timeline = new StateTimeline(() => this.bump('stateTimeline'));

  // Opaque change tokens drawn from the process-wide counter (like timeline
  // seqs): a restarted server's collector never reports a value a client saw
  // before, so "unchanged version → skip refetch" stays correct across
  // restarts.
  readonly versions: DatasetVersions = {
    components: nextSeq(),
    renderProfiles: nextSeq(),
    loadProfiles: nextSeq(),
    stateTimeline: nextSeq(),
    reactiveGraph: nextSeq(),
    errors: nextSeq(),
    fps: nextSeq(),
    apiEndpoints: nextSeq(),
  };

  // Each pull carries a requestId + the served epoch, and only the matching
  // reply resolves it, so one viewer never receives another viewer's scope.
  private pulls = new Map<string, PendingPull>();
  private pullCache = new Map<string, { value: PullResult; at: number }>();
  private pullInflight = new Map<string, Promise<PullResult>>();
  private requestSeq = 0;
  private lastGraph: ReactiveGraphResult | undefined;

  private lastTimelinePull = 0;
  private timelineInflight: Promise<StateChange[]> | undefined;
  private timelineResolvers: Array<(changes: StateChange[]) => void> = [];

  private hot: HotChannel | undefined;
  private detachHot: (() => void) | undefined;
  private leases = new Map<string, number>();
  private snapshotWaiters: Array<() => void> = [];
  private active = false;
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly pickListeners = new Set<(pick: ElementPick) => void>();
  private lastPick: { pick: ElementPick; at: number } | null = null;

  private readonly hooks: CollectorHooks;
  constructor(hooks: CollectorHooks = {}) {
    this.hooks = hooks;
  }

  private bump(...keys: DatasetKey[]): void {
    for (const key of keys) this.versions[key] = nextSeq();
  }

  // Re-attaching (dev server restart) detaches the previous channel first so
  // listeners never pile up.
  attach(hot: HotChannel): void {
    this.detach();
    this.hot = hot;
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
          const v = asPayload(d);
          if (typeof v?.timestamp === 'number' && typeof v.fps === 'number') {
            this.ingestFps(v as unknown as FpsSample);
          }
        },
      ],
      [
        HOT_EVENTS.runtimeError,
        d => {
          const v = asPayload(d);
          if (typeof v?.message === 'string') this.ingestRuntimeError(v as unknown as RuntimeError);
        },
      ],
      [HOT_EVENTS.reactiveGraph, d => this.ingestReactiveGraph(asPayload(d))],
      [HOT_EVENTS.reactiveSummary, d => this.ingestReactiveSummary(asPayload(d))],
      [
        HOT_EVENTS.elementPicked,
        d => {
          const pick = parseElementPick(d);
          if (pick) this.ingestPick(pick);
        },
      ],
    ];
    for (const [event, listener] of listeners) hot.on(event, listener);
    this.detachHot = () => {
      for (const [event, listener] of listeners) hot.off?.(event, listener);
    };
  }

  detach(): void {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    this.detachHot?.();
    this.detachHot = undefined;
    this.hot = undefined;
    // Answer pending pulls from cache instead of leaving them to time out.
    for (const id of this.pulls.keys()) this.settle(id, 'no-runtime');
    this.flushStateTimeline();
  }

  /** What the runtime is told: collect/poll only while somebody is watching. */
  get subscription(): { active: boolean; componentDeltas: true } {
    // `componentDeltas` advertises that the delta form of `components` is
    // accepted, so a runtime never sends deltas to an older server.
    return { active: this.active, componentDeltas: true };
  }

  get fpsSamples(): FpsSample[] {
    return this.fps.items;
  }

  get runtimeErrors(): RuntimeError[] {
    return this.errors.items;
  }

  get loadProfiles(): LoadProfile[] {
    return this.loads.items;
  }

  get compilerWarnings(): CompilerWarning[] {
    return this.warnings.items;
  }

  get stateTimeline(): StateTimelineEntry[] {
    return this.timeline.entries;
  }

  get liveComponents(): ComponentInstance[] {
    if (!this.liveCache) {
      const state = this.servedState();
      this.liveCache = state ? [...state.components.values()] : [];
    }
    return this.liveCache;
  }

  // Read together so a component id is never paired with another page load's epoch.
  get liveSnapshot(): {
    epoch: string | null;
    total: number;
    components: ComponentInstance[];
  } {
    const state = this.servedState();
    return {
      epoch: state ? (this.servedEpoch ?? null) : null,
      total: this.liveComponentsTotal,
      components: this.liveComponents,
    };
  }

  get liveComponentsTotal(): number {
    const state = this.servedState();
    return state ? state.components.size + state.overflow.size : 0;
  }

  get renderProfiles(): RenderProfile[] {
    return this.servedState()?.profiles ?? [];
  }

  get epochInfo(): { epoch: string | undefined; epochs: number } {
    return { epoch: this.servedEpoch ?? [...this.epochs.keys()].at(-1), epochs: this.epochs.size };
  }

  private servedState(): EpochState | undefined {
    if (this.servedEpoch !== undefined) return this.epochs.get(this.servedEpoch);
    // No page load has sent a component snapshot yet: show the most recent
    // pusher (its profiles; its tree is empty either way).
    return [...this.epochs.values()].at(-1);
  }

  // Becomes the served epoch only once it holds a full component snapshot: an
  // epoch known only from profiles/timeline would otherwise show an empty tree.
  private touchEpoch(epoch: string): EpochState {
    const state = this.epochs.get(epoch) ?? {
      components: new Map(),
      overflow: new Set(),
      hasBase: false,
      profiles: [],
      profilesTotal: null,
    };
    this.epochs.delete(epoch);
    this.epochs.set(epoch, state); // re-insert: Map order = recency
    while (this.epochs.size > MAX_EPOCHS) {
      const evicted = this.epochs.keys().next().value!;
      this.epochs.delete(evicted);
      this.resyncRequested.delete(evicted);
      this.timeline.forget(evicted);
      if (this.servedEpoch === evicted) this.serve(this.newestBasedEpoch());
    }
    if (state.hasBase) this.serve(epoch);
    return state;
  }

  private newestBasedEpoch(): string | undefined {
    let newest: string | undefined;
    for (const [epoch, state] of this.epochs) if (state.hasBase) newest = epoch;
    return newest;
  }

  private serve(epoch: string | undefined): void {
    if (this.servedEpoch === epoch) return;
    // Switching from another tab's data changes what both datasets serve.
    if (this.servedEpoch !== undefined) this.bump('components', 'renderProfiles');
    this.servedEpoch = epoch;
    this.liveCache = undefined;
  }

  onElementPicked(listener: (pick: ElementPick) => void): () => void {
    this.pickListeners.add(listener);
    return () => {
      this.pickListeners.delete(listener);
    };
  }

  // The pick's page load becomes the served one so the instance id resolves
  // in the components the UI reads next.
  ingestPick(pick: ElementPick): void {
    if (this.epochs.has(pick.epoch)) this.touchEpoch(pick.epoch);
    this.lastPick = { pick, at: Date.now() };
    for (const listener of this.pickListeners) listener(pick);
  }

  get recentPick(): ElementPick | null {
    const last = this.lastPick;
    return last && Date.now() - last.at <= RECENT_PICK_MS ? last.pick : null;
  }

  // The first lease activates the runtime's polling/FPS sampling; the last
  // expiry or release pauses it.
  lease(id: string, ttl = LEASE_TTL): boolean {
    const wasActive = this.active;
    this.leases.set(id, Date.now() + ttl);
    this.updateSubscription();
    return !wasActive && this.active;
  }

  release(id: string): void {
    if (this.leases.delete(id)) this.updateSubscription();
  }

  // Resolves once the activation snapshot arrived (or after `timeout`), so a
  // consumer that just activated the runtime doesn't read the stale
  // pre-activation state.
  waitForSnapshot(timeout: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        const idx = this.snapshotWaiters.indexOf(done);
        if (idx !== -1) this.snapshotWaiters.splice(idx, 1);
        resolve();
      };
      const timer = setTimeout(done, timeout);
      this.snapshotWaiters.push(done);
    });
  }

  private updateSubscription(): void {
    const now = Date.now();
    let next = Infinity;
    for (const [id, expiresAt] of this.leases) {
      if (expiresAt <= now) this.leases.delete(id);
      else next = Math.min(next, expiresAt);
    }
    const active = this.leases.size > 0;
    if (active !== this.active) {
      this.active = active;
      this.hot?.send(HOT_EVENTS.subscription, this.subscription);
    }
    clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    if (next !== Infinity) {
      this.sweepTimer = setTimeout(() => this.updateSubscription(), next - now + 1);
      this.sweepTimer.unref?.();
    }
  }

  // A delta for an epoch with no full snapshot (new, or evicted) is not
  // applied, since a partial tree would persist; the sender is asked to
  // resync. An instance is stored only while its parent is, so the stored
  // part is always a rooted, orphan-free tree.
  ingestComponents(data: Payload | undefined, client?: HotClient): void {
    const epoch = epochOf(data);
    const isDelta =
      !Array.isArray(data?.components) &&
      (Array.isArray(data?.added) || Array.isArray(data?.removed));
    if (isDelta && !this.epochs.get(epoch)?.hasBase) {
      if (!this.resyncRequested.has(epoch)) {
        this.resyncRequested.add(epoch);
        client?.send(HOT_EVENTS.subscription, { ...this.subscription, resync: true });
      }
      return;
    }
    const state = this.touchEpoch(epoch);
    if (isDelta) {
      for (const id of arrayOf<number>(data?.removed)) {
        if (!state.components.delete(id)) state.overflow.delete(id);
      }
    } else {
      this.resyncRequested.delete(epoch);
      state.hasBase = true;
      this.serve(epoch);
      state.components = new Map();
      state.overflow = new Set();
    }
    for (const c of arrayOf<ComponentInstance>(isDelta ? data?.added : data?.components)) {
      if (typeof c?.id !== 'number') continue;
      if (state.components.has(c.id)) {
        state.components.set(c.id, c);
        continue;
      }
      const parentStored =
        c.parentId === null || c.parentId === undefined || state.components.has(c.parentId);
      if (parentStored && state.components.size < LIMITS.liveComponents) {
        state.overflow.delete(c.id);
        state.components.set(c.id, c);
      } else {
        state.overflow.add(c.id);
      }
    }
    this.liveCache = undefined;
    this.bump('components');
  }

  ingestProfiles(data?: Payload): void {
    const state = this.touchEpoch(epochOf(data));
    state.profiles = arrayOf<RenderProfile>(data?.profiles).slice(-LIMITS.renderProfiles);
    state.profilesTotal = finiteOrNull(data?.total);
    this.bump('renderProfiles');
  }

  ingestStateTimeline(data: TimelinePush | undefined): void {
    if (typeof data?.epoch === 'string') this.touchEpoch(data.epoch);
    this.timeline.ingest(data);
    this.lastTimelinePull = Date.now();
    this.flushStateTimeline();
    // The runtime's activation snapshot ends with a `reset: true` timeline
    // (after components and profiles), so that completes a snapshot.
    if (data?.reset === true) {
      // Copy: each waiter removes itself from the list while we iterate.
      for (const done of this.snapshotWaiters.slice()) done();
    }
  }

  ingestFps(sample: FpsSample): void {
    this.fps.push(sample);
    this.bump('fps');
    this.hooks.onFpsSample?.(sample);
  }

  ingestRuntimeError(error: RuntimeError): void {
    this.errors.push(error);
    this.bump('errors');
  }

  // Any file deliberately counts, not only `+server` files: a rescan is cheap,
  // runs only while the API panel is visible, and handlers can come from other modules.
  sourceChanged(): void {
    this.bump('apiEndpoints');
  }

  recordLoadProfile(profile: LoadProfile): void {
    this.loads.push(profile);
    this.bump('loadProfiles');
    this.hooks.onLoadProfile?.(profile);
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
    );
    if (held) return;
    this.warnings.push(warning);
    this.bump('errors');
  }

  clearLoadProfiles(): void {
    this.loads.clear();
    this.bump('loadProfiles');
  }

  clearErrors(): void {
    this.warnings.clear();
    this.errors.clear();
    this.bump('errors');
  }

  clearFps(): void {
    this.fps.clear();
    this.bump('fps');
  }

  clearStateTimeline(): void {
    this.timeline.clear();
    this.hot?.send(HOT_EVENTS.clearStateTimeline, {});
  }

  getStateTimelineDelta(since?: number): StateTimelineDelta {
    return this.timeline.delta(since);
  }

  /** `total: null` means unknown; nothing is estimated. */
  getCaptureInfo(): CaptureInfoMap {
    const state = this.servedState();
    const epoch = this.servedEpoch;
    const withEpoch = epoch !== undefined && { epoch };
    const profiles = state?.profiles.length ?? 0;
    const profilesTotal = state?.profilesTotal ?? null;
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
        // The runtime keeps first-render order and sends the tail: the newest-mounted instances.
        policy: 'newest-mounted',
        ...withEpoch,
      },
      stateTimeline: this.timeline.captureInfo(epoch),
      fpsSamples: this.fps.info,
      runtimeErrors: this.errors.info,
      loadProfiles: this.loads.info,
      compilerWarnings: this.warnings.info,
    };
    const graph = this.lastGraph;
    if (graph) {
      const common = {
        truncated: graph.truncated,
        policy: graph.policy,
        ...(graph.epoch !== null && { epoch: graph.epoch }),
      };
      info.reactiveNodes = {
        captured: graph.nodes.length,
        total: graph.total?.nodes ?? null,
        ...common,
      };
      info.reactiveEdges = {
        captured: graph.edges.length,
        total: graph.total?.edges ?? null,
        ...common,
      };
    }
    return info;
  }

  // A reply nobody waits for (another app tab, too late) is ignored. Without
  // a `requestId` (an older runtime) it is a whole-app graph and answers every
  // pending graph pull, scoped ones by filtering here.
  ingestReactiveGraph(data: Payload | undefined): void {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined;
    if (requestId === undefined) {
      let answered = false;
      for (const [id, pull] of this.pulls) {
        if (pull.kind !== 'graph') continue;
        answered = true;
        this.settle(id, normalizeGraph(data, pull.scope, pull.epoch));
      }
      if (!answered) this.lastGraph = normalizeGraph(data, null, this.servedEpoch ?? null);
    } else {
      const pull = this.matchingPull(requestId, 'graph', data);
      if (!pull) return;
      this.settle(requestId, normalizeGraph(data, pull.scope, pull.epoch));
    }
    this.bump('reactiveGraph');
  }

  ingestReactiveSummary(data: Payload | undefined): void {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined;
    const pull =
      requestId === undefined ? undefined : this.matchingPull(requestId, 'summary', data);
    if (pull) this.settle(requestId!, normalizeSummary(data, pull.epoch));
  }

  private matchingPull(
    requestId: string,
    kind: PendingPull['kind'],
    data: Payload | undefined,
  ): PendingPull | undefined {
    const pull = this.pulls.get(requestId);
    if (pull?.kind !== kind) return undefined;
    if (pull.epoch !== null && typeof data?.epoch === 'string' && data.epoch !== pull.epoch) {
      return undefined;
    }
    return pull;
  }

  requestReactiveGraph(req: ReactiveGraphRequest = {}): Promise<ReactiveGraphResult> {
    const id = req.componentId;
    const scope = typeof id === 'number' && Number.isInteger(id) && id >= 0 ? id : null;
    const maxNodes = clampInt(req.maxNodes, 1, LIMITS.reactiveNodes, LIMITS.reactiveNodes);
    const maxEdges = clampInt(req.maxEdges, 1, LIMITS.reactiveEdges, LIMITS.reactiveEdges);
    const epoch = this.servedEpoch ?? null;
    // No page load has sent its tree: a component id means nothing yet, and
    // asking every tab would let any of them answer for it.
    if (scope !== null && epoch === null) {
      return Promise.resolve(emptyGraph(scope, epoch, 'no-runtime'));
    }
    // The id belongs to an earlier page load; another instance may reuse it now.
    if (scope !== null && typeof req.epoch === 'string' && req.epoch !== epoch) {
      return Promise.resolve(emptyGraph(scope, epoch, 'epoch-changed'));
    }
    return this.keyedPull<ReactiveGraphResult>({
      kind: 'graph',
      key: `graph|${epoch ?? ''}|${scope ?? '*'}|${maxNodes}|${maxEdges}`,
      epoch,
      scope,
      event: HOT_EVENTS.requestReactiveGraph,
      payload: { ...(scope !== null && { componentId: scope }), maxNodes, maxEdges },
      empty: reason => emptyGraph(scope, epoch, reason),
    });
  }

  /** Never captures the graph. */
  requestReactiveSummary(req: ReactiveSummaryRequest = {}): Promise<ReactiveSummary> {
    const topK = clampInt(req.topK, 1, SUMMARY_DEFAULTS.maxTopK, SUMMARY_DEFAULTS.topK);
    const epoch = this.servedEpoch ?? null;
    return this.keyedPull<ReactiveSummary>({
      kind: 'summary',
      key: `summary|${epoch ?? ''}|${topK}`,
      epoch,
      scope: null,
      event: HOT_EVENTS.requestReactiveSummary,
      payload: { topK },
      empty: reason => emptySummary(epoch, reason),
    });
  }

  private keyedPull<T extends PullResult>(req: {
    kind: PendingPull['kind'];
    key: string;
    epoch: string | null;
    scope: number | null;
    event: string;
    payload: Record<string, unknown>;
    empty: (reason: 'timeout' | 'no-runtime') => T;
  }): Promise<T> {
    const { key, epoch } = req;
    const fallback = (reason: 'timeout' | 'no-runtime'): T => {
      const last = this.pullCache.get(key);
      return last ? ({ ...last.value, stale: true, staleReason: reason } as T) : req.empty(reason);
    };
    const hot = this.hot;
    if (!hot) return Promise.resolve(fallback('no-runtime'));
    const cached = this.pullCache.get(key);
    if (cached && Date.now() - cached.at < PULL_FRESHNESS)
      return Promise.resolve(cached.value as T);
    const existing = this.pullInflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const requestId = `r${++this.requestSeq}`;
    const promise = new Promise<T>(resolve => {
      this.pulls.set(requestId, {
        kind: req.kind,
        key,
        epoch,
        scope: req.scope,
        resolve: resolve as PendingPull['resolve'],
        fallback,
        timer: setTimeout(() => this.settle(requestId, 'timeout'), RUNTIME_REQUEST_TIMEOUT),
      });
      hot.send(req.event, { requestId, ...(epoch !== null && { epoch }), ...req.payload });
    }).finally(() => {
      if (this.pullInflight.get(key) === promise) this.pullInflight.delete(key);
    });
    this.pullInflight.set(key, promise);
    return promise;
  }

  private settle(requestId: string, outcome: PullResult | 'timeout' | 'no-runtime'): void {
    const pull = this.pulls.get(requestId);
    if (!pull) return;
    this.pulls.delete(requestId);
    clearTimeout(pull.timer);
    if (typeof outcome === 'string') {
      pull.resolve(pull.fallback(outcome));
      return;
    }
    this.pullCache.delete(pull.key);
    this.pullCache.set(pull.key, { value: outcome, at: Date.now() });
    while (this.pullCache.size > MAX_CACHED_PULLS) {
      this.pullCache.delete(this.pullCache.keys().next().value!);
    }
    if (pull.kind === 'graph') this.lastGraph = outcome as ReactiveGraphResult;
    pull.resolve(outcome);
  }

  // Concurrent callers share one in-flight pull and fresh results are reused,
  // so several polling clients never make the app rebuild the same data more
  // than once a second.
  requestStateTimeline(): Promise<StateChange[]> {
    const hot = this.hot;
    if (!hot || Date.now() - this.lastTimelinePull < PULL_FRESHNESS) {
      return Promise.resolve(this.stateTimeline);
    }
    if (this.timelineInflight) return this.timelineInflight;
    const promise = new Promise<StateChange[]>(resolve => {
      const resolver = (value: StateChange[]) => {
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => {
        // Remove this resolver to prevent a leak, then answer from cache.
        this.timelineResolvers = this.timelineResolvers.filter(r => r !== resolver);
        resolve(this.stateTimeline);
      }, RUNTIME_REQUEST_TIMEOUT);
      this.timelineResolvers.push(resolver);
      hot.send(HOT_EVENTS.requestStateTimeline, {});
    }).finally(() => {
      if (this.timelineInflight === promise) this.timelineInflight = undefined;
    });
    this.timelineInflight = promise;
    return promise;
  }

  // Snapshot then reset before resolving so concurrent requests that push
  // during the resolve loop are not silently dropped.
  private flushStateTimeline(): void {
    const pending = this.timelineResolvers;
    this.timelineResolvers = [];
    for (const resolve of pending) resolve(this.stateTimeline);
  }
}
