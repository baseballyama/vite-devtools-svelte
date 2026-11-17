// The runtime's performance recorder, driven like hooks.js drives it, over
// plain objects: a batch is `{ fork? }`, a reaction `{ kind, ctx }`, a
// component context `{ file, tracked? }` (registered via _idByContext).
import { describe, expect, it } from 'vitest';

import { createRuntime, fieldApi, type Harness } from './harness.js';

const PERF = 'svelte-devtools:performance';

/** An event target as the runtime reads it. */
const target = (localName: string, id = '', className: unknown = '') => ({
  localName,
  id,
  className,
});

function setup(opts: { active?: boolean } = {}) {
  let now = 0;
  const h = createRuntime({ clock: () => now, active: opts.active });
  h.dt._api = { ...fieldApi, kind: (r: any) => r.kind ?? fieldApi.kind(r) };
  const clock = {
    set: (t: number) => {
      now = t;
    },
  };
  const page = h.dt.register('/app/src/routes/+page.svelte');
  const row = h.dt.register('/app/src/lib/Row.svelte', page);
  const row2 = h.dt.register('/app/src/lib/Row.svelte', page);
  const ctx = (id: number) => {
    const c = { file: h.dt._instances.get(id).file };
    h.dt._idByContext.set(c, id);
    return c;
  };
  const ctxs = { page: ctx(page), row: ctx(row), row2: ctx(row2) };
  const count = { v: 0 };
  h.dt.trackState(count, 'count', page, null, '/app/src/routes/+page.svelte:4:6');
  return { h, clock, ids: { page, row, row2 }, ctxs, count };
}

/** Run `fn` as a reaction of `kind` in `ctx` from `start` to `end`. */
function run(
  s: ReturnType<typeof setup>,
  r: Record<string, unknown>,
  start: number,
  end: number,
  inside?: () => void,
) {
  s.clock.set(start);
  s.h.dt._perfRunStart(r);
  inside?.();
  s.clock.set(end);
  s.h.dt._perfRunEnd(r);
}

const pushes = (h: Harness) => h.sent.filter(m => m.event === PERF).map(m => m.data as any);
const updates = (h: Harness) => pushes(h).flatMap(p => p.updates);

function stop(s: ReturnType<typeof setup>) {
  s.h.dt.stopPerformance();
  return updates(s.h);
}

describe('performance recording', () => {
  it('does nothing while not recording', () => {
    const s = setup();
    const batch = {};
    s.h.dt._perfWritten(s.count, batch);
    s.h.dt._perfFlushStart(batch);
    run(s, { kind: 'render', ctx: s.ctxs.page }, 1, 2);
    s.h.dt._perfFlushEnd(batch);
    s.h.dt._perfCommitted(batch);
    s.h.dt._perfDiscarded(batch);
    s.h.dt.stopPerformance();
    expect(s.h.dt._perf).toBeNull();
    expect(pushes(s.h)).toEqual([]);
    expect(s.h.windowListeners.has('click')).toBe(false);
  });

  it('subscribes the listener only while recording', () => {
    const s = setup();
    let subscribed = 0;
    s.h.dt._subscribePerf = () => {
      subscribed++;
      return () => subscribed--;
    };
    s.h.dt.startPerformance('r1');
    s.h.dt.startPerformance('r1'); // the same recording again (runtime-ready reply)
    expect(subscribed).toBe(1);
    expect(s.h.windowListeners.get('click')).toHaveLength(2);
    s.h.dt.stopPerformance();
    expect(subscribed).toBe(0);
    expect(s.h.windowListeners.get('click')).toEqual([]);
  });

  it('self time: a nested run is subtracted from the run around it', () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    const batch = {};
    s.h.dt._perfWritten(s.count, batch);
    s.clock.set(0);
    s.h.dt._perfFlushStart(batch);
    // page block 0..10 runs a row render 2..8, which reads a page derived 3..4
    run(s, { kind: 'block', ctx: s.ctxs.page }, 0, 10, () =>
      run(s, { kind: 'render', ctx: s.ctxs.row }, 2, 8, () =>
        run(s, { kind: 'derived', ctx: s.ctxs.page, v: 1 }, 3, 4),
      ),
    );
    run(s, { kind: 'effect', ctx: s.ctxs.row2 }, 10, 11);
    s.clock.set(12);
    s.h.dt._perfFlushEnd(batch);
    const [u] = stop(s);
    expect(u).toMatchObject({ duration: 12, renders: 2, effects: 1, deriveds: 1, components: 2 });
    const byName = Object.fromEntries(u.costs.map((c: any) => [c.name, c]));
    expect(byName['+page']).toMatchObject({ renderMs: 4, derivedMs: 1, instances: 1 });
    expect(byName.Row).toMatchObject({ renderMs: 5, effectMs: 1, instances: 2, renders: 1 });
    // heaviest first
    expect(u.costs.map((c: any) => c.name)).toEqual(['Row', '+page']);
    expect(u.triggers).toEqual([
      {
        nodeId: `${s.ids.page}:count`,
        name: 'count',
        scopeId: s.ids.page,
        scope: '+page',
        file: '/app/src/routes/+page.svelte',
        loc: { file: '/app/src/routes/+page.svelte', line: 4, column: 6 },
        during: false,
      },
    ]);
  });

  it('wasted deriveds: a re-run returning the value it had (compared after Svelte stores it)', () => {
    const s = setup();
    const same = { kind: 'derived', ctx: s.ctxs.row, v: 'a' };
    const changed = { kind: 'derived', ctx: s.ctxs.row, v: 1 };
    const first = { kind: 'derived', ctx: s.ctxs.row, v: Symbol('uninitialized') };
    s.h.dt.trackDerived(same, 'isRead', s.ids.row);
    s.h.dt.startPerformance('r1');
    const batch = {};
    s.h.dt._perfFlushStart(batch);
    run(s, same, 1, 2);
    run(s, changed, 2, 3);
    changed.v = 2; // the new value, stored after its run ended
    run(s, first, 3, 4);
    (first as any).v = 'x';
    run(s, same, 4, 5);
    s.h.dt._perfFlushEnd(batch);
    const [u] = stop(s);
    expect(u.deriveds).toBe(4);
    expect(u.wastedDeriveds).toBe(2);
    expect(u.unchangedDeriveds).toEqual([
      { name: 'isRead', scope: 'Row', file: '/app/src/lib/Row.svelte', runs: 2, unchanged: 2 },
    ]);
  });

  it('a fork: its writes count once it is committed and flushed; a discarded one is forgotten', () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    const fork = { fork: true };
    s.h.dt._perfWritten(s.count, fork);
    // the fork's own flush is not an update
    s.h.dt._perfFlushStart(fork);
    run(s, { kind: 'render', ctx: s.ctxs.page }, 1, 2);
    s.h.dt._perfFlushEnd(fork);
    expect(s.h.dt._perf.seq).toBe(0);
    // commit: the same batch is flushed as a normal one
    fork.fork = false;
    s.h.dt._perfFlushStart(fork);
    run(s, { kind: 'render', ctx: s.ctxs.page }, 3, 4);
    s.h.dt._perfFlushEnd(fork);
    const discarded = { fork: true };
    s.h.dt._perfWritten(s.count, discarded);
    s.h.dt._perfDiscarded(discarded);
    const other = {};
    s.h.dt._perfFlushStart(other);
    run(s, { kind: 'render', ctx: s.ctxs.page }, 5, 6);
    s.h.dt._perfFlushEnd(other);
    const [committed, next] = stop(s);
    expect(committed.triggers.map((t: any) => t.name)).toEqual(['count']);
    expect(committed.renders).toBe(1);
    expect(next.triggers).toEqual([]);
  });

  it('a batch committed inside another flush adds its writes; writes during the update are marked', () => {
    const s = setup();
    const other = { v: 1 };
    s.h.dt.trackState(other, 'other', s.ids.row);
    s.h.dt.startPerformance('r1');
    const a = {};
    const b = {};
    s.h.dt._perfWritten(s.count, a);
    s.h.dt._perfFlushStart(a);
    s.h.dt._perfWritten(other, b);
    s.h.dt._perfWritten(other, b); // once per batch
    // nested flush (flushSync in an effect) belongs to the running update
    s.h.dt._perfFlushStart(b);
    s.h.dt._perfFlushEnd(b);
    s.h.dt._perfCommitted(a);
    s.h.dt._perfFlushEnd(a);
    // committed outside an update: dropped
    const late = {};
    s.h.dt._perfWritten(s.count, late);
    s.h.dt._perfCommitted(late);
    const [u, ...rest] = stop(s);
    expect(rest).toEqual([]);
    expect(u.triggers.map((t: any) => [t.name, t.during])).toEqual([
      ['other', true],
      ['count', false],
    ]);
  });

  it('reactions outside a tracked component: library file, ancestor, module derived, outside', () => {
    const s = setup();
    const module = s.h.dt.moduleScope('/app/src/lib/store.svelte.js');
    const moduleDerived = { kind: 'derived', v: 1 };
    s.h.dt.trackDerived(moduleDerived, 'total', module);
    s.h.dt.startPerformance('r1');
    const batch = {};
    s.h.dt._perfFlushStart(batch);
    run(s, { kind: 'render', ctx: { file: 'node_modules/ui/Button.svelte' } }, 0, 1);
    run(s, { kind: 'render', ctx: { file: undefined, tracked: s.ids.row } }, 1, 2);
    run(s, moduleDerived, 2, 3);
    run(s, { kind: 'effect', ctx: null }, 3, 4);
    run(s, { kind: 'render', ctx: { file: undefined } }, 4, 5);
    // not the running reaction: ignored
    s.h.dt._perfRunEnd({ kind: 'render' });
    s.h.dt._perfFlushEnd(batch);
    const [u] = stop(s);
    const kinds = Object.fromEntries(u.costs.map((c: any) => [c.name, [c.kind, c.file]]));
    expect(kinds).toEqual({
      Button: ['library', 'node_modules/ui/Button.svelte'],
      Row: ['component', '/app/src/lib/Row.svelte'],
      'store.svelte.js': ['module', '/app/src/lib/store.svelte.js'],
      '(outside components)': ['other', ''],
    });
    expect(u.components).toBe(1);
  });

  it('a flush where nothing ran and nothing was written is not an update', () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    const batch = {};
    s.h.dt._perfFlushStart(batch);
    s.h.dt._perfFlushEnd(batch);
    expect(stop(s)).toEqual([]);
  });

  it('attributes an update to the input event dispatched in the same task only', async () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    const dispatch = (type: string, event: Record<string, unknown>) => {
      for (const cb of s.h.windowListeners.get(type)!) cb({ type, ...event });
    };
    const update = () => {
      const batch = {};
      s.h.dt._perfWritten(s.count, batch);
      s.h.dt._perfFlushStart(batch);
      s.h.dt._perfFlushEnd(batch);
    };
    dispatch('click', { target: target('button', '', 'svelte-abc send primary') });
    update();
    dispatch('keydown', { key: 'Enter', target: target('input', 'q') });
    update();
    dispatch('keydown', { key: 'a', target: target('input', 'q') });
    update();
    // after the event finished dispatching (bubble listener + microtask): no event
    dispatch('click', { target: { nodeType: 3 } });
    await Promise.resolve();
    update();
    // the next task clears an event whose bubble phase was stopped
    dispatch('submit', { target: target('form', '', { baseVal: '' }) });
    s.h.flushTimers();
    update();
    const events = stop(s).map((u: any) => u.event);
    expect(events).toEqual([
      { type: 'click', target: 'button.send' },
      { type: 'keydown', target: 'input#q', key: 'Enter' },
      { type: 'keydown', target: 'input#q' },
      null,
      null,
    ]);
  });

  it('dropped frames from the animation frame gap that contains the update', () => {
    // inactive: no FPS sampling loop asking for frames too
    const s = setup({ active: false });
    s.h.dt.startPerformance('r1');
    const update = (start: number, end: number) => {
      const batch = {};
      s.clock.set(start);
      s.h.dt._perfFlushStart(batch);
      run(s, { kind: 'render', ctx: s.ctxs.page }, start, end);
      s.h.dt._perfFlushEnd(batch);
    };
    update(0, 1); // before the first frame: no gap to measure
    s.h.frame(100);
    s.h.frame(116);
    update(120, 170);
    s.h.frame(182); // 66 ms = 4 frames: 3 dropped
    update(190, 191);
    s.h.frame(5000); // hidden tab: not a measurement
    update(5001, 5002);
    const frames = stop(s).map((u: any) => u.droppedFrames);
    expect(frames).toEqual([null, 3, null, null]);
    // stopped: the loop ends
    const before = s.h.rafCallbacks;
    s.h.frame(5100);
    expect(s.h.rafCallbacks).toBe(before);
  });

  it('pushes new updates at most once a second, the rest when stopped', () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    const update = () => {
      const batch = {};
      s.h.dt._perfWritten(s.count, batch);
      s.h.dt._perfFlushStart(batch);
      s.h.dt._perfFlushEnd(batch);
    };
    update();
    update();
    expect(s.h.pendingDelays()).toContain(1000);
    s.h.flushTimers();
    expect(pushes(s.h).map(p => [p.updates.length, p.final])).toEqual([[2, false]]);
    update();
    s.h.dt.stopPerformance();
    const all = pushes(s.h);
    expect(all.map(p => [p.updates.length, p.final, p.recordingId])).toEqual([
      [2, false, 'r1'],
      [1, true, 'r1'],
    ]);
    expect(all[1].epoch).toBe(s.h.dt._epoch);
  });

  it('caps kept updates and per-update lists; totals still count everything', () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    // 20 written states in one update
    const batch = {};
    for (let i = 0; i < 20; i++) {
      const sig = { v: i };
      s.h.dt.trackState(sig, `s${i}`, s.ids.page);
      s.h.dt._perfWritten(sig, batch);
    }
    s.h.dt._perfFlushStart(batch);
    // 40 component instances of distinct files
    for (let i = 0; i < 40; i++) {
      const id = s.h.dt.register(`/app/src/lib/C${i}.svelte`, s.ids.page);
      const c = { file: `/app/src/lib/C${i}.svelte` };
      s.h.dt._idByContext.set(c, id);
      run(s, { kind: 'render', ctx: c }, i, i + 1);
    }
    s.h.dt._perfFlushEnd(batch);
    s.h.dt._perf.kept = 2000;
    const more = {};
    s.h.dt._perfWritten(s.count, more);
    s.h.dt._perfFlushStart(more);
    s.h.dt._perfFlushEnd(more);
    s.h.dt.stopPerformance();
    const [p] = pushes(s.h);
    expect(p.updates).toHaveLength(1);
    expect(p.dropped).toBe(1);
    const [u] = p.updates;
    expect(u.triggers).toHaveLength(16);
    expect(u.triggersOmitted).toBe(4);
    expect(u.costs).toHaveLength(30);
    expect(u.costsOmitted).toBe(10);
    expect(p.components).toHaveLength(40);
    expect(p.componentsOmitted).toBe(false);
  });

  it('a new recording id replaces the running one; the hot message starts and stops', () => {
    const s = setup();
    s.h.emit('svelte-devtools:performance-recording', { active: true, recordingId: 'a' });
    expect(s.h.dt._perf.id).toBe('a');
    s.h.emit('svelte-devtools:performance-recording', { active: true, recordingId: 'b' });
    expect(s.h.dt._perf.id).toBe('b');
    expect(pushes(s.h).map(p => [p.recordingId, p.final])).toEqual([['a', true]]);
    s.h.emit('svelte-devtools:performance-recording', { active: true });
    expect(s.h.dt._perf).toBeNull();
  });

  it('ignores writes to untracked signals and run ends without a start', () => {
    const s = setup();
    s.h.dt.startPerformance('r1');
    const batch = {};
    s.h.dt._perfWritten({ v: 1 }, batch);
    s.h.dt._idBySignal.set(s.count, 'gone:node');
    s.h.dt._perfWritten(s.count, batch);
    s.h.dt._perfFlushStart(batch);
    s.h.dt._perfRunEnd({ kind: 'render' });
    s.h.dt._perfFlushEnd(batch);
    expect(stop(s)).toEqual([]);
  });
});
