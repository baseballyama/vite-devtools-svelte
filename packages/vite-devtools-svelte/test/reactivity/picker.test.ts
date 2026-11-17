import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Child from './fixtures/Child.svelte';
import Outer from './fixtures/Outer.svelte';
import Picked from './fixtures/Picked.svelte';
import { dt, instances, render } from './harness.js';

// The inspector's link to the DevTools through the production hooks, on real
// compiled components: an element's `__svelte_meta.component` resolves to
// the instance id the component tree uses.

// DOM elements (the package type-checks against Node's lib only).
type El = object;
interface Entry {
  type: string;
  componentTag?: string;
  file: string;
  line: number;
  column: number;
  parent: Entry | null;
}
interface Link {
  describe(element: El): { name: string } | null;
  parents(element: El): Map<Entry, { name: string }>;
  pick(element: El, entry?: Entry): boolean;
  connect(controls: { enable(): void; disable(): void }): () => void;
  untracked<T>(fn: () => T): T;
}
type Hot = {
  send(event: string, data: unknown): void;
  on(event: string, fn: (data: any) => void): void;
};
// Specifiers in variables: untyped browser JavaScript.
const LINK = '../../src/runtime/inspector-link.js';
const RUNTIME = '../../src/runtime/runtime.js';
const link = ((await import(/* @vite-ignore */ LINK)) as { default: Link }).default;
const { connectHot } = (await import(/* @vite-ignore */ RUNTIME)) as {
  connectHot: (dt: unknown, hot: Hot) => void;
};

interface Sent {
  event: string;
  data: any;
}
let sent: Sent[];
const PICKED = 'svelte-devtools:element-picked';

beforeEach(() => {
  sent = [];
  dt()._hot = { send: (event: string, data: unknown) => sent.push({ event, data }) };
});
afterEach(() => {
  dt()._hot = null;
});

/** The component ids a pick of `el` (or of its `entry`) reported. */
function pick(el: El, entry?: Entry) {
  sent = [];
  link.pick(el, entry);
  return sent.filter(s => s.event === PICKED).map(s => s.data.componentId as number);
}

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

describe('inspector link: element -> component instance', () => {
  it('resolves an element to the instance that rendered it, with its template location', () => {
    const r = render(Picked);
    const [picked] = instances('Picked');
    const bold = all(r.target, 'b')[0]!;
    expect(link.describe(bold)).toEqual({ name: 'Picked' });
    expect(pick(bold)).toEqual([picked!.id]);
    expect(sent[0]!.data).toEqual({
      epoch: dt()._epoch,
      componentId: picked!.id,
      loc: { file: expect.stringMatching(/Picked\.svelte$/), line: 6, column: 11 },
    });
    r.destroy();
  });

  it('two instances of one component resolve to their own ids', () => {
    const r = render(Picked);
    const children = instances('Child');
    expect(children).toHaveLength(2);
    const spans = all(r.target, 'span');
    expect(spans).toHaveLength(2);
    expect(spans.flatMap(s => pick(s))).toEqual(children.map(c => c.id));
    r.destroy();
  });

  it('the same element of two mounted copies of a component resolves to each copy', () => {
    const a = render(Picked);
    const b = render(Picked);
    const ids = instances('Picked').map(c => c.id);
    expect(ids).toHaveLength(2);
    const outer = [...all(a.target, '.outer'), ...all(b.target, '.outer')];
    expect(outer.flatMap(el => pick(el))).toEqual(ids);
    a.destroy();
    b.destroy();
  });

  it('an untracked component (a library) resolves to its nearest tracked ancestor', () => {
    const r = render(Picked);
    const [picked] = instances('Picked');
    const span = all(r.target, 'span')[0]!;
    expect(asUntracked(span, () => [link.describe(span), pick(span)])).toEqual([
      { name: 'Picked' },
      [picked!.id],
    ]);
    r.destroy();
  });

  it('no tracked component: nothing is named or picked (the inspector opens the editor)', () => {
    const r = render(Picked);
    const bold = all(r.target, 'b')[0]!;
    asUntracked(bold, () => {
      expect(link.describe(bold)).toBeNull();
      expect(link.pick(bold)).toBe(false);
    });
    expect(sent).toEqual([]);
    const plain = (
      globalThis as unknown as { document: { createElement(tag: string): El } }
    ).document.createElement('p');
    expect(link.describe(plain)).toBeNull();
    expect(link.pick(plain)).toBe(false);
    r.destroy();
  });

  it('content passed to a child belongs to the child that renders it', () => {
    const r = render(Picked);
    const em = all(r.target, 'em')[0]!;
    const second = instances('Child')[1]!;
    // Svelte reports the context the snippet runs in: the component rendering it
    expect(pick(em)).toEqual([second.id]);
    expect(sent[0]!.data.loc.file).toMatch(/Picked\.svelte$/);
    r.destroy();
  });
});

/** The component entries of `el`'s `__svelte_meta.parent` chain, innermost first. */
function componentEntries(el: El): Entry[] {
  const entries: Entry[] = [];
  for (let e: Entry | null = (el as any).__svelte_meta.parent; e !== null; e = e.parent) {
    if (e.type === 'component') entries.push(e);
  }
  return entries;
}

/** For each component entry of `el`: `Tag@file:line -> id picked`, or `-> none`. */
function parentRows(el: El) {
  return componentEntries(el).map(entry => {
    const ids = pick(el, entry);
    const at = `${entry.componentTag}@${entry.file.slice(entry.file.lastIndexOf('/') + 1)}:${entry.line}`;
    return `${at} -> ${ids.length > 0 ? ids[0] : 'none'}`;
  });
}

describe('inspector link: the instances of the parent rows', () => {
  // Outer.svelte renders <Card> (each rendering a <Leaf> in an {#if}) five
  // times: plain twice, with a <Leaf> passed as children, through an alias,
  // and with a css custom property.
  it('pairs each component entry with the instance it rendered, among same-file siblings', () => {
    const r = render(Outer);
    const cards = instances('Card').map(c => c.id);
    const leaves = instances('Leaf').map(c => c.id);
    const [, two] = all(r.target, 'i');
    expect(parentRows(two!)).toEqual([
      `Leaf@Card.svelte:8 -> ${leaves[1]}`,
      `Card@Outer.svelte:9 -> ${cards[1]}`,
    ]);
    expect(link.parents(two!)).toEqual(
      new Map(componentEntries(two!).map(e => [e, { name: e.componentTag }])),
    );
    // the pick carries where the row's tag is written
    pick(two!, componentEntries(two!)[1]);
    expect(sent[0]!.data.loc).toEqual({
      file: expect.stringMatching(/Outer\.svelte$/),
      line: 9,
      column: 0,
    });
    r.destroy();
  });

  it('a component passed as children pairs through the {@render} that ran it', () => {
    const r = render(Outer);
    const passed = all(r.target, 'i').find(i => (i as any).textContent === 'passed')!;
    expect(parentRows(passed)).toEqual([
      `Leaf@Outer.svelte:10 -> ${instances('Leaf')[3]!.id}`,
      `Card@Outer.svelte:10 -> ${instances('Card')[2]!.id}`,
    ]);
    r.destroy();
  });

  it('an aliased tag is not paired; the rows inside it still are', () => {
    const r = render(Outer);
    const alias = all(r.target, 'i').find(i => (i as any).textContent === 'alias')!;
    expect(parentRows(alias)).toEqual([
      `Leaf@Card.svelte:8 -> ${instances('Leaf')[4]!.id}`,
      'Alias@Outer.svelte:11 -> none',
    ]);
    expect([...link.parents(alias).values()]).toEqual([{ name: 'Leaf' }]);
    r.destroy();
  });

  it('a call without an entry (css custom properties) leaves no row to pair', () => {
    const r = render(Outer);
    const styled = all(r.target, 'i').find(i => (i as any).textContent === 'styled')!;
    expect(parentRows(styled)).toEqual([`Leaf@Card.svelte:8 -> ${instances('Leaf')[5]!.id}`]);
    r.destroy();
  });

  it('an untracked component (a library) is not paired, and no ancestor stands in', () => {
    const r = render(Outer);
    const [, two] = all(r.target, 'i');
    const card = dt()._api.parentComponent((two as any).__svelte_meta.component);
    const id = dt()._idByContext.get(card);
    dt()._idByContext.delete(card);
    try {
      expect(parentRows(two!)).toEqual([
        `Leaf@Card.svelte:8 -> ${instances('Leaf')[1]!.id}`,
        'Card@Outer.svelte:9 -> none',
      ]);
    } finally {
      dt()._idByContext.set(card, id);
    }
    r.destroy();
  });

  it('an entry of another element, or none, picks nothing', () => {
    const r = render(Outer);
    const [one, two] = all(r.target, 'i');
    expect(link.pick(one!, componentEntries(two!)[1])).toBe(false);
    const plain = (
      globalThis as unknown as { document: { createElement(tag: string): El } }
    ).document.createElement('p');
    expect(link.parents(plain)).toEqual(new Map());
    expect(sent).toEqual([]);
    r.destroy();
  });
});

describe('inspector link: the inspector itself', () => {
  it('components created in untracked() stay out of the tree', () => {
    const before = instances('Child').length;
    const r = link.untracked(() => render(Child));
    expect(instances('Child')).toHaveLength(before);
    expect(dt()._untracked).toBe(false);
    r.destroy();
    // tracked again afterwards
    const tracked = render(Child);
    expect(instances('Child')).toHaveLength(before + 1);
    tracked.destroy();
  });

  it('untracked() ends even when the mount throws', () => {
    expect(() =>
      link.untracked(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(dt()._untracked).toBe(false);
  });

  it('the server turns the connected inspector on and off; unlinking stops it', () => {
    const listeners = new Map<string, (data: unknown) => void>();
    connectHot(dt(), {
      send: () => {},
      on: (event: string, fn: (data: unknown) => void) => {
        listeners.set(event, fn);
      },
    });
    const picker = listeners.get('svelte-devtools:picker')!;
    const calls: string[] = [];
    const unlink = link.connect({
      enable: () => {
        calls.push('enable');
      },
      disable: () => {
        calls.push('disable');
      },
    });
    picker({ active: true });
    picker({ active: false });
    picker(null);
    // a newer inspector replaced this one: unlinking the old one keeps it
    const unlinkNewer = link.connect({
      enable: () => {
        calls.push('newer');
      },
      disable: () => {},
    });
    unlink();
    picker({ active: true });
    unlinkNewer();
    picker({ active: true });
    expect(calls).toEqual(['enable', 'disable', 'disable', 'newer']);
  });
});
