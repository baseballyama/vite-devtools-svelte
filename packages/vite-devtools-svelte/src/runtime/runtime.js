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

// `file:line:column` (Svelte's declaration location) -> { file, line, column }, or null.
function __parseLoc(loc) {
  if (typeof loc !== 'string') return null;
  const c = loc.lastIndexOf(':');
  const l = loc.lastIndexOf(':', c - 1);
  if (l <= 0) return null;
  const line = Number(loc.slice(l + 1, c));
  const column = Number(loc.slice(c + 1));
  if (!Number.isInteger(line) || !Number.isInteger(column)) return null;
  return { file: loc.slice(0, l), line, column };
}

// Same rule as hooks.js: library code is not the app's.
const __LIBRARY_PATH = /(^|\/)node_modules\//;

// `file` without directories and the `.svelte` extension.
function __baseName(file) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.endsWith('.svelte') ? base.slice(0, -'.svelte'.length) : base;
}

const __round3 = ms => Math.round(ms * 1000) / 1000;
const __selfMs = c => c.renderMs + c.effectMs + c.derivedMs;

// Performance recording (Performance panel, MCP). Caps bound what one
// recording keeps in the page and sends to the dev server.
const __PERF = {
  // updates kept (later ones are counted as dropped)
  maxUpdates: 2000,
  // per update: written states, components in "where the time went", named deriveds
  maxTriggers: 16,
  maxCosts: 30,
  maxWasted: 10,
  // per-component totals over the recording
  maxComponents: 500,
  pushMs: 1000,
  maxTargetChars: 60,
  // a frame gap longer than this (hidden tab, debugger) is not a measurement
  maxFrameGapMs: 1000,
  // user input whose handler can start an update in the same task
  events: ['pointerdown', 'click', 'input', 'change', 'keydown', 'submit'],
};
// Cost bucket of reactions outside any tracked component or library one.
const __OUTSIDE = -1;

// Short description of an event target: `button#save`, `input.search`, `li`.
function __describeTarget(el) {
  if (el === null || typeof el !== 'object' || typeof el.localName !== 'string') return '';
  let out = el.localName;
  if (typeof el.id === 'string' && el.id !== '') out += '#' + el.id;
  else {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [];
    const named = cls.find(c => c !== '' && !c.startsWith('svelte-'));
    if (named !== undefined) out += '.' + named;
  }
  return out.slice(0, __PERF.maxTargetChars);
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

    _profiles: new Map(),
    _initStartTimes: new Map(),
    // componentId -> render ms not recorded yet (recordRenderDuration)
    _pendingRenders: new Map(),
    _rendersScheduled: false,
    _profileDebounceTimer: null,

    _reactiveNodes: new Map(),
    _reactiveProxies: new Map(),

    // Lets unmount purge a component's nodes without scanning every node.
    _nodesByComponent: new Map(),

    _stateTimeline: [],
    // For objects the compare key is the JSON string, or length+hash when large.
    _stateSnapshots: new Map(),
    _stateSnapshotStrs: new Map(),
    _timelineDebounceTimer: null,
    // A scoped graph resolves dependencies without scanning every node.
    _idBySignal: new WeakMap(),
    _idByProxy: new WeakMap(),
    // Set by hooks.js.
    _idByContext: new WeakMap(),
    // Names declared more than once per instance ({@const} in {#each} items,
    // several $state class instances).
    _nameSeq: new Map(),
    // Signals created while a .svelte.js/.ts module body runs belong to a scope
    // per module file. Ids come from the component id counter (never reused)
    // but scopes are not in _instances / the tree, and live as long as the page.
    _modules: new Map(),
    _moduleByFile: new Map(),
    // Effect names are numbered per component, so instances of one file match.
    _effectSeq: new Map(),
    // owner effect -> its nodes ({#each} items, effect runs), removed when it
    // is destroyed.
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
    _profileCap: 5000,
    _sampling: null,
    _baselining: false,
    // A first observation is a seed, not a change (no timeline entry, activity
    // count or drops): the old value is unknown, not null.
    _unseeded: new Set(),
    // pendingNodes on the last state-timeline message; null = none sent yet
    _sentPendingNodes: null,
    _fpsGen: 0,
    // Readers of Svelte's objects (set by hooks.js from svelte/internal/devtools):
    // signalValue, isUninitialized, deps, reactions, kind, componentOf,
    // children, snapshot, and sourceNode (the node a $state proxy's
    // property / version signal belongs to, or null).
    _api: null,
    // the HMR channel (connectHot, by the first hooks.js copy that has one)
    _hot: null,

    // Performance recording: null unless the DevTools asked for one (see
    // startPerformance). `_subscribePerf` (set by hooks.js) subscribes the
    // listener that feeds it and returns its unsubscribe, so Svelte reports
    // effect runs only while a recording is on.
    _perf: null,
    _subscribePerf: null,
    _perfUnsubscribe: null,

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

    _removeInstance(id) {
      const instance = this._instances.get(id);
      if (!instance) return;
      if (instance.parentId !== null) this._instances.get(instance.parentId)?.children.delete(id);
      this._removeChildren(id);
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

    // A signal can be collected before its node leaves the store. Returns the
    // signal, or null (and forgets the node).
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

    // componentId:name#k when this instance already holds a live node of that
    // name for another signal. The same signal (re-tagged) keeps its id.
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

    // `owner`: the effect the signal was created in, or null (module code);
    // `loc`: where it is declared (`file:line:column`), when known.
    _registerNode(nodeId, componentId, type, name, signalRef, owner, loc) {
      this._trackNodeCount(nodeId, componentId, type);
      const prev = this._reactiveNodes.get(nodeId)?.owner?.deref();
      if (prev) this._nodesByOwner.get(prev)?.delete(nodeId);
      const entry = {
        signal: signalRef,
        owner: owner ? new WeakRef(owner) : null,
        loc: loc ?? null,
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
    // instance app can't spend its main thread serializing.
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

    // The full form replaces the server's tree for this epoch. Deltas send
    // removed ids first, then added in registration order (parents first).
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
      this._send('svelte-devtools:profiles', { epoch: this._epoch, profiles, total: all.length });
      // Payload size from a small sample (entries differ mainly by file path).
      const k = Math.min(8, profiles.length);
      let sampled = 0;
      for (let i = 0; i < k; i++) sampled += JSON.stringify(profiles[i]).length;
      const bytes = k > 0 ? Math.round((sampled / k) * profiles.length) : 0;
      this._profilesCost = { ms: performance.now() - t0, bytes };
    },

    // `owner`: the effect active when the signal was created; the node is
    // removed when it is destroyed (an {#each} item's {@const}, a class
    // instance created in an effect run).
    trackState(signal, name, componentId, owner, loc) {
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'state', name, new WeakRef(signal), owner, loc);
      this._idBySignal.set(signal, nodeId);
      this._seedLater(nodeId);
      return nodeId;
    },

    trackProxy(proxy, name, componentId, owner, loc) {
      const nodeId = this._nodeIdFor(proxy, this._idByProxy, componentId, name);
      this._reactiveProxies.set(nodeId, new WeakRef(proxy));
      // The proxy itself stays weakly held (_reactiveProxies). The marker is
      // held strongly so the node is not GC-dropped while the component lives;
      // _cleanupComponent removes it on unmount.
      const marker = { v: '(proxy)', _isProxy: true };
      this._registerNode(nodeId, componentId, 'state', name, { deref: () => marker }, owner, loc);
      this._idBySignal.set(marker, nodeId);
      this._idByProxy.set(proxy, nodeId);
      this._seedLater(nodeId);
      return nodeId;
    },

    trackDerived(signal, name, componentId, owner, loc) {
      const nodeId = this._nodeIdFor(signal, this._idBySignal, componentId, name);
      this._registerNode(nodeId, componentId, 'derived', name, new WeakRef(signal), owner, loc);
      this._idBySignal.set(signal, nodeId);
      return nodeId;
    },

    // bindEffect() attaches the effect object; the node is removed when that
    // effect is destroyed. Names are effect_1, effect_pre_1, ... per
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

    // Template effects are the ones under the component's container created
    // in its context, without descending into other components or the
    // tracked $effect nodes.
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
      const api = this._api;
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
      // Signals devtools does not track (created in node_modules, e.g.
      // SvelteKit's page state, or outside any component/module body):
      // reported so such a node is not "isolated".
      const untracked = new Map();
      const isDerived = x => {
        const k = api.kind(x);
        return k === 'derived' || k === 'async-derived';
      };
      // Walks through untracked intermediates until tracked nodes are reached;
      // an untracked leaf source (a proxy's property) resolves to its proxy's node.
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
      if (this._api.isUninitialized(signal)) return __NO_VALUE;
      const v = this._api.signalValue(signal);
      // functions aren't state data
      return typeof v === 'function' ? __NO_VALUE : v;
    },

    // hooks.js marks a node written once Svelte flushed (or committed) the
    // batch that wrote it, also for writes deep inside its $state proxy, so
    // several writes in one batch are one change. The work runs in the next
    // task, not inside Svelte's flush, within BUDGET_MS (plus the seed of up
    // to SEED_NODES new nodes); the rest follows in another task. Values above
    // MAX_SNAPSHOT_CHARS are kept as length+hash.
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

    // Nodes registered while inactive have no seed yet, so a write before their
    // first observation could not be seen as a change: one pass seeds them at
    // activation.
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

    // A throttle, not a debounce: a pending timer is never re-armed, so unsent
    // entries leave within 300 ms even under continuous change. Flushed at once
    // when 200 entries (one message) are unsent: one poll tick can record thousands.
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

    // --- Performance recording ---
    // One update = one flush of a batch (for a fork: its flush once
    // committed). Per update: the tracked states written in the batch, the
    // runs of render effects / $effect / $derived with their self time (a
    // nested run is subtracted from the run around it) per component, and
    // the $derived re-runs that returned the value they already had.

    startPerformance(recordingId) {
      if (this._perf?.id === recordingId) return;
      this.stopPerformance();
      const p = {
        id: recordingId,
        t0: performance.now(),
        seq: 0,
        // batch -> Map<nodeId, trigger>: tracked states written in it
        pending: new WeakMap(),
        update: null,
        depth: 0,
        // running reactions: { r, cat, start, child, old }
        stack: [],
        // the derived that just ran: its new value is set after its run ends
        settle: null,
        unsent: [],
        kept: 0,
        dropped: 0,
        // file -> totals over the recording
        components: new Map(),
        dirty: false,
        event: null,
        frames: { last: 0, base: Infinity, waiting: [] },
        pushTimer: null,
        listeners: [],
      };
      this._perf = p;
      this._perfUnsubscribe = this._subscribePerf?.() ?? null;
      this._perfListen(p);
      const loop = t => {
        if (this._perf !== p) return;
        this._perfFrame(p, t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    stopPerformance() {
      const p = this._perf;
      if (p === null) return;
      this._perf = null;
      this._perfUnsubscribe?.();
      this._perfUnsubscribe = null;
      for (const [type, fn, capture] of p.listeners) window.removeEventListener(type, fn, capture);
      clearTimeout(p.pushTimer);
      this._perfPush(p, true);
    },

    // The last input event, attached to an update that starts in the same
    // task: its handler wrote the state. Cleared once the event finished
    // dispatching (window bubble phase), or by the next task otherwise.
    _perfListen(p) {
      const onCapture = e => {
        const event = { type: e.type, target: __describeTarget(e.target) };
        // named keys only (Enter, Escape): typed characters stay out of the recording
        if (e.type === 'keydown' && typeof e.key === 'string' && e.key.length > 1)
          event.key = e.key;
        p.event = event;
        setTimeout(() => {
          if (p.event === event) p.event = null;
        }, 0);
      };
      const onBubble = () => {
        const event = p.event;
        void Promise.resolve().then(() => {
          if (p.event === event) p.event = null;
          return null;
        });
      };
      for (const type of __PERF.events) {
        p.listeners.push([type, onCapture, true], [type, onBubble, false]);
      }
      for (const [type, fn, capture] of p.listeners) window.addEventListener(type, fn, capture);
    },

    // Frames: the gap between two animation frames that contains an update
    // tells how many frames it cost; the shortest gap seen is one frame.
    _perfFrame(p, t) {
      const f = p.frames;
      if (f.last > 0) {
        const gap = t - f.last;
        if (gap > 0) f.base = Math.min(f.base, gap);
        for (const u of f.waiting) {
          u.droppedFrames =
            gap > __PERF.maxFrameGapMs || f.base === Infinity
              ? null
              : Math.max(0, Math.round(gap / f.base) - 1);
        }
      }
      f.waiting.length = 0;
      f.last = t;
    },

    _perfWritten(signal, batch) {
      const p = this._perf;
      if (p === null) return;
      const id = this._idBySignal.get(signal) ?? this._api.sourceNode(signal);
      if (id === undefined || id === null) return;
      let writes = p.pending.get(batch);
      if (writes === undefined) {
        writes = new Map();
        p.pending.set(batch, writes);
      }
      if (writes.has(id)) return;
      const entry = this._reactiveNodes.get(id);
      if (entry === undefined) return;
      const { name, componentId } = entry.meta;
      writes.set(id, {
        nodeId: id,
        name,
        scopeId: componentId,
        scope: this._perfScopeName(componentId),
        file: this._scopeFile(componentId),
        loc: __parseLoc(entry.loc),
        // written while an update ran (by an $effect): a cascade, not the cause
        during: p.update !== null,
      });
    },

    _perfFlushStart(batch) {
      const p = this._perf;
      if (p === null) return;
      if (p.update !== null) {
        p.depth++;
        return;
      }
      if (this._api.isFork(batch)) return;
      p.depth = 1;
      p.update = {
        start: performance.now(),
        event: p.event,
        triggers: new Map(),
        // scope key -> { renderMs, effectMs, derivedMs, renders, effects, deriveds }
        costs: new Map(),
        renders: 0,
        effects: 0,
        deriveds: 0,
        wasted: 0,
        // `file\0name` of a tracked derived -> { name, scope, file, runs, unchanged }
        named: new Map(),
      };
    },

    _perfFlushEnd(batch) {
      const p = this._perf;
      if (p === null || p.update === null) return;
      if (!this._api.isFork(batch)) this._perfTake(p, batch);
      if (--p.depth > 0) return;
      this._perfFinish(p);
    },

    // A batch committed (also one processed inside another's flush): its
    // writes caused the update that is running.
    _perfCommitted(batch) {
      const p = this._perf;
      if (p === null) return;
      if (p.update === null) p.pending.delete(batch);
      else this._perfTake(p, batch);
    },

    _perfDiscarded(batch) {
      this._perf?.pending.delete(batch);
    },

    _perfTake(p, batch) {
      const writes = p.pending.get(batch);
      if (writes === undefined) return;
      p.pending.delete(batch);
      const into = p.update.triggers;
      for (const [id, t] of writes) if (!into.has(id)) into.set(id, t);
    },

    _perfRunStart(reaction) {
      const p = this._perf;
      if (p === null || p.update === null) return;
      if (p.settle !== null) this._perfSettle(p);
      const api = this._api;
      const k = api.kind(reaction);
      const cat =
        k === 'derived' || k === 'async-derived'
          ? 'derived'
          : k === 'effect' || k === 'effectPre'
            ? 'effect'
            : 'render';
      const old =
        cat === 'derived' && !api.isUninitialized(reaction)
          ? api.signalValue(reaction)
          : __NO_VALUE;
      p.stack.push({ r: reaction, cat, start: performance.now(), child: 0, old });
    },

    _perfRunEnd(reaction) {
      const end = performance.now();
      const p = this._perf;
      if (p === null || p.update === null) return;
      if (p.settle !== null) this._perfSettle(p);
      const at = p.stack.findLastIndex(s => s.r === reaction);
      if (at === -1) return;
      const run = p.stack[at];
      p.stack.length = at;
      const total = end - run.start;
      const parent = p.stack.at(-1);
      if (parent !== undefined) parent.child += total;
      const u = p.update;
      const key = this._perfScopeKey(reaction, run.cat);
      let cost = u.costs.get(key);
      if (cost === undefined) {
        // resolved now: the instance may be unmounted before the update ends
        const info = this._perfScopeInfo(key);
        cost = {
          info,
          renderMs: 0,
          effectMs: 0,
          derivedMs: 0,
          renders: 0,
          effects: 0,
          deriveds: 0,
        };
        u.costs.set(key, cost);
      }
      cost[run.cat + 'Ms'] += Math.max(0, total - run.child);
      cost[run.cat + 's']++;
      u[run.cat + 's']++;
      if (run.cat === 'derived') p.settle = run;
    },

    // Svelte stores a derived's new value after its run ended: compared at
    // the next event. Only re-runs (the derived had a value) are compared.
    _perfSettle(p) {
      const run = p.settle;
      p.settle = null;
      const u = p.update;
      const same = run.old !== __NO_VALUE && Object.is(run.old, this._api.signalValue(run.r));
      if (same) u.wasted++;
      const id = this._idBySignal.get(run.r);
      const entry = id === undefined ? undefined : this._reactiveNodes.get(id);
      if (entry === undefined) return;
      const { name, componentId, componentFile } = entry.meta;
      const k = componentFile + '\0' + name;
      let n = u.named.get(k);
      if (n === undefined) {
        n = {
          name,
          scope: this._perfScopeName(componentId),
          file: componentFile,
          runs: 0,
          unchanged: 0,
        };
        u.named.set(k, n);
      }
      n.runs++;
      if (same) n.unchanged++;
    },

    // Where a reaction's time goes: its tracked component, else the library
    // component it belongs to (by file), else the nearest tracked ancestor;
    // a $derived declared in a module goes to the module.
    _perfScopeKey(reaction, cat) {
      const api = this._api;
      const ctx = api.componentOf(reaction);
      if (ctx !== null) {
        const own = this._idByContext.get(ctx);
        if (own !== undefined) return own;
        const file = api.filename(ctx);
        if (file !== undefined && __LIBRARY_PATH.test(file)) return 'lib:' + file;
        return api.trackedComponent(ctx) ?? __OUTSIDE;
      }
      if (cat === 'derived') {
        const id = this._idBySignal.get(reaction);
        const entry = id === undefined ? undefined : this._reactiveNodes.get(id);
        if (entry !== undefined) return entry.meta.componentId;
      }
      return __OUTSIDE;
    },

    _perfScopeName(scopeId) {
      const instance = this._instances.get(scopeId);
      if (instance !== undefined) return instance.name;
      const module = this._modules.get(scopeId);
      return module === undefined ? '' : __baseName(module.file);
    },

    // { file, name, kind, componentId } of a cost bucket (instances of one
    // file are summed in "where the time went").
    _perfScopeInfo(key) {
      if (typeof key === 'string') {
        const file = key.slice('lib:'.length);
        return { file, name: __baseName(file), kind: 'library', componentId: null };
      }
      if (key === __OUTSIDE)
        return { file: '', name: '(outside components)', kind: 'other', componentId: null };
      if (this._modules.has(key)) {
        const file = this._modules.get(key).file;
        return { file, name: __baseName(file), kind: 'module', componentId: null };
      }
      const instance = this._instances.get(key);
      return instance === undefined
        ? { file: '', name: '(outside components)', kind: 'other', componentId: null }
        : { file: instance.file, name: instance.name, kind: 'component', componentId: key };
    },

    _perfFinish(p) {
      if (p.settle !== null) this._perfSettle(p);
      const u = p.update;
      const end = performance.now();
      p.update = null;
      p.depth = 0;
      p.stack.length = 0;
      if (u.triggers.size === 0 && u.renders + u.effects + u.deriveds === 0) return;

      // per file, then into the recording's totals
      const byFile = new Map();
      let components = 0;
      for (const [key, c] of u.costs) {
        const info = c.info;
        if (info.kind === 'component' && info.componentId !== null && c.renders > 0) components++;
        const fileKey = info.kind + '\0' + info.file + '\0' + info.name;
        let g = byFile.get(fileKey);
        if (g === undefined) {
          g = {
            ...info,
            instances: 0,
            rendered: 0,
            renderMs: 0,
            effectMs: 0,
            derivedMs: 0,
            renders: 0,
            effects: 0,
            deriveds: 0,
          };
          byFile.set(fileKey, g);
        }
        g.instances++;
        if (c.renders > 0) g.rendered++;
        for (const f of ['renderMs', 'effectMs', 'derivedMs', 'renders', 'effects', 'deriveds'])
          g[f] += c[f];
        let t = p.components.get(fileKey);
        if (t === undefined) {
          if (p.components.size >= __PERF.maxComponents) continue;
          t = {
            ...info,
            ids: new Set(),
            updates: 0,
            renderMs: 0,
            effectMs: 0,
            derivedMs: 0,
            renders: 0,
            effects: 0,
            deriveds: 0,
            lastUpdate: 0,
          };
          p.components.set(fileKey, t);
        }
        if (typeof key === 'number') t.ids.add(key);
        if (t.lastUpdate !== p.seq + 1) {
          t.lastUpdate = p.seq + 1;
          t.updates++;
        }
        for (const f of ['renderMs', 'effectMs', 'derivedMs', 'renders', 'effects', 'deriveds'])
          t[f] += c[f];
      }
      p.seq++;
      p.dirty = true;
      const costs = [...byFile.values()].toSorted((a, b) => __selfMs(b) - __selfMs(a));
      for (const c of costs) {
        c.renderMs = __round3(c.renderMs);
        c.effectMs = __round3(c.effectMs);
        c.derivedMs = __round3(c.derivedMs);
      }
      const triggers = [...u.triggers.values()];
      const named = [...u.named.values()]
        .filter(n => n.unchanged > 0)
        .toSorted((a, b) => b.unchanged - a.unchanged);
      const record = {
        id: p.seq,
        start: __round3(u.start - p.t0),
        duration: __round3(end - u.start),
        event: u.event,
        triggers: triggers.slice(0, __PERF.maxTriggers),
        triggersOmitted: Math.max(0, triggers.length - __PERF.maxTriggers),
        components,
        renders: u.renders,
        effects: u.effects,
        deriveds: u.deriveds,
        wastedDeriveds: u.wasted,
        unchangedDeriveds: named.slice(0, __PERF.maxWasted),
        costs: costs.slice(0, __PERF.maxCosts),
        costsOmitted: Math.max(0, costs.length - __PERF.maxCosts),
        droppedFrames: null,
      };
      if (p.kept < __PERF.maxUpdates) {
        p.kept++;
        p.unsent.push(record);
        p.frames.waiting.push(record);
      } else {
        p.dropped++;
      }
      if (p.pushTimer === null) {
        p.pushTimer = setTimeout(() => {
          p.pushTimer = null;
          this._perfPush(p, false);
        }, __PERF.pushMs);
      }
    },

    // New updates since the last push and the per-component totals.
    _perfPush(p, final) {
      if (!final && !p.dirty) return;
      p.dirty = false;
      const updates = p.unsent;
      p.unsent = [];
      const components = [...p.components.values()]
        .toSorted((a, b) => __selfMs(b) - __selfMs(a))
        .map(t => ({
          file: t.file,
          name: t.name,
          kind: t.kind,
          componentId: t.componentId,
          instances: t.ids.size,
          updates: t.updates,
          renders: t.renders,
          effects: t.effects,
          deriveds: t.deriveds,
          renderMs: __round3(t.renderMs),
          effectMs: __round3(t.effectMs),
          derivedMs: __round3(t.derivedMs),
        }));
      this._send('svelte-devtools:performance', {
        epoch: this._epoch,
        recordingId: p.id,
        updates,
        dropped: p.dropped,
        components,
        componentsOmitted: p.components.size >= __PERF.maxComponents,
        final,
      });
    },

    _send(event, data) {
      if (this._hot) this._hot.send(event, data);
    },

    // Only timestamps: no allocations per frame beyond a single array push.
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
      const cutoff = now - 1000;
      let i = 0;
      while (i < this._fpsFrameTimes.length && this._fpsFrameTimes[i] < cutoff) i++;
      if (i > 0) this._fpsFrameTimes.splice(0, i);
      const fps = this._fpsFrameTimes.length;
      this._send('svelte-devtools:fps', { timestamp: Date.now(), fps });
    },
  };

  if (document !== undefined && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => store._syncSampling());
  }

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
  // The Performance panel's Record / Stop (also sent on connect: a page
  // loaded during a recording joins it; a stale one stops).
  hot.on('svelte-devtools:performance-recording', data => {
    if (data?.active === true && typeof data.recordingId === 'string') {
      dt.startPerformance(data.recordingId);
    } else {
      dt.stopPerformance();
    }
  });
}
