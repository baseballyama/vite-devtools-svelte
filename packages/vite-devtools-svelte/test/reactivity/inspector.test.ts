import { flushSync, mount, unmount } from 'svelte';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Outer from './fixtures/Outer.svelte';
import Picked from './fixtures/Picked.svelte';
import { dt, instances, render } from './harness.js';

// The forked Svelte Inspector (packages/inspector) mounted on the page with
// the DevTools link, over real compiled components: hover names the component
// instance, a click picks it, Alt+click opens the editor as upstream does, and
// the right-click menu offers both for the element and each parent component.

// DOM surface the test touches (the package type-checks against Node's lib only).
interface El {
  dispatchEvent(event: unknown): boolean;
  getAttribute(name: string): string | null;
  className: string;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): Iterable<El>;
  textContent: string | null;
  tagName: string;
  click(): void;
  classList: { contains(name: string): boolean };
  addEventListener(type: string, fn: () => void): void;
}
const win = globalThis as unknown as {
  document: {
    body: El;
    documentElement: { append(el: object): void };
    createElement(tag: string): object;
    querySelector(selector: string): El | null;
    activeElement: El | null;
  };
  MouseEvent: new (type: string, init?: object) => unknown;
  KeyboardEvent: new (type: string, init?: object) => unknown;
};

// Specifiers in variables: the inspector's runtime is resolved by the harness plugin.
const LINK = '../../src/runtime/inspector-link.js';
const INSPECTOR = 'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte';
interface Controls {
  enable(): void;
  disable(): void;
}
const link = (
  (await import(/* @vite-ignore */ LINK)) as {
    default: {
      connect(controls: Controls): () => void;
      untracked<T>(fn: () => T): T;
    };
  }
).default;
const Inspector = ((await import(/* @vite-ignore */ INSPECTOR)) as { default: any }).default;

let sent: Array<{ event: string; data: any }>;
const fetches = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve({}));
let controls: Controls;
let inspector: ReturnType<typeof mount>;
let app: ReturnType<typeof render>;
let outer: ReturnType<typeof render>;

// Upstream calls `body.addEventListener` detached (`const l = body.addEventListener`):
// browsers then use the window (WebIDL's global fallback); happy-dom throws, so the
// test listens on the body, which app events bubble through as well.
function browserLikeListeners() {
  const { body } = win.document as unknown as { body: Record<string, any> };
  for (const name of ['addEventListener', 'removeEventListener']) {
    let owner = body;
    while (!Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
    const original = owner[name];
    vi.spyOn(owner, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      original.apply(this ?? body, args);
    });
  }
}

beforeAll(() => {
  browserLikeListeners();
  vi.stubGlobal('fetch', fetches);
  dt()._hot = {
    send: (event: string, data: unknown) => {
      sent.push({ event, data });
    },
  };
  const connect = link.connect.bind(link);
  vi.spyOn(link, 'connect').mockImplementation(c => {
    controls = c;
    return connect(c);
  });
  app = render(Picked);
  outer = render(Outer);
  const host = win.document.createElement('div');
  win.document.documentElement.append(host);
  inspector = link.untracked(() => mount(Inspector, { target: host }));
  flushSync();
});
afterAll(() => {
  void unmount(inspector);
  app.destroy();
  outer.destroy();
  dt()._hot = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  sent = [];
  fetches.mockClear();
});

const $ = (selector: string) => [...(app.target as unknown as El).querySelectorAll(selector)];
const leaf = (label: string) =>
  [...(outer.target as unknown as El).querySelectorAll('i')].find(i => i.textContent === label)!;
const overlay = () => win.document.querySelector('#svelte-inspector-overlay');
const enabled = () => win.document.body.classList.contains('svelte-inspector-enabled');
function hover(el: El) {
  el.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
  flushSync();
}
function click(el: El, init: object = {}) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  flushSync();
}
function rightClick(el: El) {
  el.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  flushSync();
}
// The menu's buttons in document (= Tab) order, close first; its rows
const menuButtons = () => [...overlay()!.querySelectorAll('button')];
const menuRows = () => [...overlay()!.querySelectorAll('li')];
const rowText = (el: El) => el.textContent!.replaceAll(/\s+/g, ' ').trim();
const inspectOf = (row: El) => row.querySelector('button.svelte-inspector-inspect');
const openOf = (row: El) => [...row.querySelectorAll('button')].at(-1)!;
function openMenu(el: El) {
  turnOn();
  hover(el);
  rightClick(el);
}
function close() {
  controls.disable();
  flushSync();
}
function turnOn() {
  controls.enable();
  flushSync();
}

describe('inspector with the DevTools link', () => {
  it('is not one of the app components', () => {
    expect(instances('Inspector')).toEqual([]);
  });

  it('the DevTools turn it on and off', () => {
    expect(enabled()).toBe(false);
    turnOn();
    expect(enabled()).toBe(true);
    controls.disable();
    flushSync();
    expect(enabled()).toBe(false);
  });

  it('hover names the component instance and says what a click does', () => {
    turnOn();
    hover($('span')[1]!);
    const text = overlay()!.textContent!.replaceAll(/\s+/g, ' ');
    expect(text).toContain('<Child>');
    expect(text).toMatch(/Child\.svelte:6/);
    expect(text).toMatch(/click: inspect · (⌥|Alt\+)click: open in editor · right-click: more/);
    controls.disable();
  });

  it('a click picks that instance, does not reach the app, and turns the inspector off', () => {
    const appClick = vi.fn<() => void>();
    const second = $('span')[1]!;
    second.addEventListener('click', appClick);
    turnOn();
    hover(second);
    click(second);
    expect(sent).toEqual([
      {
        event: 'svelte-devtools:element-picked',
        data: expect.objectContaining({ componentId: instances('Child')[1]!.id }),
      },
    ]);
    expect(appClick).not.toHaveBeenCalled();
    expect(fetches).not.toHaveBeenCalled();
    expect(enabled()).toBe(false);
  });

  it('Alt+click opens the element in the editor instead', () => {
    turnOn();
    const bold = $('b')[0]!;
    hover(bold);
    click(bold, { altKey: true });
    expect(sent).toEqual([]);
    expect(fetches).toHaveBeenCalledWith(
      expect.stringMatching(/^\/__open-in-editor\?file=.*Picked\.svelte%3A6%3A12$/),
    );
    controls.disable();
    flushSync();
  });

  it('an element the DevTools do not track opens the editor on click', () => {
    const bold = $('b')[0]!;
    const ctx = (bold as any).__svelte_meta.component;
    const id = dt()._idByContext.get(ctx);
    dt()._idByContext.delete(ctx);
    try {
      turnOn();
      hover(bold);
      expect(overlay()!.textContent).toContain('<b>');
      expect(overlay()!.textContent).toContain('click: open in editor');
      expect(overlay()!.textContent).not.toContain('inspect');
      click(bold);
      expect(sent).toEqual([]);
      expect(fetches).toHaveBeenCalledOnce();
    } finally {
      dt()._idByContext.set(ctx, id);
      controls.disable();
      flushSync();
    }
  });

  describe('right-click menu', () => {
    it('one row per element and parent component, each with Inspect and Open', () => {
      openMenu($('span')[1]!);
      expect(menuRows().map(rowText)).toEqual([
        expect.stringMatching(/^<span> .*Child\.svelte:6 Inspect Open ↗$/),
        expect.stringMatching(/^<Child> .*Picked\.svelte:9 Inspect Open ↗$/),
      ]);
      // native buttons; focus on "close" as upstream, then Tab: Inspect, Open of each row
      expect(menuButtons().map(b => b.getAttribute('aria-label'))).toEqual([
        'close',
        'Inspect Child in DevTools',
        expect.stringMatching(/^Open .*Child\.svelte:6 in editor$/),
        'Inspect Child in DevTools',
        expect.stringMatching(/^Open .*Picked\.svelte:9 in editor$/),
      ]);
      expect(win.document.activeElement).toBe(menuButtons()[0]);
      close();
    });

    it("a parent row's Inspect picks that row's instance, not another of the same component", () => {
      openMenu(leaf('two'));
      expect(menuRows().map(rowText)).toEqual([
        expect.stringMatching(/^<i> .*Leaf\.svelte:5 Inspect Open ↗$/),
        expect.stringMatching(/^<Leaf> .*Card\.svelte:8 Inspect Open ↗$/),
        expect.stringMatching(/^<Card> .*Outer\.svelte:9 Inspect Open ↗$/),
      ]);
      inspectOf(menuRows()[2]!)!.click();
      flushSync();
      expect(sent).toEqual([
        {
          event: 'svelte-devtools:element-picked',
          data: expect.objectContaining({
            componentId: instances('Card')[1]!.id,
            loc: expect.objectContaining({
              file: expect.stringMatching(/Outer\.svelte$/),
              line: 9,
            }),
          }),
        },
      ]);
      expect(fetches).not.toHaveBeenCalled();
      expect(enabled()).toBe(false);
    });

    it("the element row's Inspect picks the element's instance", () => {
      openMenu(leaf('passed'));
      inspectOf(menuRows()[0]!)!.click();
      flushSync();
      expect(sent.map(s => s.data.componentId)).toEqual([instances('Leaf')[3]!.id]);
      expect(enabled()).toBe(false);
    });

    it("Open opens the editor at that row's location", () => {
      openMenu(leaf('two'));
      openOf(menuRows()[2]!).click();
      flushSync();
      expect(sent).toEqual([]);
      expect(fetches).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^\/__open-in-editor\?file=.*Outer\.svelte%3A9%3A1$/),
      );
      expect(enabled()).toBe(false);
    });

    it("a click on a row's text does nothing", () => {
      openMenu(leaf('two'));
      const row = menuRows()[1]!;
      click(row.querySelector('.svelte-inspector-file')!);
      click(row.querySelector('.svelte-inspector-tag')!);
      click(row);
      expect(sent).toEqual([]);
      expect(fetches).not.toHaveBeenCalled();
      expect(menuRows()).toHaveLength(3);
      expect(enabled()).toBe(true);
      close();
    });

    it('a row without a confident instance has Open only, aligned, and nothing focusable in place of Inspect', () => {
      openMenu(leaf('alias'));
      const rows = menuRows();
      expect(rows.map(rowText)).toEqual([
        expect.stringMatching(/^<i> .*Leaf\.svelte:5 Inspect Open ↗$/),
        expect.stringMatching(/^<Leaf> .*Card\.svelte:8 Inspect Open ↗$/),
        expect.stringMatching(/^<Alias> .*Outer\.svelte:11 Inspect Open ↗$/),
      ]);
      expect(inspectOf(rows[2]!)).toBeNull();
      const placeholder = rows[2]!.querySelector('.svelte-inspector-placeholder')!;
      expect(placeholder.tagName).toBe('SPAN');
      expect(placeholder.getAttribute('aria-hidden')).toBe('true');
      expect(placeholder.getAttribute('tabindex')).toBeNull();
      // Tab order skips it: close, then Inspect/Open, Inspect/Open, Open
      expect(menuButtons().map(b => b.textContent!.trim())).toEqual([
        'close',
        'Inspect',
        'Open ↗',
        'Inspect',
        'Open ↗',
        'Open ↗',
      ]);
      close();
    });

    it('opens from the keyboard (openMenuKey) with the same rows', () => {
      turnOn();
      hover($('b')[0]!);
      win.document.body.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
      );
      flushSync();
      expect(menuRows().map(rowText)).toEqual([
        expect.stringMatching(/^<b> .*Picked\.svelte:6 Inspect Open ↗$/),
      ]);
      close();
    });

    it('an element the DevTools do not track: its row has Open only', () => {
      const bold = $('b')[0]!;
      const ctx = (bold as any).__svelte_meta.component;
      const id = dt()._idByContext.get(ctx);
      dt()._idByContext.delete(ctx);
      try {
        openMenu(bold);
        expect(menuRows()).toHaveLength(1);
        expect(inspectOf(menuRows()[0]!)).toBeNull();
        expect(menuButtons().map(b => b.textContent!.trim())).toEqual(['close', 'Open ↗']);
      } finally {
        dt()._idByContext.set(ctx, id);
        close();
      }
    });
  });
});
