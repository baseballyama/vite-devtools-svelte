import { flushSync, mount, unmount } from 'svelte';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Picked from './fixtures/Picked.svelte';
import { dt, instances, render } from './harness.js';

// The forked Svelte Inspector (packages/inspector) mounted on the page with
// the DevTools link, over real compiled components: hover names the component
// instance, a click picks it, Alt+click opens the editor as upstream does, and
// the right-click menu offers both.

// DOM surface the test touches (the package type-checks against Node's lib only).
interface El {
  dispatchEvent(event: unknown): boolean;
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
  const host = win.document.createElement('div');
  win.document.documentElement.append(host);
  inspector = link.untracked(() => mount(Inspector, { target: host }));
  flushSync();
});
afterAll(() => {
  void unmount(inspector);
  app.destroy();
  dt()._hot = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  sent = [];
  fetches.mockClear();
});

const $ = (selector: string) => [...(app.target as unknown as El).querySelectorAll(selector)];
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
// The menu's rows (close first), as their text
const menuButtons = () => [...overlay()!.querySelectorAll('button')];
const rowText = (el: El) => el.textContent!.replaceAll(/\s+/g, ' ').trim();
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
    it('lists the instance to inspect, then the element and its parents to open', () => {
      turnOn();
      const second = $('span')[1]!;
      hover(second);
      rightClick(second);
      const rows = menuButtons();
      expect(rows.map(rowText)).toEqual([
        'close',
        '<Child> inspect in DevTools',
        expect.stringMatching(/^<span> .*Child\.svelte:6$/),
        expect.stringMatching(/^<Child> .*Picked\.svelte:9$/),
      ]);
      // native buttons in that order, focus on "close" as upstream: Tab reaches both actions
      expect(rows.every(b => b.tagName === 'BUTTON')).toBe(true);
      expect(win.document.activeElement).toBe(rows[0]);
      controls.disable();
      flushSync();
    });

    it('"inspect in DevTools" picks the instance and turns the inspector off', () => {
      turnOn();
      const second = $('span')[1]!;
      hover(second);
      rightClick(second);
      menuButtons()[1]!.click();
      flushSync();
      expect(sent).toEqual([
        {
          event: 'svelte-devtools:element-picked',
          data: expect.objectContaining({ componentId: instances('Child')[1]!.id }),
        },
      ]);
      expect(fetches).not.toHaveBeenCalled();
      expect(enabled()).toBe(false);
    });

    it('the element row opens it in the editor', () => {
      turnOn();
      const second = $('span')[1]!;
      hover(second);
      rightClick(second);
      menuButtons()[2]!.click();
      flushSync();
      expect(sent).toEqual([]);
      expect(fetches).toHaveBeenCalledWith(
        expect.stringMatching(/^\/__open-in-editor\?file=.*Child\.svelte%3A6%3A1$/),
      );
      controls.disable();
      flushSync();
    });

    it('opens from the keyboard (openMenuKey) with the same rows', () => {
      turnOn();
      hover($('b')[0]!);
      win.document.body.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
      );
      flushSync();
      expect(menuButtons().map(rowText).slice(0, 3)).toEqual([
        'close',
        '<Picked> inspect in DevTools',
        expect.stringMatching(/^<b> .*Picked\.svelte:6$/),
      ]);
      controls.disable();
      flushSync();
    });

    it('without a known instance only the upstream rows', () => {
      const bold = $('b')[0]!;
      const ctx = (bold as any).__svelte_meta.component;
      const id = dt()._idByContext.get(ctx);
      dt()._idByContext.delete(ctx);
      try {
        turnOn();
        hover(bold);
        rightClick(bold);
        expect(menuButtons().map(rowText)).toEqual([
          'close',
          expect.stringMatching(/^<b> .*Picked\.svelte:6$/),
        ]);
      } finally {
        dt()._idByContext.set(ctx, id);
        controls.disable();
        flushSync();
      }
    });
  });
});
