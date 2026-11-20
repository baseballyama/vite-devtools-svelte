// Performance recording through real Svelte components: what one update
// (flush) is attributed to, from Svelte's own devtools events.
import { afterEach, describe, expect, it, vi } from 'vitest';

import PerfList from './fixtures/PerfList.svelte';
import { dt, flushSync, instance, instances, render } from './harness.js';

interface Push {
  recordingId: string;
  updates: any[];
  components: any[];
  dropped: number;
  final: boolean;
}

/** Start a recording that hands its pushes to the returned list. */
function record() {
  const pushes: Push[] = [];
  const send = vi.spyOn(dt(), '_send').mockImplementation((...args: unknown[]) => {
    if (args[0] === 'svelte-devtools:performance') pushes.push(args[1] as Push);
  });
  dt().startPerformance('rec-1');
  return {
    pushes,
    stop() {
      dt().stopPerformance();
      send.mockRestore();
      return pushes.flatMap(p => p.updates);
    },
  };
}

const clickTarget = (r: ReturnType<typeof render>, selector: string) => {
  r.target.querySelector(selector)!.click();
  flushSync();
};

afterEach(() => {
  dt().stopPerformance();
});

describe('performance recording', () => {
  it('records nothing and subscribes nothing while not recording', () => {
    const r = render(PerfList);
    expect(dt()._perf).toBeNull();
    expect(dt()._perfUnsubscribe).toBeNull();
    clickTarget(r, '#select');
    expect(dt()._perf).toBeNull();
    r.destroy();
  });

  it('one click: trigger with its declaration, the event, wasted deriveds, one row re-rendered', () => {
    const r = render(PerfList);
    const list = instance('PerfList');
    const rec = record();
    clickTarget(r, '#select');
    const [u, ...rest] = rec.stop();
    expect(rest).toEqual([]);
    expect(u.event).toEqual({ type: 'click', target: 'button#select' });
    expect(u.triggers).toEqual([
      {
        nodeId: `${list.id}:selected`,
        name: 'selected',
        scopeId: list.id,
        scope: 'PerfList',
        file: list.file,
        loc: {
          file: expect.stringMatching(/PerfList\.svelte$/),
          line: 5,
          column: expect.any(Number),
        },
        during: false,
      },
    ]);
    // `active` re-ran in the 3 rows; 2 of them returned false again
    expect(u.deriveds).toBe(3);
    expect(u.wastedDeriveds).toBe(2);
    expect(u.unchangedDeriveds).toEqual([
      {
        name: 'active',
        scope: 'PerfRow',
        file: expect.stringMatching(/PerfRow\.svelte$/),
        runs: 3,
        unchanged: 2,
      },
    ]);
    // only row 1's markup changed
    expect(u.components).toBe(1);
    const row = u.costs.find((c: any) => c.name === 'PerfRow');
    expect(row).toMatchObject({
      kind: 'component',
      instances: 3,
      rendered: 1,
      deriveds: 3,
      renders: 1,
    });
    expect(instances('PerfRow').map(c => c.id)).toContain(row.componentId);
    expect(u.duration).toBeGreaterThanOrEqual(0);
    expect(u.duration).toBeGreaterThanOrEqual(
      u.costs.reduce((s: number, c: any) => s + c.renderMs + c.effectMs + c.derivedMs, 0) - 0.01,
    );
    r.destroy();
  });

  it('an $effect run and the state it writes while the update runs', () => {
    const r = render(PerfList);
    const rec = record();
    clickTarget(r, 'button.bump');
    const updates = rec.stop();
    // the scoped Svelte class is skipped in the target
    expect(updates[0].event).toEqual({ type: 'click', target: 'button.bump' });
    const triggers = updates.flatMap((u: any) => u.triggers.map((t: any) => [t.name, t.during]));
    expect(triggers).toContainEqual(['count', false]);
    expect(triggers).toContainEqual(['doubled', true]);
    expect(updates.reduce((s: number, u: any) => s + u.effects, 0)).toBe(1);
    r.destroy();
  });

  it('totals per component over the recording, sent with every push', () => {
    const r = render(PerfList);
    const rec = record();
    clickTarget(r, '#select');
    clickTarget(r, '#select');
    rec.stop();
    const last = rec.pushes.at(-1)!;
    expect(last.final).toBe(true);
    expect(last.recordingId).toBe('rec-1');
    const row = last.components.find((c: any) => c.name === 'PerfRow');
    expect(row).toMatchObject({ kind: 'component', instances: 3, updates: 2, deriveds: 6 });
    r.destroy();
  });

  it('a mount during the recording counts its render work', () => {
    const r = render(PerfList);
    const rec = record();
    (r.app as any).add();
    flushSync();
    const [u] = rec.stop();
    expect(u.triggers.map((t: any) => t.name)).toEqual(['items']);
    expect(u.costs.map((c: any) => c.name)).toContain('PerfRow');
    expect(u.event).toBeNull();
    r.destroy();
  });

  it('stopping unsubscribes the listener', () => {
    const r = render(PerfList);
    const rec = record();
    expect(dt()._perfUnsubscribe).toBeTypeOf('function');
    rec.stop();
    expect(dt()._perfUnsubscribe).toBeNull();
    clickTarget(r, '#select');
    expect(rec.pushes.flatMap(p => p.updates)).toHaveLength(0);
    r.destroy();
  });
});
