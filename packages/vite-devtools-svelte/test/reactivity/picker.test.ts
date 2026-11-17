import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Child from './fixtures/Child.svelte';
import Picked from './fixtures/Picked.svelte';
import { dt, instances, render } from './harness.js';

// The inspector's link to the DevTools through the production hooks, on real
// compiled components: an element's `__svelte_meta.component` resolves to
// the instance id the component tree uses.

// DOM elements (the package type-checks against Node's lib only).
type El = object;
interface Link {
  describe(element: El): { name: string } | null;
  pick(element: El): boolean;
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

/** The component ids a pick of `el` reported. */
function pick(el: El) {
  sent = [];
  link.pick(el);
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
