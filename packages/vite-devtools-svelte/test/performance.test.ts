import { afterEach, describe, expect, it, vi } from 'vitest';

import { Collector, HOT_EVENTS, RUNTIME_REQUEST_TIMEOUT } from '../src/server/collector.js';
import type { HotChannel, HotClient } from '../src/server/collector.js';
import {
  MAX_RECORDING_MS,
  normalizeUpdate,
  PERF_LIMITS,
  PerformanceStore,
} from '../src/server/performance.js';

function fakeHot() {
  const listeners = new Map<string, (payload: unknown, client: HotClient) => void>();
  const sent: Array<{ event: string; payload: any }> = [];
  const hot: HotChannel = {
    send: (event, payload) => {
      sent.push({ event, payload });
    },
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    off: event => {
      listeners.delete(event);
    },
  };
  const emit = (event: string, payload: unknown, client?: HotClient) =>
    listeners.get(event)?.(payload, client ?? { send: () => {} });
  return { hot, sent, emit };
}

const update = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  start: id * 10,
  duration: 5,
  event: null,
  triggers: [],
  triggersOmitted: 0,
  components: 1,
  renders: 1,
  effects: 0,
  deriveds: 0,
  wastedDeriveds: 0,
  unchangedDeriveds: [],
  costs: [],
  costsOmitted: 0,
  droppedFrames: null,
  ...extra,
});

const many = (n: number, f: (i: number) => object) => Array.from({ length: n }, (_, i) => f(i));

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizeUpdate', () => {
  it('keeps a well-formed update as is', () => {
    const u = update(1, {
      event: { type: 'click', target: 'button#a', key: 'Enter' },
      triggers: [
        {
          nodeId: '1:count',
          name: 'count',
          scopeId: 1,
          scope: 'App',
          file: 'src/App.svelte',
          loc: { file: 'src/App.svelte', line: 3, column: 6 },
          during: false,
        },
      ],
      unchangedDeriveds: [
        { name: 'd', scope: 'App', file: 'src/App.svelte', runs: 2, unchanged: 1 },
      ],
      costs: [
        {
          file: 'src/App.svelte',
          name: 'App',
          kind: 'component',
          componentId: 1,
          instances: 1,
          rendered: 1,
          renderMs: 1,
          effectMs: 0,
          derivedMs: 0.5,
          renders: 1,
          effects: 0,
          deriveds: 1,
        },
      ],
      droppedFrames: 2,
    });
    expect(normalizeUpdate(u)).toEqual(u);
  });

  it('rejects what is not an update and repairs bad fields', () => {
    expect(normalizeUpdate(null)).toBeNull();
    expect(normalizeUpdate({ id: -1, start: 0 })).toBeNull();
    expect(normalizeUpdate({ id: 1, start: Number.NaN })).toBeNull();
    const u = normalizeUpdate({
      id: 1,
      start: 2,
      duration: -3,
      event: { target: 'x' },
      triggers: [
        null,
        { nodeId: 'a', scopeId: -1 },
        { nodeId: 'b', scopeId: 2, name: 5, loc: { file: '', line: 1, column: 1 } },
        { nodeId: 'c', scopeId: 2, loc: { file: 'f', line: 1.5, column: 0 } },
      ],
      costs: [{ kind: 'weird', renderMs: Infinity, file: 'x'.repeat(5000) }],
      droppedFrames: 'many',
    })!;
    expect(u.duration).toBe(0);
    expect(u.event).toBeNull();
    expect(u.triggers.map(t => [t.nodeId, t.name, t.loc])).toEqual([
      ['b', '', null],
      ['c', '', null],
    ]);
    expect(u.costs[0]).toMatchObject({ kind: 'other', renderMs: 0, componentId: null });
    expect(u.costs[0]!.file).toHaveLength(4096);
    expect(u.droppedFrames).toBeNull();
  });

  it('caps the per-update lists', () => {
    const u = normalizeUpdate(
      update(1, {
        triggers: many(40, i => ({ nodeId: `n${i}`, scopeId: 1 })),
        costs: many(40, () => ({})),
        unchangedDeriveds: many(40, () => ({})),
      }),
    )!;
    expect(u.triggers).toHaveLength(PERF_LIMITS.triggers);
    expect(u.costs).toHaveLength(PERF_LIMITS.costs);
    expect(u.unchangedDeriveds).toHaveLength(PERF_LIMITS.unchanged);
  });
});

describe('PerformanceStore', () => {
  it('accepts pushes for the current recording only, per page load', () => {
    const s = new PerformanceStore();
    expect(s.ingest({ recordingId: 'x', epoch: 'e1', updates: [update(1)] })).toBe(false);
    const { recordingId } = s.start();
    expect(s.active).toBe(true);
    expect(s.ingest({ recordingId: 'other', epoch: 'e1' })).toBe(false);
    expect(s.ingest({ recordingId, epoch: '' })).toBe(false);
    expect(s.ingest({ recordingId, epoch: 'e1', updates: [update(2), update(1), 'junk'] })).toBe(
      true,
    );
    s.ingest({ recordingId, epoch: 'e2', updates: [update(1), update(2), update(3)] });
    // served page load first, else the one with most updates
    expect(s.recording('e1').updates.map(u => u.id)).toEqual([1, 2]);
    expect(s.recording('e1').epoch).toBe('e1');
    expect(s.recording('unknown').epoch).toBe('e2');
    expect(s.recording('none').updates).toHaveLength(3);
    expect(s.settled).toBe(false);
    s.stop();
    s.ingest({ recordingId, epoch: 'e1', final: true });
    expect(s.settled).toBe(false);
    s.ingest({ recordingId, epoch: 'e2', final: true, components: [{ name: 'A', updates: 2 }] });
    expect(s.settled).toBe(true);
    const rec = s.recording('e2');
    expect(rec.state).toBe('idle');
    expect(rec.stoppedAt).not.toBeNull();
    expect(rec.components).toEqual([
      expect.objectContaining({ name: 'A', updates: 2, instances: 0, kind: 'other' }),
    ]);
  });

  it('caps updates and page loads, and reports what the runtime dropped', () => {
    const s = new PerformanceStore();
    const { recordingId } = s.start();
    const updates = Array.from({ length: PERF_LIMITS.updates + 5 }, (_, i) => update(i + 1));
    s.ingest({ recordingId, epoch: 'e1', updates, dropped: 2 });
    expect(s.recording('e1').updates).toHaveLength(PERF_LIMITS.updates);
    expect(s.recording('e1').droppedUpdates).toBe(5);
    const components = Array.from({ length: PERF_LIMITS.components + 1 }, () => ({}));
    s.ingest({ recordingId, epoch: 'e1', components });
    expect(s.recording('e1').components).toHaveLength(PERF_LIMITS.components);
    expect(s.recording('e1').componentsOmitted).toBe(true);
    for (let i = 2; i <= PERF_LIMITS.epochs + 1; i++) s.ingest({ recordingId, epoch: `e${i}` });
    expect(s.recording('e1').epoch).not.toBe('e1');
  });

  it('an empty recording before the first start', () => {
    expect(new PerformanceStore().recording('e1')).toEqual({
      state: 'idle',
      recordingId: null,
      startedAt: null,
      stoppedAt: null,
      epoch: null,
      updates: [],
      droppedUpdates: 0,
      components: [],
      componentsOmitted: false,
    });
  });
});

describe('Collector performance recording', () => {
  it('start tells every page; pushes are served; stop waits for the final pushes', async () => {
    const c = new Collector();
    const { hot, sent, emit } = fakeHot();
    c.attach(hot);
    const v0 = c.versions.performance;
    const { recordingId } = c.startPerformanceRecording();
    expect(sent.at(-1)).toEqual({
      event: HOT_EVENTS.performanceRecording,
      payload: { active: true, recordingId },
    });
    expect(c.versions.performance).not.toBe(v0);
    // a page loaded during the recording joins it
    const client = { send: vi.fn() };
    emit(HOT_EVENTS.runtimeReady, {}, client);
    expect(client.send).toHaveBeenCalledWith(HOT_EVENTS.performanceRecording, {
      active: true,
      recordingId,
    });
    emit(HOT_EVENTS.performance, { recordingId, epoch: 'e1', updates: [update(1)] });
    expect(c.performanceRecording.updates).toHaveLength(1);
    expect(c.performanceRecording.state).toBe('recording');
    const stopped = c.stopPerformanceRecording();
    expect(sent.at(-1)).toEqual({
      event: HOT_EVENTS.performanceRecording,
      payload: { active: false },
    });
    emit(HOT_EVENTS.performance, { recordingId, epoch: 'e1', updates: [update(2)], final: true });
    const rec = await stopped;
    expect(rec.state).toBe('idle');
    expect(rec.updates.map(u => u.id)).toEqual([1, 2]);
    // not recording: answered at once
    expect((await c.stopPerformanceRecording()).updates).toHaveLength(2);
    emit(HOT_EVENTS.runtimeReady, {}, client);
    expect(client.send).toHaveBeenCalledWith(HOT_EVENTS.performanceRecording, {
      active: false,
    });
  });

  it('stop gives up waiting after the runtime timeout, or when the channel goes away', async () => {
    vi.useFakeTimers();
    const c = new Collector();
    const { hot } = fakeHot();
    c.attach(hot);
    c.startPerformanceRecording();
    const stopped = c.stopPerformanceRecording();
    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_TIMEOUT);
    expect((await stopped).state).toBe('idle');
    c.startPerformanceRecording();
    const again = c.stopPerformanceRecording();
    c.detach();
    expect((await again).state).toBe('idle');
    // without a channel nobody is waited for
    c.startPerformanceRecording();
    expect((await c.stopPerformanceRecording()).state).toBe('idle');
  });

  it('a recording nobody stops ends after MAX_RECORDING_MS', async () => {
    vi.useFakeTimers();
    const c = new Collector();
    c.startPerformanceRecording();
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    expect(c.performanceRecording.state).toBe('idle');
  });

  it('ignores pushes of another recording', () => {
    const c = new Collector();
    const v = c.versions.performance;
    c.ingestPerformance({ recordingId: 'nope', epoch: 'e1', updates: [update(1)] });
    expect(c.versions.performance).toBe(v);
  });
});
