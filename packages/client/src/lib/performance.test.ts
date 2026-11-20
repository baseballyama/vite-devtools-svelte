import { describe, expect, it } from 'vitest';

import {
  causes,
  eventText,
  formatElapsed,
  formatOffset,
  selfMs,
  severity,
  updateHints,
  type HintPart,
} from './performance.js';
import type { PerfTrigger, PerfUpdate } from './types.js';

const trigger = (name: string, during = false): PerfTrigger => ({
  nodeId: `1:${name}`,
  name,
  scopeId: 1,
  scope: 'App',
  file: 'src/App.svelte',
  loc: null,
  during,
});

const update = (extra: Partial<PerfUpdate> = {}): PerfUpdate => ({
  id: 1,
  start: 0,
  duration: 1,
  event: null,
  triggers: [],
  triggersOmitted: 0,
  components: 0,
  renders: 0,
  effects: 0,
  deriveds: 0,
  wastedDeriveds: 0,
  unchangedDeriveds: [],
  costs: [],
  costsOmitted: 0,
  droppedFrames: null,
  ...extra,
});

const cost = (name: string, rendered: number, kind: 'component' | 'library' = 'component') => ({
  file: `src/${name}.svelte`,
  name,
  kind,
  componentId: 1,
  instances: rendered,
  rendered,
  renderMs: 1,
  effectMs: 2,
  derivedMs: 3,
  renders: rendered,
  effects: 0,
  deriveds: 0,
});

/** A hint as markdown-ish text: code parts in backticks. */
const asText = (hint: HintPart[]) =>
  hint.map(p => ('code' in p ? `\`${p.code}\`` : p.text)).join('');

describe('performance helpers', () => {
  it.each([
    [16, 'ok'],
    [16.1, 'slow'],
    [49.9, 'slow'],
    [50, 'bad'],
  ] as const)('severity(%d) = %s', (ms, s) => {
    expect(severity(ms)).toBe(s);
  });

  it('formats offsets and elapsed time', () => {
    expect(formatOffset(4210)).toBe('+4.21 s');
    expect(formatOffset(10_700)).toBe('+10.7 s');
    expect(formatOffset(125_400)).toBe('+125 s');
    expect(formatElapsed(12_900)).toBe('00:12');
    expect(formatElapsed(61_000)).toBe('01:01');
    expect(formatElapsed(-5)).toBe('00:00');
  });

  it('describes events', () => {
    expect(eventText(null)).toBe('');
    expect(eventText({ type: 'click', target: 'button.send' })).toBe('click on button.send');
    expect(eventText({ type: 'keydown', target: '', key: 'Enter' })).toBe('keydown Enter');
  });

  it('self time and causes', () => {
    expect(selfMs(cost('A', 1))).toBe(6);
    expect(
      causes(update({ triggers: [trigger('a'), trigger('b', true)] })).map(t => t.name),
    ).toEqual(['a']);
  });

  it('hints state only what was measured', () => {
    expect(updateHints(update())).toEqual([]);
    const hints = updateHints(
      update({
        unchangedDeriveds: [
          { name: 'isRead', scope: 'MessageRow', file: 'f', runs: 400, unchanged: 398 },
          { name: 'b', scope: 'X', file: 'f', runs: 2, unchanged: 1 },
          { name: 'c', scope: 'X', file: 'f', runs: 2, unchanged: 1 },
          { name: 'd', scope: 'X', file: 'f', runs: 2, unchanged: 1 },
        ],
        costs: [cost('MessageRow', 200), cost('Few', 9), cost('Lib', 50, 'library')],
        triggers: [trigger('count'), trigger('doubled', true), trigger('tripled', true)],
      }),
    );
    const text = hints.map(asText);
    expect(text).toEqual([
      '`isRead` ($derived in MessageRow) recomputed 400× and returned the same value 398×.',
      '`b` ($derived in X) recomputed 2× and returned the same value 1×.',
      '`c` ($derived in X) recomputed 2× and returned the same value 1×.',
      '200 instances of `<MessageRow>` re-rendered.',
      '`App.doubled`, `App.tripled` were written while this update was running (from an $effect).',
    ]);
    const one = updateHints(update({ triggers: [trigger('x', true)] }));
    expect(one[0]!.at(-1)).toEqual({
      text: ' was written while this update was running (from an $effect).',
    });
  });
});
