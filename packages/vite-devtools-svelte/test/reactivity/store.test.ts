import { describe, it, expect } from 'vitest';

import Tree from './fixtures/Tree.svelte';
import { dt, instances, render } from './harness.js';

// The registry key hooks.js keeps the page's store under.
const STORE_KEY = Symbol.for('vite-devtools-svelte');
// a variable: TS does not resolve a specifier with a query
const HOOKS_COPY = '../../src/runtime/hooks.js?second-copy';

describe('page store', () => {
  it('lives under one non-enumerable registry key, without a named global', () => {
    expect(dt()).toBeTypeOf('object');
    expect(Object.getOwnPropertyDescriptor(globalThis, STORE_KEY)?.enumerable).toBe(false);
    expect('__SVELTE_DEVTOOLS__' in globalThis).toBe(false);
  });

  it('a second copy of the hooks (a dependency prebundle) reuses it and does not track twice', async () => {
    const store = dt();
    await import(/* @vite-ignore */ HOOKS_COPY);
    expect(dt()).toBe(store);
    const r = render(Tree);
    expect(instances('Tree')).toHaveLength(1);
    // direct, row1, after-boundary + slotted: each once
    expect(instances('Child')).toHaveLength(4);
    r.destroy();
    expect(instances('Tree')).toEqual([]);
  });
});
