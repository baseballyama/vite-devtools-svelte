import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { track } from '../test/runes.svelte.js';
import { createTheme } from './theme.svelte.js';

const KEY = 'svelte-devtools-theme';

// Fakes for the OS preference, storage and <html data-theme>.
let osDark = false;
let changeListeners: ((e: { matches: boolean }) => void)[] = [];
let store: Map<string, string>;
let storageFails = false;
const html = { dataset: {} as Record<string, string> };

/** Queries the theme asked `matchMedia` about. */
const queries: string[] = [];

/** Store a theme choice (`undefined`: none stored). */
function seed(stored: string | undefined) {
  store = new Map(stored === undefined ? [] : [[KEY, stored]]);
}

function osChanges(dark: boolean) {
  osDark = dark;
  for (const l of changeListeners) l({ matches: dark });
}

beforeEach(() => {
  osDark = false;
  changeListeners = [];
  store = new Map();
  storageFails = false;
  html.dataset = {};
  const guard = () => {
    if (storageFails) throw new DOMException('denied', 'SecurityError');
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (guard(), store.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), store.set(k, v)),
    removeItem: (k: string) => (guard(), store.delete(k)),
  });
  vi.stubGlobal('window', {
    matchMedia: (q: string) => {
      queries.push(q);
      return {
        matches: osDark,
        addEventListener: (_: 'change', l: (e: { matches: boolean }) => void) =>
          changeListeners.push(l),
      };
    },
  });
  vi.stubGlobal('document', { documentElement: html });
});
afterEach(() => {
  queries.length = 0;
  vi.unstubAllGlobals();
});

describe('createTheme: initial state', () => {
  it.each([
    [undefined, false, 'system'],
    [undefined, true, 'system'],
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    // Anything else stored is ignored.
    ['blue', true, 'system'],
    ['', false, 'system'],
  ] as const)('stored %j, OS dark %s → mode %s', (stored, dark, mode) => {
    seed(stored);
    osDark = dark;
    const t = createTheme();
    expect(t.mode).toBe(mode);
    // The bootstrap script in index.html sets the first theme.
    expect(html.dataset['theme']).toBeUndefined();
  });

  it.each([
    ['dark', 'dark'],
    [undefined, 'system'],
  ] as const)('needs no window to construct or set a theme (stored %j)', (stored, mode) => {
    seed(stored);
    Reflect.deleteProperty(globalThis, 'window');
    const t = createTheme();
    expect(t.mode).toBe(mode);
    t.set('light');
    expect(html.dataset['theme']).toBe('light');
  });

  it('asks only about the dark-mode preference', () => {
    createTheme().set('system');
    expect(new Set(queries)).toEqual(new Set(['(prefers-color-scheme: dark)']));
  });

  it('falls back to system mode when storage throws', () => {
    storageFails = true;
    const t = createTheme();
    expect(t.mode).toBe('system');
  });
});

describe('createTheme: set', () => {
  it('an explicit theme is stored, applied, and ignores OS changes', () => {
    const t = createTheme();
    t.set('dark');
    expect(store.get(KEY)).toBe('dark');
    expect([t.mode, html.dataset['theme']]).toEqual(['dark', 'dark']);
    osChanges(false);
    expect(html.dataset['theme']).toBe('dark');
  });

  it("'system' forgets the stored choice, applies the OS theme and follows it live", () => {
    store.set(KEY, 'light');
    osDark = true;
    const t = createTheme();
    t.set('system');
    expect(store.has(KEY)).toBe(false);
    expect([t.mode, html.dataset['theme']]).toEqual(['system', 'dark']);
    osChanges(false);
    expect(html.dataset['theme']).toBe('light');
    osChanges(true);
    expect(html.dataset['theme']).toBe('dark');
  });

  it('works (in memory) when storage throws', () => {
    const t = createTheme();
    storageFails = true;
    expect(() => t.set('dark')).not.toThrow();
    expect(html.dataset['theme']).toBe('dark');
    expect(() => t.set('system')).not.toThrow();
    expect(t.mode).toBe('system');
  });

  it('mode is reactive', () => {
    const t = createTheme();
    const tr = track(() => t.mode);
    t.set('dark');
    tr.flush();
    t.set('system');
    tr.flush();
    tr.stop();
    expect(tr.seen).toEqual(['system', 'dark', 'system']);
  });
});
