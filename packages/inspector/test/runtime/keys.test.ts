import { describe, expect, it } from 'vitest';

import { physicalKey } from '../../src/runtime/keys.js';

describe('physicalKey', () => {
  it.each([
    ['KeyA', 'a'],
    ['Digit0', '0'],
    ['ArrowUp', undefined],
    ['Minus', undefined],
    ['Space', undefined],
  ])('reads %s as %j', (code, key) => {
    expect(physicalKey(code)).toBe(key);
  });
});
