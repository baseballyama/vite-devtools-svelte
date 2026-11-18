import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import Picked from './fixtures/Picked.svelte';
import { dt, instances, render } from './harness.js';

// The Svelte Inspector's `svelte-inspector:describe` / `svelte-inspector:pick`
// events, on real compiled components: the element's `__svelte_meta.component`
// resolves to the instance the component tree uses, named for the label and
// reported to the dev server on a pick.

// DOM elements (the package type-checks against Node's lib only).
type El = object;
const win = globalThis as unknown as {
  dispatchEvent(event: unknown): boolean;
  CustomEvent: new (type: string, init: { detail: unknown }) => unknown;
  document: { createElement(tag: string): El };
};

const PICKED = 'svelte-devtools:element-picked';
let send: MockInstance<(event: string, data: unknown) => void>;

beforeEach(() => {
  send = vi.spyOn(dt(), '_send').mockImplementation(() => {});
});
afterEach(() => {
  send.mockRestore();
});

/** What a pick of `el` reported to the dev server. */
function pick(el: El | null): any[] {
  send.mockClear();
  win.dispatchEvent(new win.CustomEvent('svelte-inspector:pick', { detail: { element: el } }));
  return send.mock.calls.filter(([event]) => event === PICKED).map(([, data]) => data);
}

/** The name the runtime gives `el`'s instance, or null. */
function nameOf(el: El | null): string | null {
  const detail = { element: el, name: null };
  win.dispatchEvent(new win.CustomEvent('svelte-inspector:describe', { detail }));
  return detail.name;
}

const ids = (el: El) => pick(el).map(data => data.componentId as number);

const all = (target: object, selector: string): El[] => [
  ...(target as { querySelectorAll(selector: string): Iterable<El> }).querySelectorAll(selector),
];

/** Runs `fn` while `el`'s component context is not tracked (as for a library component). */
function asUntracked<T>(el: El, fn: () => T): T {
  const ctx = (el as any).__svelte_meta.component;
  const id = dt()._idByContext.get(ctx);
  dt()._idByContext.delete(ctx);
  try {
    return fn();
  } finally {
    dt()._idByContext.set(ctx, id);
  }
}

describe('element picks from the Svelte Inspector', () => {
  it('reports the instance that rendered the element', () => {
    const r = render(Picked);
    const [picked] = instances('Picked');
    const bold = all(r.target, 'b')[0]!;
    expect(pick(bold)).toEqual([{ epoch: dt()._epoch, componentId: picked!.id }]);
    expect(nameOf(bold)).toBe('Picked');
    r.destroy();
  });

  it('two instances of one component resolve to their own ids', () => {
    const r = render(Picked);
    const children = instances('Child');
    expect(children).toHaveLength(2);
    const spans = all(r.target, 'span');
    expect(spans.flatMap(ids)).toEqual(children.map(c => c.id));
    r.destroy();
  });

  it('the same element of two mounted copies of a component resolves to each copy', () => {
    const a = render(Picked);
    const b = render(Picked);
    const picked = instances('Picked').map(c => c.id);
    expect(picked).toHaveLength(2);
    const outer = [...all(a.target, '.outer'), ...all(b.target, '.outer')];
    expect(outer.flatMap(ids)).toEqual(picked);
    a.destroy();
    b.destroy();
  });

  it('content passed to a child belongs to the child that renders it', () => {
    const r = render(Picked);
    const em = all(r.target, 'em')[0]!;
    const second = instances('Child')[1]!;
    expect(ids(em)).toEqual([second.id]);
    r.destroy();
  });

  it('an untracked component (a library) resolves to its nearest tracked ancestor', () => {
    const r = render(Picked);
    const [picked] = instances('Picked');
    const span = all(r.target, 'span')[0]!;
    expect(asUntracked(span, () => [ids(span), nameOf(span)])).toEqual([[picked!.id], 'Picked']);
    r.destroy();
  });

  it('reports nothing without a tracked component, an element, or Svelte metadata', () => {
    const r = render(Picked);
    const bold = all(r.target, 'b')[0]!;
    expect(asUntracked(bold, () => [pick(bold), nameOf(bold)])).toEqual([[], null]);
    expect(pick(null)).toEqual([]);
    const plain = win.document.createElement('p');
    expect([pick(plain), nameOf(plain)]).toEqual([[], null]);
    r.destroy();
  });

  it('an unmounted instance is not reported', () => {
    const r = render(Picked);
    const bold = all(r.target, 'b')[0]!;
    r.destroy();
    expect([pick(bold), nameOf(bold)]).toEqual([[], null]);
  });
});
