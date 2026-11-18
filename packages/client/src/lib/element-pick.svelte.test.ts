import { describe, expect, it } from 'vitest';

import { elementPick } from './element-pick.svelte.js';
import { track } from './testing.svelte.js';

const pick = (componentId: number) => ({
  epoch: 'e1',
  componentId,
});

describe('elementPick', () => {
  it('holds the latest pick until it is revealed, reactively', () => {
    const t = track(() => elementPick.pending);
    const first = pick(1);
    const second = pick(2);
    elementPick.set(first);
    t.flush();
    elementPick.set(second);
    t.flush();
    // revealing the older pick does not drop the newer one
    elementPick.done(first);
    t.flush();
    expect(elementPick.pending).toBe(second);
    elementPick.done(second);
    t.flush();
    t.stop();
    expect(t.seen).toEqual([null, first, second, null]);
  });
});
