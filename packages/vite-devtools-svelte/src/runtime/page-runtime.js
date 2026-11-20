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

// [A-Za-z_$], plus [0-9] after the first character (Svelte's identifier test
// for proxy labels).
function __isIdentChar(ch, first) {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    ch === '$' ||
    (!first && ch >= '0' && ch <= '9')
  );
}

function __segmentEnd(label, i) {
  return i === label.length || label[i] === '.' || label[i] === '[';
}

// Dense id lists (an array plus id -> position) for cursor-driven sweeps.
function __denseAdd(ids, index, id) {
  if (index.has(id)) return;
  index.set(id, ids.length);
  ids.push(id);
}

// O(1): the last id takes the removed slot. If that slot is behind a sweep
// cursor, the moved id is visited in the next sweep instead of this one.
function __denseRemove(ids, index, id) {
  const i = index.get(id);
  if (i === undefined) return;
  const last = ids.pop();
  index.delete(id);
  if (i < ids.length) {
    ids[i] = last;
    index.set(last, i);
  }
}

// String() throws for a null-prototype object or a throwing toString.
function __describe(value) {
  try {
    return String(value);
  } catch {
    return '(unprintable value)';
  }
}

function __componentEntry(instance) {
  return {
    id: instance.id,
    file: instance.file,
    name: instance.name,
    parentId: instance.parentId,
    mounted: true,
  };
}

// Approximate, for cost-adaptive throttling.
function __componentBytes(instance) {
  return instance.file.length + instance.name.length + 72;
}

// The k smallest items by `compare`, sorted: O(n log k), so a page with many long-lived
// scopes does not sort them all on every summary poll.
function __topK(items, k, compare) {
  const top = [];
  for (const item of items) {
    if (top.length === k && compare(item, top[k - 1]) >= 0) continue;
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(item, top[mid]) < 0) hi = mid;
      else lo = mid + 1;
    }
    top.splice(lo, 0, item);
    if (top.length > k) top.pop();
  }
  return top;
}

function __clampInt(v, lo, hi, d) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

if (typeof window !== 'undefined' && !window.__SVELTE_DEVTOOLS__) {
  const __NO_VALUE = Symbol('no value');
  // State timeline ring: every read sees at most __TIMELINE_CAP entries and
  // __TIMELINE_BYTES (both the server's budgets, which a `?raw` file cannot
  // import); the raw array may reach __TIMELINE_TRIM_AT between bulk trims.
  const __TIMELINE_CAP = 500;
  const __TIMELINE_BYTES = 4 * 1024 * 1024;
  const __TIMELINE_TRIM_AT = 2 * __TIMELINE_CAP;
  // entries per HMR message
  const __TIMELINE_BATCH = 200;
  // Members the wrapper and the injected code use have no underscore. The perf
  // scripts and tests also read underscore members, so update them on a rename.
  const __SVELTE_DT = {
    _nextId: 0,
    _instances: new Map(),
    // Set by the component transform right before the component's push().
    pendingFile: null,
    _componentsTimer: null,

    _profiles: new Map(),
    _initStartTimes: new Map(),
    _profilesTimer: null,

    _reactiveNodes: new Map(),
    _reactiveProxies: new Map(),

    // Lets unmount purge a component's nodes without scanning every node.
    _nodesByComponent: new Map(),

    _stateTimeline: [],
    // For objects the compare key is the JSON string, or length+hash when large.
    _stateSnapshots: new Map(),
    _stateSnapshotStrs: new Map(),
    _timelineTimer: null,
    // A scoped graph resolves dependencies without scanning every node.
    _idBySignal: new WeakMap(),
    _idByProxy: new WeakMap(),
    // Set by the wrapper on mount.
    idByContext: new WeakMap(),
    // Svelte's FILENAME symbol, set by the wrapper: `ctx.function[filenameSymbol]`
    // is relative like `__svelte_meta` files.
    filenameSymbol: null,
    // Names declared more than once per instance ({@const} in {#each} items,
    // several $state class instances).
    _nameSeq: new Map(),
    // Signals created while a .svelte.js/.ts module body runs belong to a scope
    // per module file. Ids come from the component id counter (never reused)
    // but scopes are not in _instances / the tree, and live as long as the page.
    _modules: new Map(),
    _moduleByFile: new Map(),
    // Svelte labels a proxy's property source '<name>.prop' in dev; this resolves
    // it to its proxy's node (a tag_proxy node, or a state signal holding a proxy).
    _proxyNames: new Map(),
    // Set by the module transform.
    moduleFile: null,
    // Effect names are numbered per component, so instances of one file match.
    _effectSeq: new Map(),
    // For the incremental liveness sweep.
    _sweepIds: [],
    _sweepIndex: new Map(),
    _sweepCursor: 0,
    _sweepDebt: 0,
    _sweepScheduled: false,
    // _pollDirty: found changed but not yet serialized. _pollMeta: per-node
    // change hints ({ ref, wv, nextCheckAt, nextSampleAt }).
    _pollIds: [],
    _pollIndex: new Map(),
    _pollCursor: 0,
    _pollDirty: new Set(),
    _pollMeta: new Map(),
    _deepCredit: 0,
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

    // Overview aggregate, O(1) per event. _activity: per live scope, totals
    // since it was registered; a destroyed instance takes them with it.
    _nodeCounts: new Map(),
    _nodeTotals: { state: 0, derived: 0, effect: 0 },
    _activity: new Map(),
    _epoch: Math.random().toString(36).slice(2) + Date.now().toString(36),

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
    _profilesCap: 5000,
    _sampling: null,
    _baselining: false,
    // A first observation is a seed, not a change (no timeline entry, activity
    // count or drops): the old value is unknown, not null.
    _unseeded: new Set(),
    // pendingNodes on the last state-timeline message; null = none sent yet
    _sentPendingNodes: null,
    _fpsGen: 0,

    register(file, parentHint) {
      const id = this._nextId++;
      // The wrapper's hint can name an unmounted component: idByContext is a
      // WeakMap nobody clears on unmount, so only a live instance is a parent.
      const parentId = this._instances.has(parentHint) ? parentHint : null;
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
      if (this._active) this._pendingAdded.add(id);
      this._scheduleComponentsUpdate();
      return id;
    },

    unmount(id) {
      this._removeInstance(id);
      this._scheduleComponentsUpdate();
      this._scheduleProfilesUpdate();
    },

    // A component whose init threw (the wrapper unwinds its stack): it never
    // mounted and never will, so it leaves the tree.
    abortInit(id) {
      this._removeInstance(id);
      this._scheduleComponentsUpdate();
    },

    _removeInstance(id) {
      const instance = this._instances.get(id);
      if (!instance) return;
      if (instance.parentId !== null) this._instances.get(instance.parentId)?.children.delete(id);
      this._removeDescendants(id);
      this._cleanupComponent(id);
    },

    // Remounts get a fresh id, so entries keyed by a dead id would otherwise
    // survive forever: every per-component map must be purged here.
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
      const proxy = this._reactiveProxies.get(nodeId)?.deref();
      if (proxy && this._idByProxy.get(proxy) === nodeId) this._idByProxy.delete(proxy);
      if (entry?.meta.type === 'state') {
        const named = this._proxyNames.get(entry.meta.name);
        const inScope = named?.get(entry.meta.componentId);
        if (inScope) {
          inScope.delete(nodeId);
          if (inScope.size === 0) named.delete(entry.meta.componentId);
          if (named.size === 0) this._proxyNames.delete(entry.meta.name);
        }
      }
      this._pollRemove(nodeId);
      this._sweepRemove(nodeId);
      this._pollDirty.delete(nodeId);
      this._reactiveNodes.delete(nodeId);
      this._reactiveProxies.delete(nodeId);
      this._stateSnapshots.delete(nodeId);
      this._stateSnapshotStrs.delete(nodeId);
      this._pollMeta.delete(nodeId);
      this._lastSnapshotSize.delete(nodeId);
    },

    _scopeLive(id) {
      return this._instances.has(id) || this._modules.has(id);
    },

    _scopeFile(id) {
      const scope = this._instances.get(id) ?? this._modules.get(id);
      return scope ? scope.file : '';
    },

    enterModule(file) {
      this.moduleFile = file;
      // a module body that throws (or awaits) never reaches leaveModule
      queueMicrotask(() => {
        if (this.moduleFile === file) this.moduleFile = null;
      });
    },

    leaveModule() {
      this.moduleFile = null;
    },

    trackModuleSignal(kind, target, name) {
      const file = this.moduleFile;
      let id = this._moduleByFile.get(file);
      if (id === undefined) {
        id = this._nextId++;
        this._modules.set(id, { file });
        this._moduleByFile.set(file, id);
      }
      if (kind === 'proxy') this.trackProxy(target, name, id, null);
      else if (kind === 'derived') this.trackDerived(target, name, id, null);
      else this.trackState(target, name, id, null);
    },

    // Svelte nulls effect.fn when it destroys an effect (destroy_effect); that
    // is checked instead of the internal DESTROYED flag value.
    _liveSignal(nodeId) {
      const entry = this._reactiveNodes.get(nodeId);
      if (!entry) return null;
      const signal = entry.signal.deref();
      if (signal && this._scopeLive(entry.meta.componentId) && this._ownerAlive(entry)) {
        if (!entry.boundEffect) return signal;
        // a bound effect is destroyed when Svelte clears its callback
        if (signal.fn !== null) return signal;
      }
      this._forgetNode(nodeId);
      return null;
    },

    _ownerAlive(entry) {
      if (!entry.owner) return true;
      const owner = entry.owner.deref();
      return !!owner && owner.fn !== null;
    },

    _sweepAdd(nodeId) {
      __denseAdd(this._sweepIds, this._sweepIndex, nodeId);
    },

    _sweepRemove(nodeId) {
      __denseRemove(this._sweepIds, this._sweepIndex, nodeId);
    },

    // Nodes of destroyed {#each} items / effect runs leave the counts and the
    // graph without waiting for a graph request or GC.
    _sweepNodes(max) {
      const ids = this._sweepIds;
      for (let n = 0; n < max && ids.length > 0; n++) {
        if (this._sweepCursor >= ids.length) this._sweepCursor = 0;
        const nodeId = ids[this._sweepCursor];
        // a forgotten node's slot is refilled by the last id: re-check it
        if (this._liveSignal(nodeId)) this._sweepCursor++;
      }
    },

    // componentId:name#k when this instance already holds a live node of that
    // name for another signal. The same signal (re-tagged) keeps its id.
    _nodeIdFor(identity, byIdentity, componentId, name) {
      const known = byIdentity.get(identity);
      if (known !== undefined && this._reactiveNodes.has(known)) return known;
      const base = componentId + ':' + name;
      if (!this._liveSignal(base)) return base;
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
      } while (this._liveSignal(id));
      seq.set(name, k);
      return id;
    },

    // The poll's sweep only runs while DevTools is open, so churn pays for its
    // own cleanup: 2 visits per track, in a later task to keep mounts fast.
    // Tracks during a component's init are skipped: its nodes leave with it,
    // and churn ({#each} items, effect re-runs) tracks after init.
    // A dead node whose id is reused before the sweep is forgotten by _nodeIdFor.
    _sweepOnTrack(componentId) {
      if (this._sampling || this._initStartTimes.has(componentId)) return;
      this._sweepDebt += 2;
      this._scheduleSweep();
    },

    _scheduleSweep() {
      if (this._sweepScheduled) return;
      this._sweepScheduled = true;
      setTimeout(() => this._sweepDeferred(), 0);
    },

    _sweepDeferred() {
      const BUDGET_MS = 2;
      const CHUNK = 64;
      this._sweepScheduled = false;
      // more than 2 visits per node finds nothing new
      this._sweepDebt = this._sampling ? 0 : Math.min(this._sweepDebt, 2 * this._sweepIds.length);
      const start = performance.now();
      while (this._sweepDebt > 0 && performance.now() - start < BUDGET_MS) {
        const n = Math.min(CHUNK, this._sweepDebt);
        this._sweepNodes(n);
        this._sweepDebt -= n;
      }
      if (this._sweepDebt > 0) this._scheduleSweep();
    },

    _registerNode(nodeId, componentId, type, name, signalRef, owner) {
      this._trackNodeCount(nodeId, componentId, type);
      this._reactiveNodes.set(nodeId, {
        signal: signalRef,
        owner: owner ? new WeakRef(owner) : null,
        meta: { id: nodeId, type, name, componentId, componentFile: this._scopeFile(componentId) },
      });
      this._indexNode(nodeId, componentId);
      this._sweepAdd(nodeId);
    },

    _indexNode(nodeId, componentId) {
      let set = this._nodesByComponent.get(componentId);
      if (!set) {
        set = new Set();
        this._nodesByComponent.set(componentId, set);
      }
      set.add(nodeId);
    },

    _pollAdd(nodeId) {
      if (this._pollIndex.has(nodeId)) return;
      if (!this._stateSnapshots.has(nodeId)) this._unseeded.add(nodeId);
      __denseAdd(this._pollIds, this._pollIndex, nodeId);
    },

    _pollRemove(nodeId) {
      this._unseeded.delete(nodeId);
      __denseRemove(this._pollIds, this._pollIndex, nodeId);
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

    _activityRow(componentId) {
      let r = this._activity.get(componentId);
      if (!r) {
        r = { changes: 0, renders: 0, renderMs: 0, lastActiveAt: 0 };
        this._activity.set(componentId, r);
      }
      r.lastActiveAt = Date.now();
      return r;
    },

    _removeDescendants(parentId) {
      const parent = this._instances.get(parentId);
      if (!parent) return;
      // a copy: _cleanupComponent() changes this set
      for (const childId of Array.from(parent.children)) {
        this._removeDescendants(childId);
        this._cleanupComponent(childId);
      }
    },

    // Full-list pushes are throttled: a pending timer is not reset, so
    // continuous churn still produces updates, and the interval adapts to the
    // last push's cost so a 10 000+ instance app can't spend its main thread
    // serializing.
    _componentsInterval() {
      const cost = this._componentsCost;
      return Math.max(100, 20 * cost.ms, cost.bytes > 1000000 ? 1000 : 0);
    },

    _scheduleComponentsUpdate() {
      if (!this._active || this._componentsTimer) return;
      this._componentsTimer = setTimeout(() => {
        this._componentsTimer = null;
        this._sendComponentsUpdate();
      }, this._componentsInterval());
    },

    // The full form replaces the server's tree for this epoch. Deltas send
    // removed ids first, then added in registration order (parents first).
    _sendComponentsUpdate(forceFull) {
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

    startInit(id) {
      this._initStartTimes.set(id, performance.now());
    },

    endInit(id) {
      const start = this._initStartTimes.get(id);
      if (start === undefined) return;
      const initTime = performance.now() - start;
      this._initStartTimes.delete(id);
      if (!this._newProfile(id, initTime)) return;
      this._scheduleProfilesUpdate();
    },

    recordRender(id, duration = 0) {
      const profile = this._profiles.get(id) ?? this._newProfile(id, 0);
      if (!profile) return;
      profile.renderCount++;
      profile.totalRenderTime += duration;
      profile.lastRenderTime = duration;
      profile.lastRenderAt = Date.now();
      const row = this._activityRow(id);
      row.renders++;
      row.renderMs += duration;
      this._scheduleProfilesUpdate();
    },

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

    // Profiles push, throttled like components, but the floor grows with the
    // payload: every push carries the whole retained map, so a large app
    // coalesces bursts instead of resending ~1 MB twice a second. Hard cap
    // 2 s: a slow serialization must not stretch the latency beyond it.
    _profilesInterval() {
      const cost = this._profilesCost;
      return Math.min(
        2000,
        Math.max(500, 20 * cost.ms, cost.bytes > 1000000 ? 2000 : cost.bytes > 250000 ? 1000 : 0),
      );
    },

    _scheduleProfilesUpdate() {
      if (!this._active || this._profilesTimer) return;
      this._profilesTimer = setTimeout(() => {
        this._profilesTimer = null;
        this._sendProfilesUpdate();
      }, this._profilesInterval());
    },

    // Also the forced path (activation / resync): a pending throttled push is
    // cancelled so the same state is not sent twice.
    _sendProfilesUpdate() {
      if (this._profilesTimer) {
        clearTimeout(this._profilesTimer);
        this._profilesTimer = null;
      }
      if (!this._active) return;
      const t0 = performance.now();
      const all = Array.from(this._profiles.values());
      // Exactly what the collector retains: its tail, in the same order.
      const profiles =
        all.length > this._profilesCap ? all.slice(all.length - this._profilesCap) : all;
      this._send('svelte-devtools:profiles', { epoch: this._epoch, profiles, total: all.length });
      // Payload size from a small sample (entries differ mainly by file path).
      const k = Math.min(8, profiles.length);
      let sampled = 0;
      for (let i = 0; i < k; i++) sampled += JSON.stringify(profiles[i]).length;
      const bytes = k > 0 ? Math.round((sampled / k) * profiles.length) : 0;
      this._profilesCost = { ms: performance.now() - t0, bytes };
    },

    // `owner`: the effect active when the signal was created; the node dies
    // with it (an {#each} item's {@const}, a class instance created in an effect run).
    trackState(signal, name, componentId, owner) {
      this._sweepOnTrack(componentId);
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'state', name, new WeakRef(signal), owner);
      this._idBySignal.set(signal, nodeId);
      this._nameProxyRoot(nodeId, name, componentId);
      this._pollAdd(nodeId);
    },

    trackProxy(proxy, name, componentId, owner) {
      this._sweepOnTrack(componentId);
      const nodeId = this._nodeIdFor(proxy, this._idByProxy, componentId, name);
      this._reactiveProxies.set(nodeId, new WeakRef(proxy));
      // The proxy itself stays weakly held (_reactiveProxies). The marker is
      // held strongly so the node is not GC-dropped while the component lives;
      // _cleanupComponent removes it on unmount.
      const marker = { v: '(proxy)', _isProxy: true };
      this._registerNode(nodeId, componentId, 'state', name, { deref: () => marker }, owner);
      this._idBySignal.set(marker, nodeId);
      this._idByProxy.set(proxy, nodeId);
      this._nameProxyRoot(nodeId, name, componentId);
      this._pollAdd(nodeId);
    },

    trackDerived(signal, name, componentId, owner) {
      this._sweepOnTrack(componentId);
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'derived', name, new WeakRef(signal), owner);
      this._idBySignal.set(signal, nodeId);
    },

    // The effect object may not exist yet (deferred to mount): the node holds a
    // placeholder until bindEffect() is called on the effect's first run.
    trackUserEffect(kind, componentId, owner) {
      this._sweepOnTrack(componentId);
      let seq = this._effectSeq.get(componentId);
      if (!seq) {
        seq = { effect: 0, effect_pre: 0 };
        this._effectSeq.set(componentId, seq);
      }
      const name = kind + '_' + ++seq[kind];
      const nodeId = componentId + ':' + name;
      const placeholder = { v: undefined };
      this._registerNode(nodeId, componentId, 'effect', name, { deref: () => placeholder }, owner);
      return nodeId;
    },

    bindEffect(nodeId, effect) {
      const entry = nodeId !== null && this._reactiveNodes.get(nodeId);
      if (!entry || !effect || typeof effect !== 'object') return;
      entry.signal = new WeakRef(effect);
      entry.boundEffect = true;
      this._idBySignal.set(effect, nodeId);
    },

    // The component's mount hook effect (the wrapper's, created at pop): its
    // parent is the effect the component's markup effects were created in.
    setComponentEffect(id, effect) {
      const instance = this._instances.get(id);
      if (instance) instance.hook = new WeakRef(effect);
    },

    // Template effects are the ones under the hook's parent created in the
    // component's context (effect.ctx). Svelte links child effects via first/next.
    _markupEffects(id) {
      const instance = this._instances.get(id);
      const hook = instance?.hook?.deref();
      if (!hook?.ctx || !hook.parent) return [];
      const ctx = hook.ctx;
      const out = [];
      const stack = [];
      for (let e = hook.parent.first; e; e = e.next) stack.push(e);
      while (stack.length > 0) {
        const e = stack.pop();
        if (e === hook || e.ctx !== ctx) continue;
        if (e.deps && !this._idBySignal.has(e)) out.push(e);
        for (let c = e.first; c; c = c.next) stack.push(c);
      }
      return out;
    },

    // Svelte (dev) labels a proxy's sources after the proxy's path
    // ('todos[0].text', 'todos version'); the root is a $state node name. Many
    // live nodes may share the name (one per instance), so candidates are looked
    // up per scope (reader, ancestors since props flow down, modules, then all),
    // each narrowed by the source's value at that path.
    _sourceOwner(source, readerCid, liveSignal) {
      const label = source.label;
      if (typeof label !== 'string' || this._proxyNames.size === 0) return null;
      let named = null;
      let rest = '';
      for (let i = label.length; i > 0; i--) {
        const ch = i === label.length ? '' : label[i];
        if (ch !== '' && ch !== '.' && ch !== '[' && ch !== ' ') continue;
        named = this._proxyNames.get(label.slice(0, i));
        if (named) {
          rest = label.slice(i);
          break;
        }
      }
      if (!named) return null;
      let path;
      // live candidates whose value at the source's path is the source's
      // value; without a property path (' version'), all live candidates
      const fits = ids => {
        const live = [...ids].filter(id => liveSignal(id));
        if (live.length === 0) return live;
        if (path === undefined) path = this._labelPath(rest);
        if (!path) return live;
        const v = source.v;
        return live.filter(id => {
          const at = this._valueAt(this._rootValue(id), path);
          return (
            at !== __NO_VALUE && (Object.is(at, v) || (typeof v === 'symbol' && at === undefined))
          );
        });
      };
      const scopes = [];
      for (let cid = readerCid; cid !== null && cid !== undefined;) {
        scopes.push(cid);
        const instance = this._instances.get(cid);
        cid = instance ? instance.parentId : null;
      }
      // Iterated from the module list, not from `named`: a name shared by every
      // row of a list would make this O(n²) per graph build.
      for (const cid of this._modules.keys()) if (named.has(cid)) scopes.push(cid);
      for (const cid of scopes) {
        const ids = named.get(cid);
        const found = ids ? fits(ids) : [];
        if (found.length > 0) return found[0];
      }
      // not in the reader's ancestry or a module: any matching node, else the
      // nearest live one by name
      const all = [];
      for (const ids of named.values()) for (const id of ids) all.push(id);
      const found = fits(all);
      if (found.length > 0) return found[0];
      for (const cid of scopes)
        for (const id of named.get(cid) ?? []) if (liveSignal(id)) return id;
      return all.find(id => liveSignal(id)) ?? null;
    },

    // Svelte's labels: `.prop` for an identifier, `[0]` for an index, `['prop']`
    // otherwise. The quoted name is not escaped, so it ends at the first `']`
    // followed by the next segment or the end.
    _labelPath(rest) {
      const path = [];
      let i = 0;
      while (i < rest.length) {
        let end;
        if (rest[i] === '.') {
          end = i + 1;
          while (end < rest.length && __isIdentChar(rest[end], end === i + 1)) end++;
          if (end === i + 1) return null;
          path.push(rest.slice(i + 1, end));
        } else if (rest.startsWith("['", i)) {
          end = rest.indexOf("']", i + 2);
          while (end !== -1 && !__segmentEnd(rest, end + 2)) end = rest.indexOf("']", end + 1);
          if (end === -1) return null;
          path.push(rest.slice(i + 2, end));
          end += 2;
        } else if (rest[i] === '[') {
          end = i + 1;
          while (end < rest.length && rest[end] >= '0' && rest[end] <= '9') end++;
          if (end === i + 1 || rest[end] !== ']') return null;
          path.push(rest.slice(i + 1, end));
          end++;
        } else {
          return null;
        }
        if (!__segmentEnd(rest, end)) return null;
        i = end;
      }
      return path;
    },

    // Own-property walk (getOwnPropertyDescriptor does not create sources on
    // a Svelte proxy, unlike reading a missing property).
    _valueAt(obj, path) {
      let v = obj;
      for (const key of path) {
        if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return __NO_VALUE;
        let d;
        try {
          d = Object.getOwnPropertyDescriptor(v, key);
        } catch {
          return __NO_VALUE;
        }
        if (!d) return __NO_VALUE;
        v = 'value' in d ? d.value : __NO_VALUE;
        if (v === __NO_VALUE) return v;
      }
      return v;
    },

    _nameProxyRoot(nodeId, name, componentId) {
      let named = this._proxyNames.get(name);
      if (!named) {
        named = new Map();
        this._proxyNames.set(name, named);
      }
      let inScope = named.get(componentId);
      if (!inScope) {
        inScope = new Set();
        named.set(componentId, inScope);
      }
      inScope.add(nodeId);
    },

    // The proxy a $state node holds now (tag_proxy: the proxy itself; a
    // state signal: its current value), or undefined.
    _rootValue(nodeId) {
      const proxy = this._reactiveProxies.get(nodeId);
      if (proxy) return proxy.deref();
      const signal = this._reactiveNodes.get(nodeId)?.signal.deref();
      return signal ? signal.v : undefined;
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
      } else if (node.type === 'derived' && typeof signal.v === 'symbol') {
        // Svelte computes a derived lazily: until something reads it, v is
        // the UNINITIALIZED marker (a symbol)
        node.unevaluated = true;
      } else if (node.type !== 'effect') {
        const v = signal.v;
        if (
          typeof v === 'number' ||
          typeof v === 'string' ||
          typeof v === 'boolean' ||
          v === null
        ) {
          node.value = v;
        } else if (v !== undefined && typeof v !== 'symbol') {
          node.value = '(object)';
        }
      }
      return node;
    },

    // Caps are applied while building: past maxNodes no node objects are created.
    //  - scoped: dependencies resolve through _idBySignal, so the cost is
    //    O(scope + neighbours), not O(all nodes). The walk completes even past
    //    the cap, so total.nodes/edges are exact.
    //  - global: nodes past the cap are not dereferenced; total.nodes is the
    //    registered count (may include collected signals) and total.edges is
    //    null when the walk stopped early (not guessed).
    // The compiler turns every dynamic part of the markup into effects that are
    // not tracked one by one; their reads become edges to a synthetic
    // '<componentId>:(template)' node (via effect.ctx), so a value only the
    // markup reads is not shown without readers.
    getReactiveGraph(componentId, caps) {
      const scoped = componentId !== undefined && componentId !== null;
      const maxNodes = this._graphCap(caps?.maxNodes, 5000);
      const maxEdges = this._graphCap(caps?.maxEdges, 20000);
      const live = new Map();
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
      const templates = new Map();
      // No reactions: not a derived.
      const templateOf = effect => {
        if (!effect || 'reactions' in effect || !effect.ctx) return null;
        const cid = this.idByContext.get(effect.ctx);
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
      // Signals devtools does not track (created in node_modules, e.g.
      // SvelteKit's page state, or outside any component/module body):
      // reported so such a node is not "isolated".
      const untracked = new Map();
      // Walks through untracked intermediates until tracked nodes are reached;
      // an untracked leaf source (a proxy's property) resolves to its proxy's node.
      const walk = (start, field, onHit, onTemplate, readerCid, onUntracked) => {
        if (!start) return;
        const visited = new Set();
        const queue = [...start];
        // Index cursor instead of queue.shift(): shift is O(queue) per pop.
        for (let qi = 0; qi < queue.length; qi++) {
          const dep = queue[qi];
          if (!dep || visited.has(dep)) continue;
          visited.add(dep);
          const id = idOf(dep);
          if (id) {
            if (onHit) onHit(id);
          } else if (dep[field]) {
            for (const d of dep[field]) queue.push(d);
          } else if (onTemplate) {
            const t = templateOf(dep);
            if (t) onTemplate(t);
          } else if (field === 'deps' && onHit && !('fn' in dep)) {
            const owner = this._sourceOwner(dep, readerCid, liveSignal);
            if (owner) onHit(owner);
            else if (onUntracked) onUntracked();
          }
        }
      };
      const nodeCid = nodeId => this._reactiveNodes.get(nodeId).meta.componentId;
      const countUntracked = nodeId => () =>
        untracked.set(nodeId, (untracked.get(nodeId) ?? 0) + 1);
      const markupEdges = (cid, filter) => {
        const effects = this._markupEffects(cid);
        if (effects.length === 0) return;
        const t = cid + ':(template)';
        for (const effect of effects) {
          walk(
            effect.deps,
            'deps',
            id => {
              if (filter && !filter(id)) return;
              templates.set(t, cid);
              addEdge(id, t);
            },
            null,
            cid,
          );
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
            signal.deps,
            'deps',
            depId => addEdge(depId, nodeId),
            null,
            componentId,
            countUntracked(nodeId),
          );
          const toReader = rId => addEdge(nodeId, rId);
          walk(signal.reactions, 'reactions', toReader, toReader);
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
              walk(signal.deps, 'deps', depId => own(depId) && addEdge(depId, nodeId), null, child);
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
            signal.deps,
            'deps',
            depId => addEdge(depId, nodeId),
            null,
            nodeCid(nodeId),
            countUntracked(nodeId),
          );
          // tracked readers are found from their own deps; only template
          // readers need the reactions side
          walk(signal.reactions, 'reactions', null, t => addEdge(nodeId, t));
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

    // A request naming another page load (epoch) is not answered by this one.
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

    // O(scopes with activity), no graph, no node scan.
    getReactiveSummary(opts) {
      const topK = __clampInt(opts?.topK, 1, 200, 50);
      const ranked = __topK(
        this._activity,
        topK,
        (x, y) =>
          y[1].changes - x[1].changes ||
          y[1].renders - x[1].renders ||
          y[1].renderMs - x[1].renderMs ||
          y[1].lastActiveAt - x[1].lastActiveAt ||
          x[0] - y[0],
      );
      let rowNodes = 0;
      const rows = ranked.map(([cid, a]) => {
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
        policy: 'sampled-200ms',
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

    // Request { requestId?, epoch?, topK? } (same correlation as the graph).
    sendReactiveSummary(request) {
      const req = request ?? {};
      if (this._otherEpoch(req)) return;
      const summary = this.getReactiveSummary(req);
      if (req.requestId !== undefined) summary.requestId = req.requestId;
      this._send('svelte-devtools:reactive-summary', summary);
    },

    // tag_proxy nodes (non-reassigned object/array state) hold the live proxy itself.
    _readStateValue(nodeId, signal) {
      if (signal._isProxy) {
        const proxy = this._reactiveProxies.get(nodeId)?.deref();
        return proxy === undefined ? __NO_VALUE : proxy;
      }
      const v = signal.v;
      // Svelte's UNINITIALIZED marker is a symbol; functions aren't state data.
      return typeof v === 'symbol' || typeof v === 'function' ? __NO_VALUE : v;
    },

    // Runs every 200 ms in the user's app, so it must stay cheap regardless of
    // how much state the app holds:
    //  1. The hint pass is time-sliced (HINT_NODES per tick from a carried
    //     cursor). Objects whose reference or Svelte write version (wv) changed
    //     go to _pollDirty, which persists across ticks until serialized.
    //  2. Serialization is limited to BUDGET_MS per tick; dirty nodes carry over.
    //     After a recorded change (or a new ref/wv with equal content, e.g. a
    //     polled `data = await res.json()`), an object is serialized again no
    //     sooner than SAMPLE_FACTOR x that cost, however often it changes; a
    //     change after a longer quiet spell goes out on the next tick.
    //  3. In-place deep mutations (proxies don't bump an outer wv) are found by
    //     re-checks no earlier than max(RECHECK_MS, 50 x serialization cost),
    //     paid from a DEEP_MS-per-tick credit, so the amortized cost is bounded.
    //  4. Values above MAX_SNAPSHOT_CHARS are kept as length+hash, not the string.
    // Writes between two visits of a node are observed as one change (a sample,
    // not counted as dropped).
    _pollStateValues(baseline) {
      const HINT_NODES = 4096;
      const SWEEP_NODES = 2048;
      const BUDGET_MS = 2;
      const DEEP_MS = 0.5;
      const now = performance.now();
      if (!baseline) {
        // nodes of destroyed {#each} items / effect runs leave the counts
        this._sweepNodes(SWEEP_NODES);
        this._deepCredit = Math.min(10 * DEEP_MS, this._deepCredit + DEEP_MS);
      }
      const ids = this._pollIds;
      const due = [];
      const limit = Math.min(HINT_NODES, ids.length);
      for (let visited = 0; visited < limit && ids.length > 0; visited++) {
        if (this._pollCursor >= ids.length) {
          this._pollCursor = 0;
        }
        const nodeId = ids[this._pollCursor];
        const entry = this._reactiveNodes.get(nodeId);
        if (entry?.meta.type !== 'state') {
          // re-tracked as another type: drop from the poll list (slot reused)
          this._pollRemove(nodeId);
          continue;
        }
        if (!this._scopeLive(entry.meta.componentId)) {
          this._forgetNode(nodeId); // swaps the last id into this slot
          continue;
        }
        this._pollCursor++;
        const signal = entry.signal.deref();
        const value = signal ? this._readStateValue(nodeId, signal) : __NO_VALUE;
        if (value === __NO_VALUE) {
          // nothing readable (collected, uninitialized, function): not pending
          this._unseeded.delete(nodeId);
          continue;
        }
        if (value === null || typeof value !== 'object') {
          const had = this._stateSnapshots.has(nodeId);
          const prev = this._stateSnapshots.get(nodeId);
          if (had && Object.is(prev, value)) continue;
          // Forget the object key so object -> primitive -> same object again
          // is still recorded as a change.
          this._stateSnapshotStrs.delete(nodeId);
          this._pollDirty.delete(nodeId);
          if (!had) {
            // first observation: seed only
            this._stateSnapshots.set(nodeId, value);
            this._unseeded.delete(nodeId);
            continue;
          }
          this._recordChange(
            nodeId,
            entry,
            prev,
            value,
            typeof value === 'string' ? 2 * value.length : 64,
          );
          continue;
        }
        let meta = this._pollMeta.get(nodeId);
        if (!meta) {
          meta = { ref: undefined, wv: undefined, nextCheckAt: 0, nextSampleAt: 0 };
          this._pollMeta.set(nodeId, meta);
        }
        if (meta.ref !== value || meta.wv !== signal.wv) {
          this._pollDirty.add(nodeId);
        } else if (now >= meta.nextCheckAt) {
          due.push(nodeId);
        }
      }
      const start = performance.now();
      for (const nodeId of this._pollDirty) {
        if (performance.now() - start > BUDGET_MS) return;
        if (now < this._pollMeta.get(nodeId).nextSampleAt) continue;
        this._pollDirty.delete(nodeId);
        this._serializeNode(nodeId, false);
      }
      for (const nodeId of due) {
        if (this._deepCredit <= 0 || performance.now() - start > BUDGET_MS) return;
        this._serializeNode(nodeId, true);
      }
    },

    // Nodes registered while inactive have no seed yet, so a write before their
    // first visit could not be seen as a change: one normal pass seeds them at
    // activation instead of 200 ms later.
    _pollBaseline() {
      this._baselining = true;
      try {
        this._pollStateValues(true);
      } catch {
        /* never break activation */
      } finally {
        this._baselining = false;
      }
    },

    _serializeNode(nodeId, deep) {
      const MAX_SNAPSHOT_CHARS = 32768;
      const RECHECK_MS = 1000;
      const SAMPLE_FACTOR = 20;
      const entry = this._reactiveNodes.get(nodeId);
      const meta = this._pollMeta.get(nodeId);
      if (!entry || !meta) return;
      const signal = entry.signal.deref();
      if (!signal) return;
      const value = this._readStateValue(nodeId, signal);
      if (value === __NO_VALUE || value === null || typeof value !== 'object') return;
      try {
        const t0 = performance.now();
        const str = JSON.stringify(value);
        // Small values keep the string (exact compare); large ones only a
        // length+hash so a 5 MB array doesn't pin 5 MB per node.
        // (toJSON may return undefined: no JSON at all)
        const tooLarge = str !== undefined && str.length > MAX_SNAPSHOT_CHARS;
        const key = str === undefined ? '' : tooLarge ? str.length + ':' + __hash(str) : str;
        // the hash of a large value is part of the per-sample work
        const cost = performance.now() - t0;
        if (deep) this._deepCredit -= cost;
        meta.ref = value;
        meta.wv = signal.wv;
        meta.nextCheckAt = t0 + Math.max(RECHECK_MS, 50 * cost);
        if (this._stateSnapshotStrs.get(nodeId) === key) {
          if (!deep) meta.nextSampleAt = t0 + SAMPLE_FACTOR * cost;
          return;
        }
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
          // first observation: seed only (no entry, no counters). No throttle:
          // the first change after the seed must land on the next tick.
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
        if (!deep) meta.nextSampleAt = t0 + SAMPLE_FACTOR * cost;
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
      // sampled change count: independent of the ring
      this._activityRow(entry.meta.componentId).changes++;
      this._stateSnapshots.set(nodeId, newValue);
      // Trimmed in bulk, not one splice per change (a poll tick can record
      // thousands): before every read, and here once past __TIMELINE_TRIM_AT
      // entries or the byte budget, which bounds memory when nothing reads.
      if (
        this._stateTimeline.length > __TIMELINE_TRIM_AT ||
        this._timelineBytes > __TIMELINE_BYTES
      ) {
        this._trimTimeline();
      }
      this._scheduleTimelineUpdate();
    },

    // Ring: at most __TIMELINE_CAP entries and __TIMELINE_BYTES (the newest entry is
    // always kept). Removed entries that were never pushed are disclosed
    // as dropped; pushed ones are already on the server.
    _trimTimeline() {
      const all = this._stateTimeline;
      let cut = 0;
      let bytesLeft = this._timelineBytes;
      while (
        cut < all.length - 1 &&
        (all.length - cut > __TIMELINE_CAP || bytesLeft > __TIMELINE_BYTES)
      ) {
        const info = this._entryInfo.get(all[cut]);
        const reason = all.length - cut > __TIMELINE_CAP ? 'runtime-count' : 'runtime-bytes';
        if (info.seq > this._pushedSeq) this._timelineDropped[reason]++;
        bytesLeft -= info.bytes;
        cut++;
      }
      if (cut > 0) {
        all.splice(0, cut);
        this._timelineBytes = bytesLeft;
      }
    },

    // A pending timer is never re-armed, so unsent entries leave within 300 ms
    // even under continuous change. Flushed at once when a full message
    // (__TIMELINE_BATCH entries) is unsent: one poll tick can record thousands.
    _scheduleTimelineUpdate() {
      if (!this._active || this._baselining) return;
      if (this._timelineSeq - this._pushedSeq >= __TIMELINE_BATCH) {
        this._flushTimeline();
        return;
      }
      if (this._timelineTimer) return;
      this._timelineTimer = setTimeout(() => {
        this._timelineTimer = null;
        this._flushTimeline();
      }, 300);
    },

    _flushTimeline() {
      if (this._timelineTimer) {
        clearTimeout(this._timelineTimer);
        this._timelineTimer = null;
      }
      // _timelineDeltas() marks entries as pushed, so it must not run when nothing can be
      // sent. Activation's _timelineFull() needs no guard: subscriptions only arrive over HMR.
      if (!import.meta.hot) return;
      for (const msg of this._timelineDeltas()) {
        this._send('svelte-devtools:state-timeline', msg);
      }
    },

    // Counters since the previous push, attached to (and reset by) the next message.
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

    // Writes of polled $state nodes without a first sample are not observable yet.
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
      for (let i = 0; i < end; i += __TIMELINE_BATCH) {
        const msg = { epoch: this._epoch, changes: pending.slice(i, i + __TIMELINE_BATCH) };
        if (i === 0 && this._timelineReset) msg.reset = true;
        if (i === 0) this._takeTimelineDisclosure(msg);
        else msg.baseline = this._baselineInfo();
        msgs.push(msg);
      }
      this._timelineReset = false;
      this._pushedSeq = this._timelineSeq;
      return msgs;
    },

    // Newest entries first up to __TIMELINE_BYTES, the server's own buffer
    // budget, so nothing is sent that it would drop.
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
      if (import.meta.hot) import.meta.hot.send(event, data);
    },

    // Raw frame timestamps only; _sampleFps does the counting off the frame path.
    _fpsFrameTimes: [],

    _fpsLoop(gen) {
      if (gen !== this._fpsGen) return;
      this._fpsFrameTimes.push(performance.now());
      requestAnimationFrame(() => this._fpsLoop(gen));
    },

    _isVisible() {
      if (typeof document === 'undefined') return true;
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
      // data.resync: the server holds no full base for this epoch. Activation or
      // resync resends everything once, in the order components -> profiles ->
      // timeline(reset: true); the reset push marks the snapshot complete.
      const resync = this._resync || !!data?.resync;
      this._resync = false;
      if (this._active && !wasActive) this._pollBaseline();
      if (this._active && (!wasActive || resync)) {
        this._sendComponentsUpdate(true);
        this._sendProfilesUpdate();
        this._send('svelte-devtools:state-timeline', this._timelineFull());
      }
      this._syncSampling();
    },

    _syncSampling() {
      const want = this._active && this._isVisible();
      if (want && !this._sampling) {
        this._fpsFrameTimes = [];
        const gen = ++this._fpsGen;
        this._sampling = {
          poll: setInterval(() => {
            this._pollStateValues();
            // seed progress changed: push it even without changes
            if (this._sentPendingNodes !== this._unseeded.size) this._scheduleTimelineUpdate();
          }, 200),
          fps: setInterval(() => {
            this._sampleFps();
          }, 500),
        };
        requestAnimationFrame(() => this._fpsLoop(gen));
      } else if (!want && this._sampling) {
        clearInterval(this._sampling.poll);
        clearInterval(this._sampling.fps);
        this._sampling = null;
        this._fpsGen++;
        this._fpsFrameTimes = [];
      }
    },

    _sampleFps() {
      const now = performance.now();
      const cutoff = now - 1000;
      let i = 0;
      while (i < this._fpsFrameTimes.length && this._fpsFrameTimes[i] < cutoff) i++;
      if (i > 0) this._fpsFrameTimes.splice(0, i);
      const fps = this._fpsFrameTimes.length;
      this._send('svelte-devtools:fps', { timestamp: Date.now(), fps });
    },
  };

  window.__SVELTE_DEVTOOLS__ = __SVELTE_DT;

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => __SVELTE_DT._syncSampling());
  }

  window.addEventListener('error', event => {
    __SVELTE_DT._send('svelte-devtools:runtime-error', {
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
    __SVELTE_DT._send('svelte-devtools:runtime-error', {
      message: typeof message === 'string' && message !== '' ? message : __describe(reason),
      stack: typeof stack === 'string' ? stack : '',
      timestamp: Date.now(),
    });
  });

  // Svelte (5.58+) records the component context an element was rendered in
  // as `__svelte_meta.component`; library components and the context `mount`
  // creates are not tracked, so the nearest tracked ancestor (`ctx.p`,
  // Svelte's parent context) is used. undefined when there is none.
  const instanceOfElement = element => {
    let id;
    for (let ctx = element?.__svelte_meta?.component; ctx && id === undefined; ctx = ctx.p) {
      id = __SVELTE_DT.idByContext.get(ctx);
    }
    return id === undefined ? undefined : __SVELTE_DT._instances.get(id);
  };
  // Entries carry no component reference, so component entries are paired with
  // the context chain in order. A pair counts only when the instance is named
  // like the tag and its parent context's file is the caller's file, which
  // rules out aliased and dynamic tags and pairs shifted by an entry-less call
  // (css custom properties), except inside a self-recursive component.
  const parentInstances = element => {
    const calls = [];
    let last = null;
    for (let entry = element?.__svelte_meta?.parent ?? null; entry; entry = entry.parent) {
      if (entry.type === 'component') {
        if (calls.length > 0) calls.at(-1).caller = last.file;
        calls.push({ entry, caller: null });
      }
      last = entry;
    }
    if (calls.length > 0) calls.at(-1).caller = last.file;

    const found = new Map();
    const FILENAME = __SVELTE_DT.filenameSymbol;
    let ctx = element?.__svelte_meta?.component ?? null;
    for (const { entry, caller } of calls) {
      if (!ctx || !FILENAME) break;
      const parent = ctx.p ?? null;
      const id = __SVELTE_DT.idByContext.get(ctx);
      const instance = id === undefined ? undefined : __SVELTE_DT._instances.get(id);
      if (
        instance?.name === entry.componentTag &&
        parent !== null &&
        parent.function?.[FILENAME] === caller
      ) {
        found.set(entry, instance);
      }
      ctx = parent;
    }
    return found;
  };
  window.addEventListener('svelte-inspector:describe', event => {
    const detail = event.detail;
    const instance = instanceOfElement(detail?.element);
    if (instance) detail.name = instance.name;
    if (detail?.parents instanceof Map) {
      for (const [entry, found] of parentInstances(detail.element)) {
        detail.parents.set(entry, found.name);
      }
    }
  });
  window.addEventListener('svelte-inspector:pick', event => {
    // only the menu's Inspect is cancelable; a click, the open key or Open only opens the editor
    if (!event.cancelable) return;
    const { element, entry } = event.detail ?? {};
    const instance = entry ? parentInstances(element).get(entry) : instanceOfElement(element);
    if (!instance) return;
    // the inspector then opens no editor
    event.preventDefault();
    __SVELTE_DT._send('svelte-devtools:element-picked', {
      epoch: __SVELTE_DT._epoch,
      componentId: instance.id,
    });
  });

  // Pull requests from the server are answered regardless of the
  // subscription state.
  if (import.meta.hot) {
    import.meta.hot.on('svelte-devtools:subscription', data => {
      __SVELTE_DT._setSubscription(data);
    });
    import.meta.hot.on('vite:ws:connect', () => {
      // The server may have restarted with an empty collector: the reply to
      // runtime-ready is treated as a fresh activation (full snapshot).
      __SVELTE_DT._resync = true;
      import.meta.hot.send('svelte-devtools:runtime-ready', {});
    });
    import.meta.hot.send('svelte-devtools:runtime-ready', {});
    import.meta.hot.on('svelte-devtools:request-reactive-graph', data => {
      __SVELTE_DT.sendReactiveGraph(data);
    });
    import.meta.hot.on('svelte-devtools:request-reactive-summary', data => {
      __SVELTE_DT.sendReactiveSummary(data);
    });
    import.meta.hot.on('svelte-devtools:clear-state-timeline', () => {
      __SVELTE_DT.clearStateTimeline();
    });
  }
}
