import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import Outer from './fixtures/Outer.svelte';
import Picked from './fixtures/Picked.svelte';
import { dt, instances, render } from './harness.js';

// DOM elements (the package type-checks against Node's lib only).
type El = object;
const win = globalThis as unknown as {
  dispatchEvent(event: unknown): boolean;
  CustomEvent: new (
    type: string,
    init: { detail: unknown; cancelable?: boolean },
  ) => { defaultPrevented: boolean };
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

/** What Inspect on the element row of `el` reported to the dev server. */
function pick(el: El | null): any[] {
  send.mockClear();
  win.dispatchEvent(
    new win.CustomEvent('svelte-inspector:pick', {
      detail: { element: el, entry: null },
      cancelable: true,
    }),
  );
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
  const id = dt().idByContext.get(ctx);
  dt().idByContext.delete(ctx);
  try {
    return fn();
  } finally {
    dt().idByContext.set(ctx, id);
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

interface Entry {
  type: string;
  componentTag?: string;
  file: string;
  line: number;
  parent: Entry | null;
}

function componentEntries(el: El): Entry[] {
  const entries: Entry[] = [];
  for (let e: Entry | null = (el as any).__svelte_meta.parent; e !== null; e = e.parent) {
    if (e.type === 'component') entries.push(e);
  }
  return entries;
}

/** The names the runtime gives the menu's parent rows of `el`, by entry. */
function parentNames(el: El): Map<Entry, string> {
  const parents = new Map<Entry, string>();
  win.dispatchEvent(
    new win.CustomEvent('svelte-inspector:describe', {
      detail: { element: el, name: null, parents },
    }),
  );
  return parents;
}

/** "Inspect" on the row of `entry`: the ids reported, and whether the pick was taken. */
function inspect(el: El, entry: Entry) {
  send.mockClear();
  const event = new win.CustomEvent('svelte-inspector:pick', {
    detail: { element: el, entry },
    cancelable: true,
  });
  win.dispatchEvent(event);
  const reported = send.mock.calls
    .filter(([name]) => name === PICKED)
    .map(([, data]) => (data as { componentId: number }).componentId);
  return { reported, taken: event.defaultPrevented };
}

/** For each component entry of `el`: `Tag@file:line -> id`, or `-> none`. */
function parentRows(el: El) {
  const names = parentNames(el);
  return componentEntries(el).map(entry => {
    const { reported, taken } = inspect(el, entry);
    expect(taken).toBe(reported.length > 0);
    expect(names.get(entry) ?? null).toBe(reported.length > 0 ? entry.componentTag : null);
    const at = `${entry.componentTag}@${entry.file.slice(entry.file.lastIndexOf('/') + 1)}:${entry.line}`;
    return `${at} -> ${reported[0] ?? 'none'}`;
  });
}

const leafByText = (target: object, text: string) =>
  all(target, 'i').find(i => (i as { textContent: string }).textContent === text)!;

describe('the menu rows of the components around an element', () => {
  // Outer.svelte renders <Card> (each rendering a <Leaf> in an {#if}) five
  // times: plain twice, with a <Leaf> passed as children, through an alias,
  // and with a css custom property.
  it('pairs each component entry with the instance it rendered, among same-file siblings', () => {
    const r = render(Outer);
    const cards = instances('Card').map(c => c.id);
    const leaves = instances('Leaf').map(c => c.id);
    expect(parentRows(leafByText(r.target, 'two'))).toEqual([
      `Leaf@Card.svelte:8 -> ${leaves[1]}`,
      `Card@Outer.svelte:9 -> ${cards[1]}`,
    ]);
    r.destroy();
  });

  it('a component passed as children pairs through the {@render} that ran it', () => {
    const r = render(Outer);
    expect(parentRows(leafByText(r.target, 'passed'))).toEqual([
      `Leaf@Outer.svelte:10 -> ${instances('Leaf')[3]!.id}`,
      `Card@Outer.svelte:10 -> ${instances('Card')[2]!.id}`,
    ]);
    r.destroy();
  });

  it('an aliased tag is not paired; the rows inside it still are', () => {
    const r = render(Outer);
    expect(parentRows(leafByText(r.target, 'alias'))).toEqual([
      `Leaf@Card.svelte:8 -> ${instances('Leaf')[4]!.id}`,
      'Alias@Outer.svelte:11 -> none',
    ]);
    r.destroy();
  });

  it('a call without an entry (css custom properties) leaves no row to pair', () => {
    const r = render(Outer);
    expect(parentRows(leafByText(r.target, 'styled'))).toEqual([
      `Leaf@Card.svelte:8 -> ${instances('Leaf')[5]!.id}`,
    ]);
    r.destroy();
  });

  it('an untracked component (a library) is not paired, and no ancestor stands in', () => {
    const r = render(Outer);
    const two = leafByText(r.target, 'two');
    const card = (two as any).__svelte_meta.component.p;
    const id = dt().idByContext.get(card);
    dt().idByContext.delete(card);
    try {
      expect(parentRows(two)).toEqual([
        `Leaf@Card.svelte:8 -> ${instances('Leaf')[1]!.id}`,
        'Card@Outer.svelte:9 -> none',
      ]);
    } finally {
      dt().idByContext.set(card, id);
    }
    r.destroy();
  });

  it('an entry of another element, or no Svelte metadata, picks and names nothing', () => {
    const r = render(Outer);
    const one = leafByText(r.target, 'one');
    const two = leafByText(r.target, 'two');
    expect(inspect(one, componentEntries(two)[1]!)).toEqual({ reported: [], taken: false });
    expect(parentNames(win.document.createElement('p'))).toEqual(new Map());
    r.destroy();
  });

  it("the element row's Inspect (no entry) is taken; a click is not", () => {
    const r = render(Outer);
    const two = leafByText(r.target, 'two');
    const row = new win.CustomEvent('svelte-inspector:pick', {
      detail: { element: two, entry: null },
      cancelable: true,
    });
    win.dispatchEvent(row);
    expect(row.defaultPrevented).toBe(true);
    // a click only opens the editor: not cancelable, and nothing is reported
    send.mockClear();
    const click = new win.CustomEvent('svelte-inspector:pick', { detail: { element: two } });
    win.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(send.mock.calls.filter(([event]) => event === PICKED)).toEqual([]);
    r.destroy();
  });
});
