// This code is injected into the user's app as a virtual module.
// It tracks Svelte component mount/unmount and sends data to the Vite server via HMR.
export const RUNTIME_MODULE_ID = 'virtual:svelte-devtools-runtime'
export const RESOLVED_RUNTIME_ID = '\0' + RUNTIME_MODULE_ID

// Virtual module ID for the svelte/internal/client wrapper.
// When user code imports 'svelte/internal/client', it is redirected to this module.
// The wrapper re-exports everything and overrides key functions for devtools tracking.
export const WRAPPER_MODULE_ID = '\0svelte-devtools:wrapped-client'

/**
 * Wrapper code for svelte/internal/client.
 *
 * Re-exports everything from the real module, then overrides:
 * - push/pop: component lifecycle tracking
 * - tag/tag_proxy: named signal/proxy tracking (Svelte dev mode)
 * - state/derived/proxy: type markers consumed by tag/tag_proxy
 * - user_effect/user_pre_effect: effect tracking
 *
 * This single module replaces all post-compilation regex transforms
 * for reactive tracking, making the approach Svelte-compiler-output agnostic.
 */
export const wrapperCode = /* js */ `
import * as __svelte_original from 'svelte/internal/client';
export * from 'svelte/internal/client';

function __dt() {
  return typeof window !== 'undefined' ? window.__SVELTE_DEVTOOLS__ : null;
}

// Component ID stack (parallel to runtime._stack but local to wrapper)
const __idStack = [];
function __currentId() {
  return __idStack.length > 0 ? __idStack[__idStack.length - 1] : null;
}

// Tracks the most recently created signal for type determination in tag()
const __pendingSignal = { ref: null, type: null };

// --- Component Lifecycle ---

export function push() {
  const result = __svelte_original.push.apply(null, arguments);
  const dt = __dt();
  if (dt) {
    const file = dt._pendingFile || 'Unknown';
    dt._pendingFile = null;
    const id = dt.register(file);
    __idStack.push(id);
    dt.startInit(id);
    // Register cleanup via an effect that returns a teardown function.
    // We use __svelte_original.user_effect (the REAL unwrapped version)
    // to avoid triggering our own user_effect wrapper.
    try {
      __svelte_original.user_effect(() => {
        return () => { dt.unmount(id); };
      });
    } catch {}
  }
  return result;
}

export function pop() {
  const dt = __dt();
  if (dt && __idStack.length > 0) {
    const id = __idStack.pop();
    dt.endInit(id);
    dt.registered(id);
  }
  return __svelte_original.pop.apply(null, arguments);
}

// --- Signal Creation (type markers) ---

export function state() {
  const signal = __svelte_original.state.apply(null, arguments);
  __pendingSignal.ref = signal;
  __pendingSignal.type = 'state';
  return signal;
}

export function derived() {
  const signal = __svelte_original.derived.apply(null, arguments);
  __pendingSignal.ref = signal;
  __pendingSignal.type = 'derived';
  return signal;
}

export function proxy() {
  const p = __svelte_original.proxy.apply(null, arguments);
  __pendingSignal.ref = p;
  __pendingSignal.type = 'proxy';
  return p;
}

// --- Signal Tagging (Svelte dev mode) ---

export function tag(signal, name) {
  const result = __svelte_original.tag.apply(null, arguments);
  const dt = __dt();
  const cid = __currentId();
  if (dt && cid !== null) {
    const type = (__pendingSignal.ref === signal) ? __pendingSignal.type : 'state';
    if (type === 'derived') {
      dt.trackDerived(signal, name, cid);
    } else {
      dt.trackState(signal, name, cid);
    }
  }
  __pendingSignal.ref = null;
  __pendingSignal.type = null;
  return result;
}

export function tag_proxy(proxy, name) {
  const result = __svelte_original.tag_proxy.apply(null, arguments);
  const dt = __dt();
  const cid = __currentId();
  if (dt && cid !== null) {
    dt.trackProxy(proxy, name, cid);
  }
  __pendingSignal.ref = null;
  __pendingSignal.type = null;
  return result;
}

// --- Effect Tracking ---

export function user_effect() {
  const result = __svelte_original.user_effect.apply(null, arguments);
  const dt = __dt();
  const cid = __currentId();
  if (dt && cid !== null) {
    dt._effectCounter = (dt._effectCounter || 0) + 1;
    // Track the effect OBJECT (not the callback). The Svelte runtime
    // populates result.deps with the signals this effect depends on,
    // which is what getReactiveGraph() reads to build edges.
    dt.trackEffect(result, 'effect_' + dt._effectCounter, cid);
  }
  return result;
}

export function user_pre_effect() {
  const result = __svelte_original.user_pre_effect.apply(null, arguments);
  const dt = __dt();
  const cid = __currentId();
  if (dt && cid !== null) {
    dt._effectCounter = (dt._effectCounter || 0) + 1;
    dt.trackEffect(result, 'effect_pre_' + dt._effectCounter, cid);
  }
  return result;
}
`

export const runtimeCode = /* js */ `
if (typeof window !== 'undefined' && !window.__SVELTE_DEVTOOLS__) {
  const __SVELTE_DT = {
    _nextId: 0,
    _instances: new Map(),
    _stack: [],
    _pendingFile: null,
    _effectCounter: 0,
    _debounceTimer: null,
    _listeners: new Set(),

    // Phase 2: Profiling data
    _profiles: new Map(),
    _initStartTimes: new Map(),
    _profileDebounceTimer: null,

    // Phase 2: Reactive graph data
    _reactiveNodes: new Map(),
    _reactiveProxies: new Map(),

    // Phase 3: State timeline
    _stateTimeline: [],
    _stateSnapshots: new Map(),
    _timelineDebounceTimer: null,

    register(file) {
      const id = this._nextId++;
      const parentId = this._stack.length > 0 ? this._stack[this._stack.length - 1] : null;
      const name = file.split('/').pop()?.replace('.svelte', '') || 'Unknown';
      this._instances.set(id, { id, file, name, parentId, mounted: true, children: [] });
      if (parentId !== null) {
        const parent = this._instances.get(parentId);
        if (parent) parent.children.push(id);
      }
      this._stack.push(id);
      this._scheduleUpdate();
      return id;
    },

    registered(id) {
      const idx = this._stack.indexOf(id);
      if (idx !== -1) this._stack.splice(idx, 1);
    },

    mount(id) {
      const instance = this._instances.get(id);
      if (instance && !instance.mounted) {
        instance.mounted = true;
        this._scheduleUpdate();
      }
    },

    unmount(id) {
      const instance = this._instances.get(id);
      if (instance) {
        if (instance.parentId !== null) {
          const parent = this._instances.get(instance.parentId);
          if (parent) {
            parent.children = parent.children.filter(cid => cid !== id);
          }
        }
        this._removeChildren(id);
        this._cleanupReactiveNodes(id);
        this._instances.delete(id);
      }
      this._scheduleUpdate();
    },

    _cleanupReactiveNodes(componentId) {
      for (const [nodeId, entry] of this._reactiveNodes) {
        if (entry.meta.componentId === componentId) {
          this._reactiveNodes.delete(nodeId);
        }
      }
    },

    _removeChildren(parentId) {
      const parent = this._instances.get(parentId);
      if (!parent) return;
      for (const childId of [...parent.children]) {
        this._removeChildren(childId);
        this._cleanupReactiveNodes(childId);
        this._instances.delete(childId);
      }
    },

    _scheduleUpdate() {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this._sendUpdate();
      }, 100);
    },

    _sendUpdate() {
      const components = [];
      for (const [, instance] of this._instances) {
        if (instance.mounted) {
          components.push({
            id: instance.id,
            file: instance.file,
            name: instance.name,
            parentId: instance.parentId,
            mounted: instance.mounted,
          });
        }
      }
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:components', { components });
      }
    },

    getTree() {
      const components = [];
      for (const [, instance] of this._instances) {
        if (instance.mounted) {
          components.push({
            id: instance.id,
            file: instance.file,
            name: instance.name,
            parentId: instance.parentId,
            mounted: instance.mounted,
          });
        }
      }
      return components;
    },

    // --- Phase 2: Render Profiling ---

    startInit(id) {
      this._initStartTimes.set(id, performance.now());
    },

    endInit(id) {
      const start = this._initStartTimes.get(id);
      if (start === undefined) return;
      const initTime = performance.now() - start;
      this._initStartTimes.delete(id);
      const instance = this._instances.get(id);
      if (!instance) return;
      this._profiles.set(id, {
        componentId: id,
        file: instance.file,
        name: instance.name,
        initTime,
        renderCount: 0,
        totalRenderTime: 0,
        lastRenderTime: 0,
        lastRenderAt: Date.now(),
      });
      this._scheduleProfileUpdate();
    },

    recordRender(id) {
      const profile = this._profiles.get(id);
      if (!profile) {
        const instance = this._instances.get(id);
        if (!instance) return;
        this._profiles.set(id, {
          componentId: id,
          file: instance.file,
          name: instance.name,
          initTime: 0,
          renderCount: 1,
          totalRenderTime: 0,
          lastRenderTime: 0,
          lastRenderAt: Date.now(),
        });
      } else {
        profile.renderCount++;
        profile.lastRenderAt = Date.now();
      }
      this._scheduleProfileUpdate();
    },

    recordRenderTime(id, duration) {
      const profile = this._profiles.get(id);
      if (profile) {
        profile.totalRenderTime += duration;
        profile.lastRenderTime = duration;
      }
    },

    _scheduleProfileUpdate() {
      if (this._profileDebounceTimer) clearTimeout(this._profileDebounceTimer);
      this._profileDebounceTimer = setTimeout(() => {
        this._sendProfileUpdate();
      }, 500);
    },

    _sendProfileUpdate() {
      const profiles = Array.from(this._profiles.values());
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:profiles', { profiles });
      }
    },

    getProfiles() {
      return Array.from(this._profiles.values());
    },

    resetProfiles() {
      this._profiles.clear();
      this._scheduleProfileUpdate();
    },

    // --- Phase 2: Reactive Graph Tracking ---

    trackState(signal, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef(signal),
        meta: { id: nodeId, type: 'state', name, componentId, componentFile: instance ? instance.file : '' }
      });
    },

    trackProxy(proxy, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveProxies.set(nodeId, new WeakRef(proxy));
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef({ v: '(proxy)', _isProxy: true }),
        meta: { id: nodeId, type: 'state', name, componentId, componentFile: instance ? instance.file : '' }
      });
    },

    trackDerived(signal, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef(signal),
        meta: { id: nodeId, type: 'derived', name, componentId, componentFile: instance ? instance.file : '' }
      });
    },

    trackEffect(effect, name, componentId) {
      const instance = this._instances.get(componentId);
      const nodeId = componentId + ':' + name;
      this._reactiveNodes.set(nodeId, {
        signal: new WeakRef(effect || { v: undefined, _isEffect: true }),
        meta: { id: nodeId, type: 'effect', name, componentId, componentFile: instance ? instance.file : '' }
      });
      return effect;
    },

    getReactiveGraph() {
      const nodes = [];
      const edges = [];
      const signalToId = new Map();

      for (const [nodeId, entry] of this._reactiveNodes) {
        const signal = entry.signal.deref();
        if (!signal || !this._instances.has(entry.meta.componentId)) {
          this._reactiveNodes.delete(nodeId);
          continue;
        }
        signalToId.set(signal, nodeId);
        const node = { ...entry.meta };
        if (signal._isProxy) {
          const proxyRef = this._reactiveProxies.get(nodeId);
          const proxy = proxyRef?.deref();
          if (proxy) {
            try {
              node.value = Array.isArray(proxy) ? '[' + proxy.length + ']' : '{' + Object.keys(proxy).length + '}';
            } catch { node.value = '(proxy)'; }
          }
        } else if (node.type !== 'effect' && signal.v !== undefined && typeof signal.v !== 'symbol') {
          try {
            const v = signal.v;
            if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) {
              node.value = v;
            } else {
              node.value = '(object)';
            }
          } catch { /* ignore */ }
        }
        nodes.push(node);
      }

      // Map proxy internal signals to their proxy node ID
      for (const [nodeId, ref] of this._reactiveProxies) {
        const proxy = ref.deref();
        if (!proxy) { this._reactiveProxies.delete(nodeId); continue; }
        const meta = this._reactiveNodes.get(nodeId)?.meta;
        if (!meta || !this._instances.has(meta.componentId)) { this._reactiveProxies.delete(nodeId); continue; }
      }

      // Build edges from deps
      const edgeSet = new Set();
      for (const [nodeId, entry] of this._reactiveNodes) {
        const signal = entry.signal.deref();
        if (!signal) continue;
        if (!signal.deps) continue;

        const visited = new Set();
        const queue = [...signal.deps];
        while (queue.length > 0) {
          const dep = queue.shift();
          if (!dep || visited.has(dep)) continue;
          visited.add(dep);
          const depId = signalToId.get(dep);
          if (depId) {
            const key = depId + '>' + nodeId;
            if (depId !== nodeId && !edgeSet.has(key)) {
              edgeSet.add(key);
              edges.push({ from: depId, to: nodeId });
            }
          } else if (dep.deps) {
            for (const d of dep.deps) queue.push(d);
          }
        }
      }

      return { nodes, edges };
    },

    sendReactiveGraph() {
      const graph = this.getReactiveGraph();
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:reactive-graph', graph);
      }
    },

    // --- Phase 3: State Timeline ---

    _pollStateValues() {
      for (const [nodeId, entry] of this._reactiveNodes) {
        if (entry.meta.type !== 'state') continue;
        if (!this._instances.has(entry.meta.componentId)) {
          this._reactiveNodes.delete(nodeId);
          continue;
        }
        const signal = entry.signal.deref();
        if (!signal || signal.v === undefined) continue;
        try {
          const currentVal = signal.v;
          const prev = this._stateSnapshots.get(nodeId);
          if (prev !== undefined && currentVal === prev) continue;
          const isPrimitive = currentVal === null || typeof currentVal !== 'object';
          let newSnapshot;
          if (isPrimitive) {
            if (prev !== undefined && prev === currentVal) continue;
            newSnapshot = currentVal;
          } else {
            const currStr = JSON.stringify(currentVal);
            const prevStr = this._stateSnapshotStrs?.get(nodeId);
            if (prevStr === currStr) continue;
            newSnapshot = JSON.parse(currStr);
            if (!this._stateSnapshotStrs) this._stateSnapshotStrs = new Map();
            this._stateSnapshotStrs.set(nodeId, currStr);
          }
          if (this._stateTimeline.length >= 500) this._stateTimeline.splice(0, this._stateTimeline.length - 499);
          this._stateTimeline.push({
            id: nodeId,
            name: entry.meta.name,
            componentFile: entry.meta.componentFile,
            oldValue: prev !== undefined ? prev : null,
            newValue: newSnapshot,
            timestamp: Date.now(),
          });
          this._stateSnapshots.set(nodeId, newSnapshot);
          this._scheduleTimelineUpdate();
        } catch { /* ignore non-serializable */ }
      }
    },

    _scheduleTimelineUpdate() {
      if (this._timelineDebounceTimer) clearTimeout(this._timelineDebounceTimer);
      this._timelineDebounceTimer = setTimeout(() => {
        if (import.meta.hot) {
          import.meta.hot.send('svelte-devtools:state-timeline', { changes: this._stateTimeline });
        }
      }, 300);
    },

    getStateTimeline() {
      return this._stateTimeline;
    },

    clearStateTimeline() {
      this._stateTimeline = [];
      this._scheduleTimelineUpdate();
    },

    // --- FPS Monitoring ---
    // Uses requestAnimationFrame to measure frame rate with minimal overhead.
    // Only stores timestamps - no allocations per frame beyond a single array push.
    _fpsFrameTimes: [],

    _fpsLoop() {
      this._fpsFrameTimes.push(performance.now());
      requestAnimationFrame(() => this._fpsLoop());
    },

    _sampleFps() {
      const now = performance.now();
      // Remove frame timestamps older than 1 second
      const cutoff = now - 1000;
      let i = 0;
      while (i < this._fpsFrameTimes.length && this._fpsFrameTimes[i] < cutoff) i++;
      if (i > 0) this._fpsFrameTimes.splice(0, i);
      const fps = this._fpsFrameTimes.length;
      if (import.meta.hot) {
        import.meta.hot.send('svelte-devtools:fps', { timestamp: Date.now(), fps });
      }
    }
  };

  window.__SVELTE_DEVTOOLS__ = __SVELTE_DT;

  // Poll state values for timeline
  setInterval(() => { __SVELTE_DT._pollStateValues(); }, 200);

  // FPS monitoring
  requestAnimationFrame(() => __SVELTE_DT._fpsLoop());
  setInterval(() => __SVELTE_DT._sampleFps(), 500);

  // Phase 3: Capture runtime errors
  window.addEventListener('error', (event) => {
    if (import.meta.hot) {
      import.meta.hot.send('svelte-devtools:runtime-error', {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack || '',
        timestamp: Date.now(),
      });
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (import.meta.hot) {
      const reason = event.reason;
      import.meta.hot.send('svelte-devtools:runtime-error', {
        message: reason?.message || String(reason),
        stack: reason?.stack || '',
        timestamp: Date.now(),
      });
    }
  });

  // Listen for reactive graph requests from server
  if (import.meta.hot) {
    import.meta.hot.on('svelte-devtools:request-reactive-graph', () => {
      __SVELTE_DT.sendReactiveGraph();
    });
    import.meta.hot.on('svelte-devtools:request-state-timeline', () => {
      import.meta.hot.send('svelte-devtools:state-timeline', { changes: __SVELTE_DT._stateTimeline });
    });
    import.meta.hot.on('svelte-devtools:clear-state-timeline', () => {
      __SVELTE_DT.clearStateTimeline();
    });
  }
}
`
