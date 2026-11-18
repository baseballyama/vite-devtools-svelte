// Deterministic: fake timers and an injected clock, never wall-clock ratios.
import { describe, expect, it, vi } from 'vitest';

import { countVisits, createRuntime, mountList, pollFn, type Harness } from './harness.js';

const graphReplies = (h: Harness) =>
  h.sent.filter(s => s.event === 'svelte-devtools:reactive-graph').map(s => s.data as any);
const timelineMsgs = (h: Harness) =>
  h.sent.filter(s => s.event === 'svelte-devtools:state-timeline').map(s => s.data as any);

const droppedIn = (msgs: any[]) => msgs.flatMap(m => m.dropped ?? []);

/** Iteration visits of a scoped graph build in an app of `n` chains. */
function scopedVisits(n: number) {
  const h = createRuntime();
  const { ids } = chainApp(h, n);
  return countVisits(() => {
    h.dt.getReactiveGraph(ids[0]);
  });
}

function chainApp(h: Harness, n: number) {
  const ids: number[] = [];
  const sigs: any[] = [];
  for (let i = 0; i < n; i++) {
    const id = h.dt.register('/app/src/lib/C.svelte');
    const a: any = { v: i, deps: null, reactions: [] };
    const b: any = { v: i * 2, deps: [a], reactions: [] };
    a.reactions.push(b);
    h.dt.trackState(a, 'a', id);
    h.dt.trackDerived(b, 'b', id);
    h.dt.registered(id);
    ids.push(id);
    sigs.push(a, b);
  }
  return { ids, sigs };
}

describe('reactive graph', () => {
  it('scoped: O(scope) work — dereferences only the scope, not the other 2 000 components', () => {
    const h = createRuntime();
    const { ids } = chainApp(h, 2000);
    const counter = { derefs: 0 };
    for (const entry of h.dt._reactiveNodes.values()) {
      const inner = entry.signal;
      entry.signal = {
        deref() {
          counter.derefs++;
          return inner.deref();
        },
      };
    }
    const g = h.dt.getReactiveGraph(ids[7]);
    expect(g.nodes.map((n: any) => n.id).toSorted()).toEqual([`${ids[7]}:a`, `${ids[7]}:b`]);
    expect(g.edges).toEqual([{ from: `${ids[7]}:a`, to: `${ids[7]}:b` }]);
    expect(counter.derefs).toBeLessThan(10);
    expect(g).toMatchObject({
      scope: ids[7],
      truncated: false,
      edgesOmitted: 0,
      policy: 'scoped',
      total: { nodes: 2, nodesKind: 'registered', edges: 1 },
    });
  });

  it('scoped cost does not grow with the rest of the app (visit counting)', () => {
    expect(scopedVisits(4000)).toBeLessThan(scopedVisits(500) + 50);
  });

  it('global: caps apply while building; edges only between included nodes; totals not guessed', () => {
    const h = createRuntime();
    chainApp(h, 10); // 20 nodes, 10 edges
    const g = h.dt.getReactiveGraph(null, { maxNodes: 5, maxEdges: 100 });
    expect(g.nodes).toHaveLength(5);
    const ids = new Set(g.nodes.map((n: any) => n.id));
    const endpoints: unknown[] = g.edges.flatMap((e: any) => [e.from, e.to]);
    expect(endpoints.filter(id => !ids.has(id))).toEqual([]);
    expect(g.truncated).toBe(true);
    expect(g.policy).toBe('global-head');
    expect(g.total).toEqual({ nodes: 20, nodesKind: 'registered', edges: null });

    const full = h.dt.getReactiveGraph(null, {});
    expect(full.nodes).toHaveLength(20);
    expect(full.truncated).toBe(false);
    expect(full.total).toEqual({ nodes: 20, nodesKind: 'registered', edges: 10 });
  });

  it('maxEdges: edges past the cap are counted, not sent', () => {
    const h = createRuntime();
    chainApp(h, 10);
    const g = h.dt.getReactiveGraph(null, { maxEdges: 3 });
    expect(g.edges).toHaveLength(3);
    expect(g.edgesOmitted).toBe(7);
    expect(g.truncated).toBe(true);
  });

  it('M1: echoes requestId + epoch, ignores other epochs; an old server ({}) gets the default caps', () => {
    const h = createRuntime();
    const { ids } = chainApp(h, 3);
    const epoch = h.dt._epoch;
    h.emit('svelte-devtools:request-reactive-graph', {
      requestId: 'r1',
      epoch: 'other',
      componentId: ids[0],
    });
    expect(graphReplies(h)).toHaveLength(0);
    const before = Date.now();
    h.emit('svelte-devtools:request-reactive-graph', {
      requestId: 'r2',
      epoch,
      componentId: ids[0],
      maxNodes: 1,
    });
    const [r2] = graphReplies(h);
    expect(r2).toMatchObject({ requestId: 'r2', epoch, scope: ids[0], truncated: true });
    // freshness: a numeric build time, not earlier than the request
    expect(typeof r2.computedAt).toBe('number');
    expect(r2.computedAt).toBeGreaterThanOrEqual(before);
    expect(r2.nodes).toHaveLength(1);
    h.emit('svelte-devtools:request-reactive-graph', {});
    const old = graphReplies(h).at(-1);
    expect(old.requestId).toBeUndefined();
    expect(old.scope).toBeNull();
    expect(old.nodes).toHaveLength(6);
  });

  it('forgetting a node removes its WeakMap entry', () => {
    const h = createRuntime();
    const list = mountList(h, 2, 1);
    const sig = list.signals[0];
    expect(h.dt._idBySignal.has(sig)).toBe(true);
    h.dt.unmount(list.ids[0]);
    expect(h.dt._idBySignal.has(sig)).toBe(false);
  });
});

describe('time-sliced state poll', () => {
  it('visits every node within ceil(n / 4096) ticks and carries the cursor', () => {
    const h = createRuntime();
    const { signals } = mountList(h, 5000, 2); // 10 000 $state nodes
    const poll = pollFn(h);
    for (let t = 0; t < 3; t++) poll(); // initial snapshots: 3 ticks cover 10 000
    h.dt._stateTimeline.length = 0;
    const states = signals.filter((s: any) => s.deps === null);
    for (const s of [states[0], states[5000], states[9999]]) s.v = -1;
    for (let t = 0; t < 3; t++) poll();
    const seen = new Set(
      h.dt._stateTimeline.filter((c: any) => c.newValue === -1).map((c: any) => c.id),
    );
    expect(seen.size).toBe(3);
  });

  it('a slice visits at most 4096 nodes', () => {
    const h = createRuntime();
    mountList(h, 5000, 2);
    const poll = pollFn(h);
    const before = h.dt._pollCursor;
    poll();
    expect(h.dt._pollCursor - before).toBe(4096);
  });

  it('removal during a sweep keeps the dense index consistent (swap with last)', () => {
    const h = createRuntime();
    const list = mountList(h, 50, 2);
    const poll = pollFn(h);
    poll();
    for (const id of list.ids.slice(10, 30)) h.dt.unmount(id);
    const ids = h.dt._pollIds as string[];
    expect(ids.length).toBe(60);
    ids.forEach((id, i) => expect(h.dt._pollIndex.get(id)).toBe(i));
    expect(new Set(ids).size).toBe(ids.length);
    poll(); // no throw, cursor wraps
  });

  it('an object found changed but not serialized (budget spent) stays queued for a later tick', () => {
    let now = 0;
    let step = 0;
    const h = createRuntime({ clock: () => (now += step) });
    const id = h.dt.register('/app/src/lib/O.svelte');
    const sig: any = { v: { n: 1 }, wv: 1 };
    h.dt.trackState(sig, 'o', id);
    h.dt.registered(id);
    const poll = pollFn(h);
    poll();
    expect(h.dt._stateTimeline).toHaveLength(0); // first observation is a seed
    sig.v = { n: 2 };
    sig.wv = 2;
    step = 5; // every clock read advances 5 ms: the 2 ms serialization budget is spent at once
    poll();
    expect(h.dt._pollDirty.has(`${id}:o`)).toBe(true);
    expect(h.dt._stateTimeline).toHaveLength(0);
    step = 0;
    poll();
    expect(h.dt._pollDirty.has(`${id}:o`)).toBe(false);
    expect(h.dt._stateTimeline.map((c: any) => [c.oldValue, c.newValue])).toEqual([
      [{ n: 1 }, { n: 2 }],
    ]);
  });
});

function setup() {
  const h = createRuntime();
  const id = h.dt.register('/app/src/lib/T.svelte');
  h.dt.registered(id);
  const sigs: any[] = [];
  const add = (n: number) => {
    for (let i = 0; i < n; i++) {
      const sig: any = { v: i, wv: 1 };
      h.dt.trackState(sig, 's' + sigs.length, id);
      sigs.push(sig);
    }
  };
  return { h, add, sigs, poll: () => pollFn(h)() };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

describe('timeline throttle + disclosure', () => {
  it('does not starve under continuous change: one pending timer, never re-armed', () => {
    const { h, add, sigs, poll } = setup();
    add(1);
    poll();
    h.flushTimers();
    h.sent.length = 0;
    sigs[0].v = 1000;
    poll(); // every 200 ms
    const timer: unknown = h.dt._timelineDebounceTimer;
    for (let t = 1; t < 10; t++) {
      sigs[0].v = 1000 + t;
      poll();
      expect(h.dt._timelineDebounceTimer).toBe(timer); // armed once, never re-armed
    }
    expect(timer).not.toBeNull();
    h.flushTimers();
    const changes = timelineMsgs(h).flatMap(m => m.changes);
    expect(changes.map((c: any) => c.newValue)).toEqual(
      Array.from({ length: 10 }, (_, t) => 1000 + t),
    );
  });

  it('flushes immediately once 200 entries are unsent (no timer needed)', () => {
    const { h, add, sigs, poll } = setup();
    add(450);
    poll(); // seeds
    h.flushTimers();
    h.sent.length = 0;
    for (const sig of sigs) sig.v += 1000;
    poll();
    const sizes = timelineMsgs(h).map(m => m.changes.length);
    expect(sizes.slice(0, 2)).toEqual([200, 200]);
    h.flushTimers();
    expect(timelineMsgs(h).map(m => m.changes.length)).toEqual([200, 200, 50]);
  });

  it('reports unsent entries removed by the ring as dropped (runtime-count), pushed ones not', () => {
    const { h, add, sigs, poll } = setup();
    h.dt._active = false; // record without pushing
    add(700);
    poll(); // seeds
    for (const sig of sigs) sig.v += 1000;
    poll();
    expect(h.dt.getStateTimeline().length).toBe(500);
    h.sent.length = 0; // drop the activation snapshot sent at boot
    h.dt._active = true;
    h.dt._flushTimeline();
    const [first] = timelineMsgs(h);
    expect(first.dropped).toEqual([{ reason: 'runtime-count', count: 200 }]);
    // already-pushed entries removed later are not counted
    h.sent.length = 0;
    h.dt._active = false;
    add(10);
    poll(); // seeds
    for (const sig of sigs.slice(-10)) sig.v += 1000;
    poll();
    h.dt._active = true;
    h.dt._flushTimeline();
    expect(timelineMsgs(h)[0].dropped).toBeUndefined();
  });

  it('byte budget: unsent entries over 4 MB are dropped as runtime-bytes', () => {
    const { h } = setup();
    h.dt._active = false;
    const id = h.dt.register('/app/src/lib/B.svelte');
    h.dt.registered(id);
    const entry = { meta: { componentId: id, name: 'big', componentFile: 'B.svelte' } };
    for (let i = 0; i < 300; i++) h.dt._recordChange(`${id}:big${i}`, entry, null, i, 30000);
    expect(h.dt._timelineBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    h.dt._active = true;
    const msgs = h.dt._timelineDeltas();
    const dropped = msgs[0].dropped;
    expect(dropped.find((d: any) => d.reason === 'runtime-bytes').count).toBeGreaterThan(0);
    const kept = msgs.flatMap((m: any) => m.changes).length;
    expect(kept + dropped.reduce((s: number, d: any) => s + d.count, 0)).toBe(300);
  });

  it('valueTooLarge counts changes recorded only as a size summary', () => {
    const { h } = setup();
    const id = h.dt.register('/app/src/lib/L.svelte');
    const sig: any = { v: Array.from({ length: 50_000 }, (_, i) => ({ i })), wv: 1 };
    h.dt.trackState(sig, 'big', id);
    h.dt.registered(id);
    pollFn(h)(); // seed: not a change, not counted
    expect(h.dt._valueTooLarge).toBe(0);
    sig.v = Array.from({ length: 50_000 }, (_, i) => ({ i: -i }));
    sig.wv = 2;
    pollFn(h)();
    const msg = h.dt._timelineDeltas()[0];
    expect(msg.valueTooLarge).toBe(1);
  });

  it('activation snapshot (reset) also carries pending disclosure', () => {
    const h = createRuntime({ active: false });
    const id = h.dt.register('/app/src/lib/T.svelte');
    h.dt.registered(id);
    const entry = { meta: { componentId: id, name: 'x', componentFile: 'T.svelte' } };
    for (let i = 0; i < 520; i++) h.dt._recordChange(`${id}:x${i}`, entry, null, i, 10);
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true });
    const reset = timelineMsgs(h).find(m => m.reset);
    expect(reset.dropped).toEqual([{ reason: 'runtime-count', count: 20 }]);
  });

  // Ring contract (500 entries / 4 MB on every read, whenever it is trimmed
  // internally): checked only through reads and pushed messages, plus the raw
  // memory guard (at most 2 x 500 entries held between trims).
  const MB4 = 4 * 1024 * 1024;
  function ring() {
    const { h } = setup();
    const id = h.dt.register('/app/src/lib/R.svelte');
    h.dt.registered(id);
    const entry = { meta: { componentId: id, name: 'r', componentFile: 'R.svelte' } };
    const record = (newValue: unknown, approxBytes = 10) =>
      h.dt._recordChange(`${id}:r`, entry, null, newValue, approxBytes);
    // activate and push what is pending; returns the messages it sent
    const flush = () => {
      h.sent.length = 0;
      h.dt._active = true;
      h.dt._flushTimeline();
      h.flushTimers();
      return timelineMsgs(h);
    };
    const expectMemoryBound = () => {
      expect(h.dt._stateTimeline.length).toBeLessThanOrEqual(1000);
      expect(h.dt._timelineBytes).toBeLessThanOrEqual(MB4);
    };
    h.sent.length = 0; // drop the activation snapshot sent at boot
    return { h, record, flush, expectMemoryBound };
  }

  it.each([
    { n: 0, keptFrom: 0, dropped: [] },
    { n: 1, keptFrom: 0, dropped: [] },
    { n: 500, keptFrom: 0, dropped: [] },
    { n: 501, keptFrom: 1, dropped: [{ reason: 'runtime-count', count: 1 }] },
    { n: 1000, keptFrom: 500, dropped: [{ reason: 'runtime-count', count: 500 }] },
    { n: 1001, keptFrom: 501, dropped: [{ reason: 'runtime-count', count: 501 }] },
  ])(
    'ring: inactive $n changes -> newest min(n, 500) in order, runtime-count = n - 500',
    ({ n, keptFrom, dropped }) => {
      const { h, record, flush, expectMemoryBound } = ring();
      h.dt._active = false; // record without pushing
      for (let i = 0; i < n; i++) record(i);
      expectMemoryBound(); // before any read trims
      const kept = range(keptFrom, n);
      expect(h.dt.getStateTimeline().map((c: any) => c.newValue)).toEqual(kept);
      const msgs = flush();
      expect(msgs.flatMap(m => m.changes).map((c: any) => c.newValue)).toEqual(kept);
      expect(droppedIn(msgs)).toEqual(dropped);
      expectMemoryBound();
    },
  );

  it('ring: an entry over 4 MB is kept while newest, then dropped as runtime-bytes', () => {
    const { h, record, flush, expectMemoryBound } = ring();
    h.dt._active = false;
    record('huge', MB4 + 1024);
    expect(h.dt.getStateTimeline().map((c: any) => c.newValue)).toEqual(['huge']);
    record('next');
    expect(h.dt.getStateTimeline().map((c: any) => c.newValue)).toEqual(['next']);
    const msgs = flush();
    expect(msgs.flatMap(m => m.changes).map((c: any) => c.newValue)).toEqual(['next']);
    expect(droppedIn(msgs)).toEqual([{ reason: 'runtime-bytes', count: 1 }]);
    expectMemoryBound();
  });

  it('ring: a 3 000-change burst while active is pushed whole, <= 200 per message, nothing dropped', () => {
    const { h, record, expectMemoryBound } = ring();
    for (let i = 0; i < 3000; i++) record(i);
    expectMemoryBound();
    h.flushTimers();
    const msgs = timelineMsgs(h);
    for (const m of msgs) {
      expect(m.changes.length).toBeLessThanOrEqual(200);
      expect(m.dropped).toBeUndefined();
    }
    expect(msgs.flatMap(m => m.changes).map((c: any) => c.newValue)).toEqual(range(0, 3000));
    expect(h.dt.getStateTimeline().map((c: any) => c.newValue)).toEqual(range(2500, 3000));
    expectMemoryBound();
  });

  it('ring: clearStateTimeline() after 700 inactive changes discloses the 200 over the cap', () => {
    const { h, record, flush, expectMemoryBound } = ring();
    h.dt._active = false;
    for (let i = 0; i < 700; i++) record(i);
    h.dt.clearStateTimeline();
    expect(h.dt.getStateTimeline()).toHaveLength(0);
    const [first, ...rest] = flush();
    expect(first.reset).toBe(true);
    expect(first.changes).toEqual([]);
    expect(first.dropped).toEqual([{ reason: 'runtime-count', count: 200 }]);
    expect(rest).toEqual([]);
    expect(h.dt.getStateTimeline()).toHaveLength(0);
    expectMemoryBound();
  });
});

describe('reactive summary', () => {
  it('O(1) counters: rows + other = total, ranked by sampled changes, top-K', () => {
    let now = 10_000;
    const h = createRuntime({ clock: () => now });
    const list = mountList(h, 20, 1); // per row: 1 state, 1 derived, 1 effect
    const poll = pollFn(h);
    poll();
    // row 3 changes 3 times, row 5 once
    const states = list.signals.filter((s: any) => s.deps === null);
    states[5].v += 100; // seen by the first poll below, like row 3's first change
    for (let t = 0; t < 3; t++) {
      now += 200;
      states[3].v += 100;
      poll();
    }
    const before = Date.now();
    const s = h.dt.getReactiveSummary({ topK: 1 });
    expect(s.policy).toBe('sampled-200ms');
    expect(s.coverage).toBe('component-init');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].componentId).toBe(list.ids[3]);
    expect(s.rows[0].changes).toBe(3);
    expect(s.rows[0].nodes).toEqual({ state: 1, derived: 1, effect: 1 });
    expect(s.truncated).toBe(true);
    expect(s.components.total).toBe(21);
    expect(s.rows.length + s.other.components).toBe(s.components.total);
    expect(
      s.rows[0].nodes.state + s.rows[0].nodes.derived + s.rows[0].nodes.effect + s.other.nodes,
    ).toBe(60);
    expect(s.capabilities).toEqual({
      valueInspection: false,
      signalHistory: false,
      writeCause: false,
    });
    expect(s.rows[0].lastActiveAt).toBeLessThanOrEqual(before);
    expect(s.computedAt).toBeGreaterThanOrEqual(before);
    expect(s.components.withActivity).toBe(2);
    expect(s).not.toHaveProperty('window');
  });

  it('ties rank by renders, then render ms, then the most recently active', () => {
    const h = createRuntime();
    const list = mountList(h, 4, 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1000);
      h.dt.recordRender(list.ids[0]);
      h.dt.recordRenderTime(list.ids[0], 1);
      vi.setSystemTime(2000);
      h.dt.recordRender(list.ids[1]);
      h.dt.recordRenderTime(list.ids[1], 1);
      h.dt.recordRender(list.ids[2]);
      h.dt.recordRenderTime(list.ids[2], 5);
      h.dt.recordRender(list.ids[3]);
      h.dt.recordRender(list.ids[3]);
    } finally {
      vi.useRealTimers();
    }
    const rows = h.dt.getReactiveSummary({}).rows;
    expect(rows.map((r: any) => r.componentId)).toEqual([3, 2, 1, 0].map(i => list.ids[i]));
    expect(rows.map((r: any) => r.lastActiveAt)).toEqual([2000, 2000, 2000, 1000]);
  });

  it('topK keeps the highest ranked rows whatever the activity order', () => {
    const h = createRuntime();
    const list = mountList(h, 30, 1);
    // distinct render counts in a scrambled order: instance i renders (i * 7) % 30 times
    const entries = list.ids.map((id: number, i: number) => ({ id, renders: (i * 7) % 30 }));
    for (const e of entries) for (let n = 0; n < e.renders; n++) h.dt.recordRender(e.id);
    const expected = entries
      .filter(e => e.renders > 0)
      .toSorted((x, y) => y.renders - x.renders)
      .slice(0, 5)
      .map(e => e.id);
    const s = h.dt.getReactiveSummary({ topK: 5 });
    expect(s.rows.map((r: any) => r.componentId)).toEqual(expected);
    expect(s.truncated).toBe(true);
    expect(s.components.withActivity).toBe(29);
  });

  it('totals accumulate since mount (no time window) and leave with a destroyed instance', () => {
    let now = 0;
    const h = createRuntime({ clock: () => now });
    const list = mountList(h, 3, 1);
    const poll = pollFn(h);
    poll();
    const state = list.signals.filter((s: any) => s.deps === null)[1];
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let t = 0; t < 4; t++) {
        // 15 s apart: far beyond the former 10 s window
        now += 15_000;
        vi.setSystemTime(now);
        state.v += 1;
        poll();
        h.dt.recordRender(list.ids[1]);
      }
      now += 60_000;
      vi.setSystemTime(now);
      const s = h.dt.getReactiveSummary({});
      const row = s.rows.find((r: any) => r.componentId === list.ids[1]);
      expect(row).toMatchObject({ changes: 4, renders: 4, lastActiveAt: 60_000 });
      expect(s.components.withActivity).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    h.dt.unmount(list.ids[1]);
    const s = h.dt.getReactiveSummary({});
    expect(s.rows).toEqual([]);
    expect(s.components).toEqual({ total: 3, withActivity: 0 });
    expect(h.dt._activity.has(list.ids[1])).toBe(false);
  });

  it('counts follow unmount, re-tracking a signal, and same-name signals', () => {
    const h = createRuntime();
    const list = mountList(h, 3, 2);
    expect(h.dt._nodeTotals).toEqual({ state: 6, derived: 3, effect: 3 });
    h.dt.trackDerived(list.signals[0], 's0', list.ids[0]); // same signal, other type
    expect(h.dt._nodeTotals).toEqual({ state: 5, derived: 4, effect: 3 });
    // another signal under a taken name ({@const} in {#each}): a new node
    h.dt.trackDerived({ v: 0, deps: null }, 's0', list.ids[0]);
    expect(h.dt._nodeTotals).toEqual({ state: 5, derived: 5, effect: 3 });
    h.dt.unmount(list.ids[0]);
    expect(h.dt._nodeCounts.has(list.ids[0])).toBe(false);
  });

  it('answers request-reactive-summary with requestId + epoch, ignores other epochs', () => {
    const h = createRuntime();
    mountList(h, 2);
    h.emit('svelte-devtools:request-reactive-summary', { requestId: 1, epoch: 'other' });
    h.emit('svelte-devtools:request-reactive-summary', {
      requestId: 2,
      epoch: h.dt._epoch,
      topK: 5,
    });
    const replies = h.sent
      .filter(s => s.event === 'svelte-devtools:reactive-summary')
      .map(s => s.data as any);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ requestId: 2, epoch: h.dt._epoch });
  });
});

// A page loaded inactive and activated by an MCP lease: a click right after
// activation must be seen as 1 -> 2 although nodes registered while inactive
// have no sample yet. First observations are seeds (no entry, no counters),
// and readiness is disclosed.
const summaryOf = (h: Harness) => h.dt.getReactiveSummary({});

describe('late activation (consumer arrives after mount)', () => {
  it('activation seeds: 0 entries, 0 activity, 0 drops; baseline complete', () => {
    const h = createRuntime({ active: false });
    const id = h.dt.register('/app/src/lib/Counter.svelte');
    h.dt.trackState({ v: 1, wv: 1 }, 'count', id);
    h.dt.trackState({ v: { a: 1 }, wv: 1 }, 'obj', id);
    h.dt.registered(id);
    expect(summaryOf(h).baseline).toEqual({ complete: false, pendingNodes: 2 });
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true });
    const reset = timelineMsgs(h).find(m => m.reset);
    expect(reset.changes).toEqual([]);
    expect(reset.dropped).toBeUndefined();
    expect(reset.baseline).toEqual({ complete: true, pendingNodes: 0 });
    expect(h.dt._stateTimeline).toHaveLength(0);
    const s = summaryOf(h);
    expect(s.rows).toEqual([]);
    expect(s.components.withActivity).toBe(0);
    expect(s.baseline).toEqual({ complete: true, pendingNodes: 0 });
  });

  it('a write right after activation is exactly one old -> new entry, counted once', () => {
    const h = createRuntime({ active: false });
    const id = h.dt.register('/app/src/lib/Counter.svelte');
    const count: any = { v: 1, wv: 1 };
    h.dt.trackState(count, 'count', id);
    h.dt.registered(id);
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true });
    count.v = 2; // before the first 200 ms tick
    count.wv = 2;
    pollFn(h)();
    h.flushTimers();
    const seen = timelineMsgs(h)
      .flatMap(m => m.changes)
      .map((c: any) => [c.name, c.oldValue, c.newValue]);
    expect(seen).toEqual([['count', 1, 2]]);
    const row = summaryOf(h).rows.find((r: any) => r.componentId === id);
    expect(row.changes).toBe(1);
  });

  it('a component mounted after activation records nothing until a write', () => {
    const h = createRuntime();
    const poll = pollFn(h);
    poll();
    h.sent.length = 0;
    const id = h.dt.register('/app/src/lib/Late.svelte');
    const sig: any = { v: 'x', wv: 1 };
    h.dt.trackState(sig, 's', id);
    h.dt.registered(id);
    poll();
    h.flushTimers();
    expect(timelineMsgs(h).flatMap(m => m.changes)).toEqual([]);
    expect(summaryOf(h).rows).toEqual([]);
    sig.v = 'y';
    poll();
    h.flushTimers();
    const seen = timelineMsgs(h)
      .flatMap(m => m.changes)
      .map((c: any) => [c.oldValue, c.newValue]);
    expect(seen).toEqual([['x', 'y']]);
  });

  it('baseline stays incomplete while an object seed is pending (budget spent)', () => {
    let now = 0;
    let step = 0;
    const h = createRuntime({ active: false, clock: () => (now += step) });
    const id = h.dt.register('/app/src/lib/O.svelte');
    h.dt.trackState({ v: { n: 1 }, wv: 1 }, 'o', id);
    h.dt.registered(id);
    step = 5; // the 2 ms serialization budget is spent before the first object
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true });
    expect(summaryOf(h).baseline).toEqual({ complete: false, pendingNodes: 1 });
    step = 0;
    pollFn(h)();
    expect(summaryOf(h).baseline).toEqual({ complete: true, pendingNodes: 0 });
    expect(h.dt._stateTimeline).toHaveLength(0);
  });

  it('bounded activation work: one slice seeded, the rest pending, nothing recorded', () => {
    const h = createRuntime({ active: false });
    const id = h.dt.register('/app/src/lib/Big.svelte');
    for (let i = 0; i < 5000; i++) h.dt.trackState({ v: i, wv: 1 }, 's' + i, id);
    h.dt.registered(id);
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true });
    expect(h.dt._pollCursor).toBe(4096); // one hint slice at activation
    expect(summaryOf(h).baseline).toEqual({ complete: false, pendingNodes: 5000 - 4096 });
    const reset = timelineMsgs(h).find(m => m.reset);
    expect(reset.changes).toEqual([]);
    expect(reset.dropped).toBeUndefined();
    expect(reset.baseline).toEqual({ complete: false, pendingNodes: 5000 - 4096 });
    pollFn(h)(); // the next tick seeds the rest
    expect(summaryOf(h).baseline).toEqual({ complete: true, pendingNodes: 0 });
    expect(h.dt._stateTimeline).toHaveLength(0);
    // completion is pushed although nothing changed
    h.flushTimers();
    const last = timelineMsgs(h).at(-1);
    expect(last.changes).toEqual([]);
    expect(last.baseline).toEqual({ complete: true, pendingNodes: 0 });
  });
});
