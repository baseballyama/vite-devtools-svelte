// The devtools runtime: the store hooks.js feeds from Svelte's devtools
// events. Browser code, served from disk next to hooks.js.

// FNV-1a over UTF-16 code units: cheap change detection for large snapshots.
function __hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- hashes UTF-16 code units on purpose (one per index, no surrogate decoding)
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// String(value), or a placeholder when it cannot be converted (a
// null-prototype object, a throwing toString).
function __describe(value) {
  try {
    return String(value);
  } catch {
    return '(unprintable value)';
  }
}

// Wire shape of one component in a components message.
function __componentEntry(instance) {
  return {
    id: instance.id,
    file: instance.file,
    name: instance.name,
    parentId: instance.parentId,
    mounted: true,
  };
}

// Approximate wire size of one component entry (cost-adaptive throttling).
function __componentBytes(instance) {
  return instance.file.length + instance.name.length + 72;
}

// An integer within [lo, hi], or `d` when `v` is not a finite number.
function __clampInt(v, lo, hi, d) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

const __NO_VALUE = Symbol('no value');
// State timeline ring: every read sees at most 500 entries and
// __TIMELINE_BYTES (also the server's buffer budget). The raw array may
// hold up to __TIMELINE_TRIM_AT (2 x the 500 cap) between bulk trims.
const __TIMELINE_BYTES = 4 * 1024 * 1024;
const __TIMELINE_TRIM_AT = 1000;

/**
 * The devtools store of a page: component registry, reactive graph, state
 * timeline, activity summary, render profiles and FPS. `env` holds the
 * browser globals it uses (`window` in the browser; fakes in tests).
 */
export function createStore(env) {
  const {
    window,
    document,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame,
    performance,
  } = env;
  const store = {
    _nextId: 0,
    _instances: new Map(),
    _stack: [],
    _debounceTimer: null,

    // Render profiling
    _profiles: new Map(),
    _initStartTimes: new Map(),
    // componentId -> render ms not recorded yet (recordRenderDuration)
    _pendingRenders: new Map(),
    _rendersScheduled: false,
    _profileDebounceTimer: null,

    // Reactive graph
    _reactiveNodes: new Map(),
    _reactiveProxies: new Map(),

    // componentId -> Set<nodeId>. Lets unmount purge a component's reactive
    // nodes without scanning every node of the app.
    _nodesByComponent: new Map(),

    // State timeline
    _stateTimeline: [],
    // nodeId -> last observed value (primitive or parsed snapshot), and for
    // objects the compare key (the JSON string, or length+hash when large)
    _stateSnapshots: new Map(),
    _stateSnapshotStrs: new Map(),
    _timelineDebounceTimer: null,
    // signal (or proxy marker) -> nodeId, set at track time and removed by
    // _forgetNode: a scoped graph resolves dependencies without scanning
    // every node.
    _idBySignal: new WeakMap(),
    // proxy -> nodeId (root $state proxy nodes; the marker above is per node)
    _idByProxy: new WeakMap(),
    // Svelte component context -> component id (set by hooks.js)
    _idByContext: new WeakMap(),
    // componentId -> (name -> last suffix) for names declared more than once
    // per instance ({@const} in {#each} items, several $state class instances)
    _nameSeq: new Map(),
    // Module scopes: signals created while a .svelte.js/.ts module body runs
    // (shared state such as `export const cart = $state(...)`) belong to a
    // scope per module file. Ids come from the component id counter (never
    // reused, non-negative) but scopes are not components: they are not in
    // _instances / the component tree, and live as long as the page.
    _modules: new Map(),
    _moduleByFile: new Map(),
    // componentId -> { effect, effect_pre } counters: effect names are
    // numbered per component, so instances of one file match
    _effectSeq: new Map(),
    // owner effect -> Set<nodeId>: the nodes of signals created while that
    // effect ran ({#each} items, effect runs), removed when it is destroyed.
    _nodesByOwner: new WeakMap(),
    // $state nodes whose write was applied (markWritten, after Svelte's
    // flush of the batch) and not observed yet; observed in the next task.
    _written: new Set(),
    _observeTimer: null,
    _lastSnapshotSize: new Map(),
    _timelineSeq: 0,
    _pushedSeq: 0,
    _timelineReset: false,
    _entryInfo: new WeakMap(),
    // Sum of _entryInfo.bytes over _stateTimeline (runtime byte budget).
    _timelineBytes: 0,
    // Disclosure since the last push: unsent entries the ring removed
    // (by count / by bytes) and changes recorded only as a size summary.
    _timelineDropped: { 'runtime-count': 0, 'runtime-bytes': 0 },
    _valueTooLarge: 0,

    // Overview aggregate, O(1) per event: registered nodes per
    // component and type (+ app totals), and per live scope its activity
    // since it was registered (observed changes, renders, render ms, last
    // active time); a destroyed instance takes its counters with it.
    _nodeCounts: new Map(),
    _nodeTotals: { state: 0, derived: 0, effect: 0 },
    _activity: new Map(),
    _epoch: Math.random().toString(36).slice(2) + Date.now().toString(36),

    // Activity subscription
    // Inactive until the server says a DevTools client (UI tab or MCP lease)
    // is watching: no state polling, FPS rAF loop, or periodic HMR sends.
    _active: false,
    _componentsCost: { ms: 0, bytes: 0 },
    _componentDeltas: false,
    _pendingAdded: new Set(),
    _pendingRemoved: new Set(),
    _lastFullAt: 0,
    _resync: false,
    _profilesCost: { ms: 0, bytes: 0 },
    // = collector LIMITS.renderProfiles (pinned by a unit test): the server
    // keeps only the newest entries, so sending more is wasted bytes.
    _profileCap: 5000,
    _sampling: null,
    _baselining: false,
    // Polled state nodes not observed yet (no seed value). Their first
    // observation is a seed, not a change: no timeline entry, no activity
    // count, no drops — the old value is unknown, not null.
    _unseeded: new Set(),
    // pendingNodes last sent on a state-timeline message (null = none yet)
    _sentPendingNodes: null,
    _fpsGen: 0,
    // Readers of Svelte's objects (set by hooks.js from svelte/internal/devtools):
    // signalValue, isUninitialized, deps, reactions, kind, componentOf,
    // children, snapshot, and sourceNode (the node a $state proxy's
    // property / version signal belongs to, or null).
    _api: null,
    // the HMR channel (connectHot, by the first hooks.js copy that has one)
    _hot: null,

    // `parentHint`: the parent component's id (hooks.js reads it from the
    // component context), null for a root. When omitted, the component whose
    // init is running (the init stack) is the parent.
    register(file, parentHint) {
      const id = this._nextId++;
      let parentId = this._stack.length > 0 ? this._stack.at(-1) : null;
      if (parentHint !== undefined) {
        parentId = parentHint !== null && this._instances.has(parentHint) ? parentHint : null;
      }
      const baseName = file.slice(file.lastIndexOf('/') + 1);
      const name = baseName.endsWith('.svelte') ? baseName.slice(0, -'.svelte'.length) : baseName;
      // children is a Set so unmounting one row of a 5 000-row list is O(1).
      this._instances.set(id, {
        id,
        file,
        name: name === '' ? 'Unknown' : name,
        parentId,
        children: new Set(),
      });
      if (parentId !== null) {
        const parent = this._instances.get(parentId);
        if (parent) parent.children.add(id);
      }
      this._stack.push(id);
      if (this._active) this._pendingAdded.add(id);
      this._scheduleUpdate();
      return id;
    },

    // The component's init finished (pop): it leaves the init stack.
    registered(id) {
      const idx = this._stack.indexOf(id);
      if (idx !== -1) this._stack.splice(idx, 1);
    },

    // Also a component whose init threw (destroyed with its boundary): it
    // leaves the init stack too.
    unmount(id) {
      this.registered(id);
      this._removeInstance(id);
      this._scheduleUpdate();
      this._scheduleProfileUpdate();
    },

    // The instance and its subtree leave the tree.
    _removeInstance(id) {
      const instance = this._instances.get(id);
      if (!instance) return;
      if (instance.parentId !== null) this._instances.get(instance.parentId)?.children.delete(id);
      this._removeChildren(id);
      this._cleanupComponent(id);
    },

    // Remounts get a fresh id, so entries keyed by a dead id would otherwise
    // survive forever — every per-component map must be purged here.
    _cleanupComponent(id) {
      // Delta bookkeeping: an id added and removed between two pushes was
      // never sent, so it cancels out.
      if (this._active && !this._pendingAdded.delete(id)) this._pendingRemoved.add(id);
      this._cleanupReactiveNodes(id);
      this._activity.delete(id);
      this._effectSeq.delete(id);
      this._nameSeq.delete(id);
      this._instances.delete(id);
      this._profiles.delete(id);
      this._initStartTimes.delete(id);
    },

    _cleanupReactiveNodes(componentId) {
      const nodeIds = this._nodesByComponent.get(componentId);
      if (!nodeIds) return;
      this._nodesByComponent.delete(componentId);
      // a copy: _forgetNode() deletes from this set
      for (const nodeId of Array.from(nodeIds)) this._forgetNode(nodeId);
    },

    _forgetNode(nodeId) {
      const entry = this._reactiveNodes.get(nodeId);
      if (entry) {
        this._countNode(entry.meta.componentId, entry.meta.type, -1);
        const set = this._nodesByComponent.get(entry.meta.componentId);
        if (set) set.delete(nodeId);
      }
      const signal = entry?.signal?.deref();
      if (signal && this._idBySignal.get(signal) === nodeId) this._idBySignal.delete(signal);
      const owner = entry?.owner?.deref();
      if (owner) this._nodesByOwner.get(owner)?.delete(nodeId);
      const proxy = this._reactiveProxies.get(nodeId)?.deref();
      if (proxy && this._idByProxy.get(proxy) === nodeId) this._idByProxy.delete(proxy);
      this._unseeded.delete(nodeId);
      this._written.delete(nodeId);
      this._reactiveNodes.delete(nodeId);
      this._reactiveProxies.delete(nodeId);
      this._stateSnapshots.delete(nodeId);
      this._stateSnapshotStrs.delete(nodeId);
      this._lastSnapshotSize.delete(nodeId);
    },

    _scopeFile(id) {
      const scope = this._instances.get(id) ?? this._modules.get(id);
      return scope ? scope.file : '';
    },

    // Scope id of a module file: signals declared in a .svelte.js/.ts module
    // (shared state, class fields of instances created outside components).
    moduleScope(file) {
      let id = this._moduleByFile.get(file);
      if (id === undefined) {
        id = this._nextId++;
        this._modules.set(id, { file });
        this._moduleByFile.set(file, id);
      }
      return id;
    },

    // Nodes leave the store when their component unmounts or the effect
    // they belong to is destroyed (effectDestroyed); a signal can still be
    // collected first. Returns the signal, or null (and forgets the node).
    _liveSignal(nodeId) {
      const entry = this._reactiveNodes.get(nodeId);
      if (!entry) return null;
      const signal = entry.signal.deref();
      if (signal) return signal;
      this._forgetNode(nodeId);
      return null;
    },

    // Svelte destroyed `effect` (hooks.js): the $effect node bound to it and
    // the nodes of signals created while it ran leave the store now.
    effectDestroyed(effect) {
      const bound = this._idBySignal.get(effect);
      if (bound !== undefined) this._forgetNode(bound);
      const owned = this._nodesByOwner.get(effect);
      if (owned !== undefined) {
        this._nodesByOwner.delete(effect);
        for (const nodeId of owned) this._forgetNode(nodeId);
      }
      // seed progress changed: pushed like an observation pass would
      if (this._sentPendingNodes !== this._unseeded.size) this._scheduleTimelineUpdate();
    },

    // Svelte dropped `effect` from the tree without destroying it; its only
    // child (or nothing) takes its place, so the nodes it owns move there.
    effectElided(effect, replacement) {
      const owned = this._nodesByOwner.get(effect);
      if (owned === undefined) return;
      this._nodesByOwner.delete(effect);
      if (replacement === null) {
        for (const nodeId of owned) this._reactiveNodes.get(nodeId).owner = null;
        return;
      }
      const ref = new WeakRef(replacement);
      const target = this._ownedBy(replacement);
      for (const nodeId of owned) {
        this._reactiveNodes.get(nodeId).owner = ref;
        target.add(nodeId);
      }
    },

    _ownedBy(effect) {
      let set = this._nodesByOwner.get(effect);
      if (set === undefined) {
        set = new Set();
        this._nodesByOwner.set(effect, set);
      }
      return set;
    },

    // Unique node id for a signal: componentId:name, or componentId:name#k
    // when this instance already holds a live node of that name for another
    // signal. The same signal (re-tagged) keeps its id.
    _nodeIdFor(identity, byIdentity, componentId, name) {
      const known = byIdentity.get(identity);
      if (known !== undefined && this._reactiveNodes.has(known)) return known;
      const base = componentId + ':' + name;
      if (!this._reactiveNodes.has(base) || !this._liveSignal(base)) return base;
      let seq = this._nameSeq.get(componentId);
      if (!seq) {
        seq = new Map();
        this._nameSeq.set(componentId, seq);
      }
      let k = seq.get(name) ?? 1;
      let id;
      do {
        k++;
        id = base + '#' + k;
      } while (this._reactiveNodes.has(id) && this._liveSignal(id));
      seq.set(name, k);
      return id;
    },

    // `owner`: the effect the signal was created in, or null (module code).
    _registerNode(nodeId, componentId, type, name, signalRef, owner) {
      this._trackNodeCount(nodeId, componentId, type);
      const prev = this._reactiveNodes.get(nodeId)?.owner?.deref();
      if (prev) this._nodesByOwner.get(prev)?.delete(nodeId);
      const entry = {
        signal: signalRef,
        owner: owner ? new WeakRef(owner) : null,
        meta: { id: nodeId, type, name, componentId, componentFile: this._scopeFile(componentId) },
      };
      this._reactiveNodes.set(nodeId, entry);
      this._indexNode(nodeId, componentId);
      if (owner) this._ownedBy(owner).add(nodeId);
      return entry;
    },

    _indexNode(nodeId, componentId) {
      let set = this._nodesByComponent.get(componentId);
      if (!set) {
        set = new Set();
        this._nodesByComponent.set(componentId, set);
      }
      set.add(nodeId);
    },

    // A new $state node: its first observation (seed) is taken in the next
    // task, before the user can write to it.
    _seedLater(nodeId) {
      if (this._stateSnapshots.has(nodeId)) return;
      this._unseeded.add(nodeId);
      this._scheduleObserve();
    },

    // Svelte applied a write to this $state node (or to a property deep
    // inside its proxy): hooks.js calls this once the batch is flushed.
    markWritten(nodeId) {
      if (this._reactiveNodes.get(nodeId)?.meta.type !== 'state') return;
      this._written.add(nodeId);
      this._scheduleObserve();
    },

    // Before a track* call replaces/creates nodeId: move the count from the
    // previous registration (same name re-tracked) to the new one.
    _trackNodeCount(nodeId, componentId, type) {
      const prev = this._reactiveNodes.get(nodeId);
      if (prev) this._countNode(prev.meta.componentId, prev.meta.type, -1);
      this._countNode(componentId, type, 1);
    },

    _countNode(componentId, type, d) {
      const kind = type === 'derived' || type === 'effect' ? type : 'state';
      let c = this._nodeCounts.get(componentId);
      if (!c) {
        if (d < 0) return;
        c = { state: 0, derived: 0, effect: 0 };
        this._nodeCounts.set(componentId, c);
      }
      c[kind] += d;
      this._nodeTotals[kind] += d;
      if (c.state + c.derived + c.effect <= 0) this._nodeCounts.delete(componentId);
    },

    // Activity of a live scope since it was registered; touching it marks
    // the scope active now.
    _activityRow(componentId) {
      let r = this._activity.get(componentId);
      if (!r) {
        r = { changes: 0, renders: 0, renderMs: 0, lastActiveAt: 0 };
        this._activity.set(componentId, r);
      }
      r.lastActiveAt = Date.now();
      return r;
    },

    _removeChildren(parentId) {
      const parent = this._instances.get(parentId);
      if (!parent) return;
      // a copy: _cleanupComponent() changes this set
      for (const childId of Array.from(parent.children)) {
        this._removeChildren(childId);
        this._cleanupComponent(childId);
      }
    },

    // Full-list pushes are throttled, not debounced: a pending timer is not
    // reset, so continuous churn still produces updates (a debounce would
    // starve), and the interval adapts to the last push's cost so a 10 000+
    // instance app can't spend its main thread serializing:
    // max(min, 20 x last send ms, 1 s when the last payload exceeded ~1 MB).
    _sendInterval(cost, min) {
      return Math.max(min, 20 * cost.ms, cost.bytes > 1000000 ? 1000 : 0);
    },

    _scheduleUpdate() {
      if (!this._active || this._debounceTimer) return;
      this._debounceTimer = setTimeout(
        () => {
          this._debounceTimer = null;
          this._sendUpdate();
        },
        this._sendInterval(this._componentsCost, 100),
      );
    },

    // Components push. Full form { epoch, components } replaces the
    // server's tree for this epoch: sent on activation, when the server does
    // not advertise componentDeltas, as a periodic checkpoint, or when the
    // delta would be larger than the tree. Otherwise the delta form
    // { epoch, added, removed } (removed ids first, ≤ 2 000 entries per
    // message, added in registration order = parents first).
    _sendUpdate(forceFull) {
      // Nobody watching: keep the registry, skip the O(N) payload. A full
      // snapshot is sent on activation.
      if (!this._active) return;
      const t0 = performance.now();
      const CHUNK = 2000;
      const CHECKPOINT_MS = 30000;
      const pending = this._pendingAdded.size + this._pendingRemoved.size;
      const full =
        forceFull === true ||
        !this._componentDeltas ||
        t0 - this._lastFullAt >= CHECKPOINT_MS ||
        pending > this._instances.size;
      let bytes = 0;
      const msgs = [];
      if (full) {
        const components = [];
        for (const instance of this._instances.values()) {
          components.push(__componentEntry(instance));
          bytes += __componentBytes(instance);
        }
        msgs.push({ epoch: this._epoch, reset: true, components });
        this._lastFullAt = t0;
      } else if (pending > 0) {
        const removed = [...this._pendingRemoved];
        const added = [];
        for (const id of this._pendingAdded) {
          const instance = this._instances.get(id);
          if (instance) {
            added.push(__componentEntry(instance));
            bytes += __componentBytes(instance);
          }
        }
        bytes += removed.length * 8;
        for (let r = 0; r < removed.length; r += CHUNK) {
          msgs.push({ epoch: this._epoch, added: [], removed: removed.slice(r, r + CHUNK) });
        }
        for (let a = 0; a < added.length; a += CHUNK) {
          msgs.push({ epoch: this._epoch, added: added.slice(a, a + CHUNK), removed: [] });
        }
      }
      this._pendingAdded.clear();
      this._pendingRemoved.clear();
      for (const msg of msgs) this._send('svelte-devtools:components', msg);
      this._componentsCost = { ms: performance.now() - t0, bytes };
    },

    getTree() {
      return Array.from(this._instances.values(), __componentEntry);
    },

    // --- Render profiling ---

    startInit(id) {
      this._initStartTimes.set(id, performance.now());
    },

    endInit(id) {
      const start = this._initStartTimes.get(id);
      if (start === undefined) return;
      const initTime = performance.now() - start;
      this._initStartTimes.delete(id);
      if (!this._newProfile(id, initTime)) return;
      this._scheduleProfileUpdate();
    },

    recordRender(id) {
      const profile = this._profiles.get(id) ?? this._newProfile(id, 0);
      if (!profile) return;
      profile.renderCount++;
      profile.lastRenderAt = Date.now();
      this._activityRow(id).renders++;
      this._scheduleProfileUpdate();
    },

    // A fresh profile for a live instance (null otherwise).
    _newProfile(id, initTime) {
      const instance = this._instances.get(id);
      if (!instance) return null;
      const profile = {
        componentId: id,
        file: instance.file,
        name: instance.name,
        initTime,
        renderCount: 0,
        totalRenderTime: 0,
        lastRenderTime: 0,
        lastRenderAt: Date.now(),
      };
      this._profiles.set(id, profile);
      return profile;
    },

    // One render effect re-run of a component (hooks.js). One state change
    // re-runs several effects of the same component, so durations are pooled
    // per microtask and recorded once per flush: one render, their sum as time.
    recordRenderDuration(id, duration) {
      const pending = this._pendingRenders;
      pending.set(id, (pending.get(id) ?? 0) + duration);
      if (this._rendersScheduled) return;
      this._rendersScheduled = true;
      queueMicrotask(() => {
        this._rendersScheduled = false;
        for (const [cid, total] of pending) {
          this.recordRender(cid);
          this.recordRenderTime(cid, total);
        }
        pending.clear();
      });
    },

    recordRenderTime(id, duration) {
      const profile = this._profiles.get(id);
      if (profile) {
        profile.totalRenderTime += duration;
        profile.lastRenderTime = duration;
        this._activityRow(id).renderMs += duration;
      }
    },

    // Profiles push, throttled like components, but the floor grows with the
    // payload: every push carries the whole retained map, so a large app
    // coalesces bursts instead of resending ~1 MB twice a second. Hard cap
    // 2 s: a slow serialization must not stretch the latency beyond it.
    _profileInterval() {
      const cost = this._profilesCost;
      return Math.min(
        2000,
        Math.max(500, 20 * cost.ms, cost.bytes > 1000000 ? 2000 : cost.bytes > 250000 ? 1000 : 0),
      );
    },

    _scheduleProfileUpdate() {
      if (!this._active || this._profileDebounceTimer) return;
      this._profileDebounceTimer = setTimeout(() => {
        this._profileDebounceTimer = null;
        this._sendProfileUpdate();
      }, this._profileInterval());
    },

    // Also the forced path (activation / resync): a pending throttled push is
    // cancelled so the same state is not sent twice.
    _sendProfileUpdate() {
      if (this._profileDebounceTimer) {
        clearTimeout(this._profileDebounceTimer);
        this._profileDebounceTimer = null;
      }
      if (!this._active) return;
      const t0 = performance.now();
      const all = Array.from(this._profiles.values());
      // Exactly what the collector retains: its tail, in the same order.
      const profiles =
        all.length > this._profileCap ? all.slice(all.length - this._profileCap) : all;
      // total = all retained profiles; the message carries the newest-mounted tail
      this._send('svelte-devtools:profiles', { epoch: this._epoch, profiles, total: all.length });
      // Payload size from a small sample (entries differ mainly by file path).
      const k = Math.min(8, profiles.length);
      let sampled = 0;
      for (let i = 0; i < k; i++) sampled += JSON.stringify(profiles[i]).length;
      const bytes = k > 0 ? Math.round((sampled / k) * profiles.length) : 0;
      this._profilesCost = { ms: performance.now() - t0, bytes };
    },

    // --- Reactive graph tracking ---

    // `owner` (optional): the effect active when the signal was created; the
    // node is removed when it is destroyed (an {#each} item's {@const}, a
    // class instance created in an effect run).
    trackState(signal, name, componentId, owner) {
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'state', name, new WeakRef(signal), owner);
      this._idBySignal.set(signal, nodeId);
      this._seedLater(nodeId);
      return nodeId;
    },

    trackProxy(proxy, name, componentId, owner) {
      const nodeId = this._nodeIdFor(proxy, this._idByProxy, componentId, name);
      this._reactiveProxies.set(nodeId, new WeakRef(proxy));
      // The proxy itself stays weakly held (_reactiveProxies). The marker is
      // held strongly so the node is not GC-dropped while the component lives;
      // _cleanupComponent removes it on unmount.
      const marker = { v: '(proxy)', _isProxy: true };
      this._registerNode(nodeId, componentId, 'state', name, { deref: () => marker }, owner);
      this._idBySignal.set(marker, nodeId);
      this._idByProxy.set(proxy, nodeId);
      this._seedLater(nodeId);
      return nodeId;
    },

    trackDerived(signal, name, componentId, owner) {
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'derived', name, new WeakRef(signal), owner);
      this._idBySignal.set(signal, nodeId);
      return nodeId;
    },

    // A $effect / $effect.pre node; bindEffect() attaches the effect object
    // (the node is removed when that effect is destroyed).
    // kind: 'effect' | 'effect_pre'; names are effect_1, effect_pre_1, ... per
    // component, in creation order.
    trackUserEffect(kind, componentId) {
      let seq = this._effectSeq.get(componentId);
      if (!seq) {
        seq = { effect: 0, effect_pre: 0 };
        this._effectSeq.set(componentId, seq);
      }
      const name = kind + '_' + ++seq[kind];
      const nodeId = componentId + ':' + name;
      const placeholder = { v: undefined, _isEffect: true };
      this._registerNode(nodeId, componentId, 'effect', name, { deref: () => placeholder }, null);
      return nodeId;
    },

    bindEffect(nodeId, effect) {
      const entry = nodeId !== null && this._reactiveNodes.get(nodeId);
      if (!entry || !effect || typeof effect !== 'object') return;
      entry.signal = new WeakRef(effect);
      this._idBySignal.set(effect, nodeId);
    },

    // `container`: the effect active when the component was created (its
    // markup effects are created under it); `ctx`: its component context.
    setComponentEffect(id, container, ctx) {
      const instance = this._instances.get(id);
      if (instance && container) {
        instance.container = new WeakRef(container);
        instance.ctx = ctx;
      }
    },

    // Markup effects of a component: the effects of its template
    // (template_effect, {#if}/{#each}/... blocks, <svelte:head>), i.e. the
    // effects under its container created in the component's context,
    // without descending into other components or the tracked $effect nodes.
    _markupEffects(id) {
      const instance = this._instances.get(id);
      const container = instance?.container?.deref();
      if (!container) return [];
      const api = this._api;
      const ctx = instance.ctx;
      const out = [];
      const stack = api.children(container);
      while (stack.length > 0) {
        const e = stack.pop();
        if (api.componentOf(e) !== ctx) continue;
        if (api.deps(e).length > 0 && !this._idBySignal.has(e)) out.push(e);
        for (const c of api.children(e)) stack.push(c);
      }
      return out;
    },

    _graphNode(nodeId, entry, signal) {
      const node = { ...entry.meta };
      if (signal._isProxy) {
        const proxy = this._reactiveProxies.get(nodeId)?.deref();
        if (proxy) {
          try {
            node.value = Array.isArray(proxy)
              ? '[' + proxy.length + ']'
              : '{' + Object.keys(proxy).length + '}';
          } catch {
            node.value = '(proxy)';
          }
        }
      } else if (node.type === 'derived' && this._api.isUninitialized(signal)) {
        // Svelte computes a derived lazily: until something reads it, it has no value
        node.unevaluated = true;
      } else if (
        node.type !== 'effect' &&
        !this._api.isUninitialized(signal) &&
        this._api.signalValue(signal) !== undefined
      ) {
        try {
          const v = this._api.signalValue(signal);
          if (
            typeof v === 'number' ||
            typeof v === 'string' ||
            typeof v === 'boolean' ||
            v === null
          ) {
            node.value = v;
          } else {
            node.value = '(object)';
          }
        } catch {
          /* ignore */
        }
      }
      return node;
    },

    // Reactive graph. Caps are applied while building: past
    // maxNodes no node objects are created and only edges whose endpoints
    // are both included are emitted (the rest are counted in edgesOmitted).
    //  - scoped (componentId): that component's nodes plus the tracked nodes
    //    directly connected to them (via deps / reactions through untracked
    //    intermediates). Dependencies are resolved through _idBySignal, so
    //    the cost is O(scope + neighbours), not O(all nodes). The walk is
    //    completed even past the cap, so total.nodes/edges are exact.
    //  - global: nodes in registration order up to maxNodes ('global-head'),
    //    with their incoming dependency edges. Nodes past the cap are not
    //    dereferenced; total.nodes is the registered count (may include
    //    nodes whose signal was already collected, nodesKind 'registered')
    //    and total.edges is null when the walk stopped early (not guessed).
    // Template consumers: the compiler turns every dynamic part of the markup
    // ({expr}, attributes, {#if}/{#each}/{#key}/{#await} conditions,
    // <svelte:head>) into effects that are not tracked one by one. A read
    // from such an effect is reported as an edge to the synthetic node
    // '<componentId>:(template)' (type 'template') of the component the
    // effect belongs to (effect.ctx), so a value only the markup reads is
    // not shown without readers.
    getReactiveGraph(componentId, caps) {
      const scoped = componentId !== undefined && componentId !== null;
      const maxNodes = this._graphCap(caps?.maxNodes, 5000);
      const maxEdges = this._graphCap(caps?.maxEdges, 20000);
      const live = new Map();
      // Live signal of a tracked node, or null (forgets collected nodes).
      const liveSignal = nodeId => {
        if (live.has(nodeId)) return live.get(nodeId);
        const signal = this._liveSignal(nodeId);
        live.set(nodeId, signal);
        return signal;
      };
      const idOf = dep => {
        const id = this._idBySignal.get(dep);
        return id !== undefined && liveSignal(id) === dep ? id : null;
      };
      // Synthetic template nodes reached in this build: id -> componentId.
      const templates = new Map();
      const api = this._api;
      // Template node of an untracked effect, or null when its component is
      // unknown / unmounted.
      const templateOf = effect => {
        const ctx = api.componentOf(effect);
        if (ctx === null) return null;
        const cid = this._idByContext.get(ctx);
        if (cid === undefined || !this._instances.has(cid)) return null;
        const id = cid + ':(template)';
        templates.set(id, cid);
        return id;
      };

      const included = new Set();
      const seen = new Set();
      const edges = [];
      const edgeSet = new Set();
      let edgesOmitted = 0;
      let truncated = false;
      const see = id => {
        seen.add(id);
        if (!included.has(id) && included.size < maxNodes) included.add(id);
        return included.has(id);
      };
      const addEdge = (from, to) => {
        const key = from + '>' + to;
        if (from === to || edgeSet.has(key)) return;
        edgeSet.add(key);
        const inFrom = see(from);
        const inTo = see(to);
        if (inFrom && inTo && edges.length < maxEdges) edges.push({ from, to });
        else edgesOmitted++;
      };
      // Walk a signal's neighbours (deps or reactions) through untracked
      // intermediates (deriveds) until tracked nodes are reached. onTemplate
      // (reactions only) receives the template node of each untracked effect
      // reached. On the deps side an untracked leaf source (a proxy's
      // property or version) is resolved to its proxy's node.
      // nodeId -> dependencies on signals devtools does not track (created
      // in node_modules, e.g. SvelteKit's page state, or outside any
      // component/module body): reported so such a node is not "isolated"
      const untracked = new Map();
      const isDerived = x => {
        const k = api.kind(x);
        return k === 'derived' || k === 'async-derived';
      };
      const walk = (start, field, onHit, onTemplate, onUntracked) => {
        const visited = new Set();
        const queue = start;
        // Index cursor instead of queue.shift(): shift is O(queue) per pop.
        for (let qi = 0; qi < queue.length; qi++) {
          const dep = queue[qi];
          if (!dep || visited.has(dep)) continue;
          visited.add(dep);
          const id = idOf(dep);
          if (id) {
            if (onHit) onHit(id);
          } else if (isDerived(dep)) {
            for (const d of api[field](dep)) queue.push(d);
          } else if (field === 'reactions') {
            const t = onTemplate ? templateOf(dep) : null;
            if (t) onTemplate(t);
          } else if (onHit) {
            const owner = api.sourceNode(dep);
            if (owner !== null && liveSignal(owner)) onHit(owner);
            else if (onUntracked) onUntracked();
          }
        }
      };
      const nodeCid = nodeId => this._reactiveNodes.get(nodeId).meta.componentId;
      const countUntracked = nodeId => () =>
        untracked.set(nodeId, (untracked.get(nodeId) ?? 0) + 1);
      // Reads of a component's markup effects: edges into its template node
      // (filter: keep only edges from these node ids, for neighbours).
      const markupEdges = (cid, filter) => {
        const effects = this._markupEffects(cid);
        if (effects.length === 0) return;
        const t = cid + ':(template)';
        for (const effect of effects) {
          walk(api.deps(effect), 'deps', id => {
            if (filter && !filter(id)) return;
            templates.set(t, cid);
            addEdge(id, t);
          });
        }
      };

      let totalNodes = 0;
      let totalEdges = null;
      if (scoped) {
        // a copy: liveSignal() forgets dead nodes during the loop
        for (const nodeId of Array.from(this._nodesByComponent.get(componentId) ?? [])) {
          const signal = liveSignal(nodeId);
          if (!signal) continue;
          see(nodeId);
          walk(
            api.deps(signal),
            'deps',
            depId => addEdge(depId, nodeId),
            null,
            countUntracked(nodeId),
          );
          const toReader = rId => addEdge(nodeId, rId);
          walk(api.reactions(signal), 'reactions', toReader, toReader);
        }
        if (this._instances.has(componentId)) markupEdges(componentId, null);
        // Readers in direct children (props): a proxy has no reactions list
        // of its own, so its readers are found from their dependencies.
        const own = id => nodeCid(id) === componentId;
        const instance = this._instances.get(componentId);
        for (const child of instance ? instance.children : []) {
          // a copy: liveSignal() forgets dead nodes during the loop
          for (const nodeId of Array.from(this._nodesByComponent.get(child) ?? [])) {
            const signal = liveSignal(nodeId);
            if (signal)
              walk(api.deps(signal), 'deps', depId => own(depId) && addEdge(depId, nodeId));
          }
          markupEdges(child, own);
        }
        totalNodes = seen.size;
        totalEdges = edgeSet.size;
        truncated = included.size < seen.size || edgesOmitted > 0;
      } else {
        let complete = true;
        // a copy: liveSignal() forgets dead nodes during the loop
        for (const nodeId of Array.from(this._reactiveNodes.keys())) {
          if (included.size >= maxNodes && !included.has(nodeId)) {
            complete = false;
            break;
          }
          const signal = liveSignal(nodeId);
          if (!signal) continue;
          see(nodeId);
          walk(
            api.deps(signal),
            'deps',
            depId => addEdge(depId, nodeId),
            null,
            countUntracked(nodeId),
          );
          // tracked readers are found from their own deps; only template
          // readers need the reactions side
          walk(api.reactions(signal), 'reactions', null, t => addEdge(nodeId, t));
        }
        if (complete) for (const cid of this._instances.keys()) markupEdges(cid, null);
        // registered count (+ template nodes reached), minus nodes found
        // dead while building
        totalNodes = this._reactiveNodes.size + templates.size;
        totalEdges = complete ? edgeSet.size : null;
        truncated = !complete || edgesOmitted > 0;
      }

      const nodes = [];
      for (const nodeId of included) {
        const cid = templates.get(nodeId);
        if (cid !== undefined) {
          const instance = this._instances.get(cid);
          nodes.push({
            id: nodeId,
            type: 'template',
            name: '(template)',
            componentId: cid,
            componentFile: instance ? instance.file : '',
          });
          continue;
        }
        const signal = liveSignal(nodeId);
        if (!signal) continue;
        const node = this._graphNode(nodeId, this._reactiveNodes.get(nodeId), signal);
        if (untracked.has(nodeId)) node.untrackedDeps = untracked.get(nodeId);
        nodes.push(node);
      }
      return {
        scope: scoped ? componentId : null,
        nodes,
        edges,
        total: { nodes: totalNodes, nodesKind: 'registered', edges: totalEdges },
        truncated,
        edgesOmitted,
        policy: scoped ? 'scoped' : 'global-head',
      };
    },

    _graphCap(value, max) {
      const n = Math.floor(Number(value));
      return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : max;
    },

    // Whether a pull request names another page load (epoch): such a request
    // is not answered by this one.
    _otherEpoch(req) {
      return req.epoch !== undefined && req.epoch !== null && req.epoch !== this._epoch;
    },

    // Request: { requestId?, epoch?, componentId?,
    // maxNodes?, maxEdges? }. The reply echoes requestId and epoch; {} asks
    // for the global graph with the default caps.
    sendReactiveGraph(request) {
      const req = request ?? {};
      if (this._otherEpoch(req)) return;
      const cid = typeof req.componentId === 'number' ? req.componentId : null;
      const graph = this.getReactiveGraph(cid, { maxNodes: req.maxNodes, maxEdges: req.maxEdges });
      graph.epoch = this._epoch;
      // freshness: when this answer was built; caches keep it
      graph.computedAt = Date.now();
      if (req.requestId !== undefined) graph.requestId = req.requestId;
      this._send('svelte-devtools:reactive-graph', graph);
    },

    // Overview aggregate over the live scopes: each one's activity since it
    // was registered, cost O(scopes with activity), no graph, no node scan.
    // Rows rank by observed changes, then renders, then render ms, then the
    // most recently active; rows + other = total (components and nodes).
    getReactiveSummary(opts) {
      const topK = __clampInt(opts?.topK, 1, 200, 50);
      const ranked = [...this._activity].toSorted(
        (x, y) =>
          y[1].changes - x[1].changes ||
          y[1].renders - x[1].renders ||
          y[1].renderMs - x[1].renderMs ||
          y[1].lastActiveAt - x[1].lastActiveAt ||
          x[0] - y[0],
      );
      let rowNodes = 0;
      const rows = ranked.slice(0, topK).map(([cid, a]) => {
        const n = this._nodeCounts.get(cid) ?? { state: 0, derived: 0, effect: 0 };
        rowNodes += n.state + n.derived + n.effect;
        const row = {
          componentId: cid,
          file: this._scopeFile(cid),
          nodes: { state: n.state, derived: n.derived, effect: n.effect },
          changes: a.changes,
          renders: a.renders,
          renderMs: Math.round(a.renderMs * 1000) / 1000,
          lastActiveAt: a.lastActiveAt,
        };
        // module scope (shared .svelte.js state), not a component instance
        if (this._modules.has(cid)) row.kind = 'module';
        return row;
      });
      const t = this._nodeTotals;
      // module scopes count as rows like components (rows + other = total)
      const scopes = this._instances.size + this._modules.size;
      return {
        epoch: this._epoch,
        computedAt: Date.now(),
        policy: 'per-flush',
        coverage: 'component-init',
        components: { total: scopes, withActivity: this._activity.size },
        rows,
        other: {
          components: scopes - rows.length,
          nodes: t.state + t.derived + t.effect - rowNodes,
        },
        truncated: this._activity.size > topK,
        capabilities: { valueInspection: false, signalHistory: false, writeCause: false },
        // Seed coverage: changes of pending nodes are not observable yet.
        baseline: this._baselineInfo(),
      };
    },

    // Request { requestId?, epoch?, topK? } (same correlation as
    // the graph).
    sendReactiveSummary(request) {
      const req = request ?? {};
      if (this._otherEpoch(req)) return;
      const summary = this.getReactiveSummary(req);
      if (req.requestId !== undefined) summary.requestId = req.requestId;
      this._send('svelte-devtools:reactive-summary', summary);
    },

    // --- State timeline ---

    // Current value of a $state node: the signal value, or for proxy
    // nodes (non-reassigned object/array state) the live proxy itself.
    // Returns a sentinel when the value can't be read.
    _readStateValue(nodeId, signal) {
      if (signal._isProxy) {
        const proxy = this._reactiveProxies.get(nodeId)?.deref();
        return proxy === undefined ? __NO_VALUE : proxy;
      }
      if (this._api.isUninitialized(signal)) return __NO_VALUE;
      const v = this._api.signalValue(signal);
      // functions aren't state data
      return typeof v === 'function' ? __NO_VALUE : v;
    },

    // Observation, while a consumer watches. hooks.js marks a node written
    // once Svelte flushed (or committed) the batch that wrote it, also for
    // writes deep inside its $state proxy; several writes in one batch are
    // one change (policy 'per-flush'). The work runs in the next task, not
    // inside Svelte's flush: the written nodes, plus the first observation
    // (seed) of up to SEED_NODES new nodes, within BUDGET_MS; the rest
    // follows in another task, nothing is dropped. Values serializing above
    // MAX_SNAPSHOT_CHARS are kept as length+hash and appear in the timeline
    // as a summary.
    _scheduleObserve() {
      if (!this._active || this._observeTimer !== null) return;
      this._observeTimer = setTimeout(() => {
        this._observeTimer = null;
        this._observeStates();
      }, 0);
    },

    _observeStates() {
      const SEED_NODES = 4096;
      const BUDGET_MS = 2;
      const start = performance.now();
      const spent = () => performance.now() - start > BUDGET_MS;
      let seeds = 0;
      for (const nodeId of this._unseeded) {
        if (seeds >= SEED_NODES || spent()) break;
        seeds++;
        this._observe(nodeId);
      }
      for (const nodeId of this._written) {
        if (spent()) break;
        this._observe(nodeId);
      }
      if (!this._baselining && (this._unseeded.size > 0 || this._written.size > 0)) {
        this._scheduleObserve();
      }
      // seed progress changed: push it even without changes
      if (this._sentPendingNodes !== this._unseeded.size) this._scheduleTimelineUpdate();
    },

    // Compare a $state node's value with its last snapshot: a seed on the
    // first observation, else a timeline entry when it changed.
    _observe(nodeId) {
      this._written.delete(nodeId);
      const entry = this._reactiveNodes.get(nodeId);
      const signal = entry.signal.deref();
      const value = signal ? this._readStateValue(nodeId, signal) : __NO_VALUE;
      if (value === __NO_VALUE) {
        // nothing readable (collected, uninitialized, function): not pending
        this._unseeded.delete(nodeId);
        return;
      }
      if (value !== null && typeof value === 'object') {
        this._serializeNode(nodeId, entry, value);
        return;
      }
      const had = this._stateSnapshots.has(nodeId);
      const prev = this._stateSnapshots.get(nodeId);
      if (had && Object.is(prev, value)) return;
      // Forget the object key so object -> primitive -> same object again
      // is still recorded as a change.
      this._stateSnapshotStrs.delete(nodeId);
      if (!had) {
        // first observation: seed only
        this._stateSnapshots.set(nodeId, value);
        this._unseeded.delete(nodeId);
        return;
      }
      this._recordChange(
        nodeId,
        entry,
        prev,
        value,
        typeof value === 'string' ? 2 * value.length : 64,
      );
    },

    // Activation (late consumer): nodes registered while inactive have no
    // seed yet, so a write before their first observation could not be seen
    // as a change. The first slice is seeded at activation: ONE pass
    // (<= SEED_NODES nodes, the per-task budget; the rest follow in later
    // tasks). Seeds record nothing; readiness is disclosed in the summary as
    // baseline { complete, pendingNodes }.
    _observeBaseline() {
      this._baselining = true;
      try {
        this._observeStates();
      } catch {
        /* never break activation */
      } finally {
        this._baselining = false;
      }
    },

    _serializeNode(nodeId, entry, value) {
      const MAX_SNAPSHOT_CHARS = 32768;
      try {
        // Svelte's trap-free read: no proxy sources are created by devtools
        const str = JSON.stringify(this._api.snapshot(value));
        // Small values keep the string (exact compare); large ones only a
        // length+hash so a 5 MB array doesn't pin 5 MB per node.
        // (toJSON may return undefined: no JSON at all)
        const tooLarge = str !== undefined && str.length > MAX_SNAPSHOT_CHARS;
        const key = str === undefined ? '' : tooLarge ? str.length + ':' + __hash(str) : str;
        if (this._stateSnapshotStrs.get(nodeId) === key) return;
        this._stateSnapshotStrs.set(nodeId, key);
        let snapshot = null;
        let size = 64;
        if (tooLarge) {
          snapshot = '(object: ' + str.length + ' chars, too large to snapshot)';
        } else if (str !== undefined) {
          snapshot = JSON.parse(str);
          size = str.length;
        }
        if (!this._stateSnapshots.has(nodeId)) {
          // first observation: seed only (no entry, no counters)
          this._stateSnapshots.set(nodeId, snapshot);
          this._lastSnapshotSize.set(nodeId, size);
          this._unseeded.delete(nodeId);
          return;
        }
        if (tooLarge) this._valueTooLarge++;
        const prev = this._stateSnapshots.get(nodeId);
        this._recordChange(
          nodeId,
          entry,
          prev,
          snapshot,
          size + (this._lastSnapshotSize.get(nodeId) ?? 0),
        );
        this._lastSnapshotSize.set(nodeId, size);
      } catch {
        // non-serializable (cycles, BigInt): never observable, so not pending
        this._unseeded.delete(nodeId);
      }
    },

    _recordChange(nodeId, entry, oldValue, newValue, approxBytes) {
      const change = {
        id: nodeId,
        name: entry.meta.name,
        componentFile: entry.meta.componentFile,
        oldValue,
        newValue,
        timestamp: Date.now(),
      };
      // 0 (an empty string) or no estimate: assume a small value.
      const bytes = (approxBytes > 0 ? approxBytes : 64) + 192;
      // seq stays runtime-internal: the server assigns its own seq.
      this._entryInfo.set(change, { seq: ++this._timelineSeq, bytes });
      this._stateTimeline.push(change);
      this._timelineBytes += bytes;
      // observed change count: independent of the ring
      this._activityRow(entry.meta.componentId).changes++;
      this._stateSnapshots.set(nodeId, newValue);
      // The ring (_trimTimeline) is applied in bulk, not with one splice per
      // change (a poll tick can record thousands): before every read (each
      // push — with a hot channel and an active consumer, at least every 200
      // changes — the full snapshot, getStateTimeline() and clear), and here
      // once more than __TIMELINE_TRIM_AT entries are held or the byte budget
      // is exceeded, which bounds memory when nothing reads or pushes.
      if (
        this._stateTimeline.length > __TIMELINE_TRIM_AT ||
        this._timelineBytes > __TIMELINE_BYTES
      ) {
        this._trimTimeline();
      }
      this._scheduleTimelineUpdate();
    },

    // Ring: at most 500 entries and __TIMELINE_BYTES (the newest entry is
    // always kept). Removed entries that were never pushed are disclosed
    // as dropped; pushed ones are already on the server.
    _trimTimeline() {
      const all = this._stateTimeline;
      let cut = 0;
      let bytesLeft = this._timelineBytes;
      while (cut < all.length - 1 && (all.length - cut > 500 || bytesLeft > __TIMELINE_BYTES)) {
        const info = this._entryInfo.get(all[cut]);
        const reason = all.length - cut > 500 ? 'runtime-count' : 'runtime-bytes';
        if (info.seq > this._pushedSeq) this._timelineDropped[reason]++;
        bytesLeft -= info.bytes;
        cut++;
      }
      if (cut > 0) {
        all.splice(0, cut);
        this._timelineBytes = bytesLeft;
      }
    },

    // Push: a throttle, not a debounce — a pending timer is never
    // re-armed, so unsent entries leave within 300 ms of the first one even
    // under continuous change — plus an immediate flush once 200 entries
    // (one message) are unsent, since one poll tick can record thousands.
    _scheduleTimelineUpdate() {
      if (!this._active || this._baselining) return;
      if (this._timelineSeq - this._pushedSeq >= 200) {
        this._flushTimeline();
        return;
      }
      if (this._timelineDebounceTimer) return;
      this._timelineDebounceTimer = setTimeout(() => {
        this._timelineDebounceTimer = null;
        this._flushTimeline();
      }, 300);
    },

    _flushTimeline() {
      if (this._timelineDebounceTimer) {
        clearTimeout(this._timelineDebounceTimer);
        this._timelineDebounceTimer = null;
      }
      if (!this._hot) return;
      for (const msg of this._timelineDeltas()) {
        this._hot.send('svelte-devtools:state-timeline', msg);
      }
    },

    // Disclosure counters since the previous push, attached to (and reset
    // by) the next message: dropped [{ reason, count }] and valueTooLarge.
    _takeTimelineDisclosure(msg) {
      msg.baseline = this._baselineInfo();
      this._sentPendingNodes = msg.baseline.pendingNodes;
      const dropped = [];
      for (const reason of ['runtime-count', 'runtime-bytes']) {
        const count = this._timelineDropped[reason];
        if (count > 0) dropped.push({ reason, count });
        this._timelineDropped[reason] = 0;
      }
      if (dropped.length > 0) msg.dropped = dropped;
      if (this._valueTooLarge > 0) msg.valueTooLarge = this._valueTooLarge;
      this._valueTooLarge = 0;
      return msg;
    },

    // Seed coverage, on every state-timeline message and the
    // summary: pendingNodes = polled $state nodes without a first sample;
    // their writes are not observable yet.
    _baselineInfo() {
      return { complete: this._unseeded.size === 0, pendingNodes: this._unseeded.size };
    },

    _hasTimelineDisclosure() {
      return (
        this._sentPendingNodes !== this._unseeded.size ||
        this._timelineDropped['runtime-count'] > 0 ||
        this._timelineDropped['runtime-bytes'] > 0 ||
        this._valueTooLarge > 0
      );
    },

    // Delta push: only entries recorded
    // since the previous push, ≤ 200 per message, tagged with a per-page-load
    // epoch; reset after clearStateTimeline(). A message with no changes is
    // still sent when there is something to disclose (all unsent dropped).
    _timelineDeltas() {
      this._trimTimeline();
      const all = this._stateTimeline;
      let start = all.length;
      while (start > 0 && this._entryInfo.get(all[start - 1]).seq > this._pushedSeq) start--;
      const pending = all.slice(start);
      const msgs = [];
      const first = this._timelineReset || this._hasTimelineDisclosure();
      // A first message goes out even with no pending changes (disclosure only).
      const end = first ? Math.max(pending.length, 1) : pending.length;
      for (let i = 0; i < end; i += 200) {
        const msg = { epoch: this._epoch, changes: pending.slice(i, i + 200) };
        if (i === 0 && this._timelineReset) msg.reset = true;
        if (i === 0) this._takeTimelineDisclosure(msg);
        else msg.baseline = this._baselineInfo();
        msgs.push(msg);
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return msgs;
    },

    // Full buffer (reset: true) — reply to request-state-timeline and the
    // activation snapshot. Newest entries first up to __TIMELINE_BYTES, the
    // server's own buffer budget, so nothing is sent that it would drop.
    _timelineFull() {
      this._trimTimeline();
      const all = this._stateTimeline;
      let start = all.length;
      let bytes = 0;
      while (start > 0) {
        const size = this._entryInfo.get(all[start - 1]).bytes;
        if (bytes + size > __TIMELINE_BYTES && start < all.length) break;
        bytes += size;
        start--;
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return this._takeTimelineDisclosure({
        epoch: this._epoch,
        changes: all.slice(start),
        reset: true,
      });
    },

    getStateTimeline() {
      this._trimTimeline();
      return this._stateTimeline;
    },

    clearStateTimeline() {
      // Ring first: unsent entries past the cap are disclosed as dropped,
      // exactly as if they had been removed when recorded.
      this._trimTimeline();
      this._stateTimeline = [];
      this._timelineBytes = 0;
      this._pushedSeq = this._timelineSeq;
      this._timelineReset = true;
      this._scheduleTimelineUpdate();
    },

    _send(event, data) {
      if (this._hot) this._hot.send(event, data);
    },

    // --- FPS monitoring ---
    // Uses requestAnimationFrame to measure frame rate with minimal overhead.
    // Only stores timestamps - no allocations per frame beyond a single array push.
    _fpsFrameTimes: [],

    _fpsLoop(gen) {
      if (gen !== this._fpsGen) return;
      this._fpsFrameTimes.push(performance.now());
      requestAnimationFrame(() => this._fpsLoop(gen));
    },

    _isVisible() {
      if (document === undefined) return true;
      return document.visibilityState !== 'hidden';
    },

    _setSubscription(data) {
      const wasActive = this._active;
      this._active = !!data?.active;
      this._componentDeltas = !!data?.componentDeltas;
      if (!this._active) {
        this._pendingAdded.clear();
        this._pendingRemoved.clear();
      }
      // resync: the server holds no full base for this epoch, or we reconnected to a possibly restarted server.
      const resync = this._resync || !!data?.resync;
      this._resync = false;
      if (this._active && !wasActive) {
        this._observeBaseline();
        this._scheduleObserve();
      }
      if (this._active && (!wasActive || resync)) {
        // Collector state may be stale or empty (first activation, resync, or a
        // reconnect to a possibly restarted server): resend everything once, in
        // the order components -> profiles -> timeline(reset: true); the
        // reset push marks the activation snapshot complete.
        this._sendUpdate(true);
        this._sendProfileUpdate();
        this._send('svelte-devtools:state-timeline', this._timelineFull());
      }
      this._syncSampling();
    },

    // FPS sampling runs only while active AND the app tab is visible.
    _syncSampling() {
      const want = this._active && this._isVisible();
      if (want && !this._sampling) {
        this._fpsFrameTimes = [];
        const gen = ++this._fpsGen;
        this._sampling = {
          fps: setInterval(() => {
            this._sampleFps();
          }, 500),
        };
        requestAnimationFrame(() => this._fpsLoop(gen));
      } else if (!want && this._sampling) {
        clearInterval(this._sampling.fps);
        this._sampling = null;
        this._fpsGen++;
        this._fpsFrameTimes = [];
      }
    },

    _sampleFps() {
      const now = performance.now();
      // Remove frame timestamps older than 1 second
      const cutoff = now - 1000;
      let i = 0;
      while (i < this._fpsFrameTimes.length && this._fpsFrameTimes[i] < cutoff) i++;
      if (i > 0) this._fpsFrameTimes.splice(0, i);
      const fps = this._fpsFrameTimes.length;
      this._send('svelte-devtools:fps', { timestamp: Date.now(), fps });
    },
  };

  // FPS sampling starts on the server's subscription message and pauses
  // while the app tab is hidden.
  if (document !== undefined && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => store._syncSampling());
  }

  // Runtime errors
  window.addEventListener('error', event => {
    store._send('svelte-devtools:runtime-error', {
      message: event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack ?? '',
      timestamp: Date.now(),
    });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason?.message;
    const stack = reason?.stack;
    store._send('svelte-devtools:runtime-error', {
      // No (or an empty / non-string) message: the stringified reason.
      message: typeof message === 'string' && message !== '' ? message : __describe(reason),
      stack: typeof stack === 'string' ? stack : '',
      timestamp: Date.now(),
    });
  });

  return store;
}

/** Attaches the HMR channel to the dev server (`import.meta.hot`) to a store. */
export function connectHot(dt, hot) {
  dt._hot = hot;
  // Pull requests from the server are answered regardless of the
  // subscription state.
  hot.on('svelte-devtools:subscription', data => {
    dt._setSubscription(data);
  });
  hot.on('vite:ws:connect', () => {
    // The server may have restarted with an empty collector: the reply to
    // runtime-ready is treated as a fresh activation (full snapshot).
    dt._resync = true;
    hot.send('svelte-devtools:runtime-ready', {});
  });
  hot.send('svelte-devtools:runtime-ready', {});
  hot.on('svelte-devtools:request-reactive-graph', data => {
    dt.sendReactiveGraph(data);
  });
  hot.on('svelte-devtools:request-reactive-summary', data => {
    dt.sendReactiveSummary(data);
  });
  hot.on('svelte-devtools:request-state-timeline', () => {
    hot.send('svelte-devtools:state-timeline', dt._timelineFull());
  });
  hot.on('svelte-devtools:clear-state-timeline', () => {
    dt.clearStateTimeline();
  });
}
