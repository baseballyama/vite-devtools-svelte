import { flushSync, mount, unmount } from 'svelte';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import Picked from './fixtures/Picked.svelte';
import { render } from './harness.js';

// The forked Svelte Inspector without the DevTools link (the virtual module is
// `null`, as for `svelteInspector()` alone): hover and the right-click
// menu stay as upstream.

vi.mock('virtual:vite-devtools-svelte-inspector-devtools', () => ({ default: null }));

// DOM surface the test touches (the package type-checks against Node's lib only).
interface El {
  dispatchEvent(event: unknown): boolean;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): Iterable<El>;
  textContent: string | null;
  click(): void;
}
const win = globalThis as unknown as {
  document: {
    body: El;
    documentElement: { append(el: object): void };
    createElement(tag: string): object;
    querySelector(selector: string): El | null;
  };
  MouseEvent: new (type: string, init?: object) => unknown;
  KeyboardEvent: new (type: string, init?: object) => unknown;
};

const INSPECTOR = 'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte';
const Inspector = ((await import(/* @vite-ignore */ INSPECTOR)) as { default: any }).default;

const fetches = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve({}));
let inspector: ReturnType<typeof mount>;
let app: ReturnType<typeof render>;

beforeAll(() => {
  // as in inspector.test.ts: upstream calls the body's listener methods detached
  const { body } = win.document as unknown as { body: Record<string, any> };
  for (const name of ['addEventListener', 'removeEventListener']) {
    let owner = body;
    while (!Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
    const original = owner[name];
    vi.spyOn(owner, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      original.apply(this ?? body, args);
    });
  }
  vi.stubGlobal('fetch', fetches);
  app = render(Picked);
  const host = win.document.createElement('div');
  win.document.documentElement.append(host);
  inspector = mount(Inspector, { target: host });
  flushSync();
});
afterAll(() => {
  void unmount(inspector);
  app.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const overlayText = () =>
  win.document.querySelector('#svelte-inspector-overlay')!.textContent!.replaceAll(/\s+/g, ' ');

it('behaves as upstream: tag label, no hint, its rows open the editor', () => {
  const span = [...(app.target as unknown as El).querySelectorAll('span')][1]!;
  win.document.body.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'x', code: 'KeyX', altKey: true, bubbles: true }),
  );
  span.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
  flushSync();
  expect(overlayText()).toContain('<span>');
  expect(overlayText()).not.toContain('click:');

  span.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  flushSync();
  const rows = [
    ...win.document.querySelector('#svelte-inspector-overlay')!.querySelectorAll('button'),
  ];
  expect(rows.map(b => b.textContent!.replaceAll(/\s+/g, ' ').trim())).toEqual([
    'close',
    expect.stringMatching(/^<span> .*Child\.svelte:6$/),
    expect.stringMatching(/^<Child> .*Picked\.svelte:9$/),
  ]);
  rows[1]!.click();
  flushSync();
  expect(fetches).toHaveBeenCalledWith(
    expect.stringMatching(/^\/__open-in-editor\?file=.*Child\.svelte%3A6%3A1$/),
  );
});
