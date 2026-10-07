import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { track } from './testing.svelte.js'
import { createThemeStore } from './theme.svelte.js'

const KEY = 'svelte-devtools-theme'

// Fakes for the OS preference, storage and <html data-theme>.
let osDark = false
let changeListeners: ((e: { matches: boolean }) => void)[] = []
let store: Map<string, string>
let storageFails = false
const html = { dataset: {} as Record<string, string> }

/** Queries the store asked `matchMedia` about. */
const queries: string[] = []

/** Store a theme choice (`undefined`: none stored). */
function seed(stored: string | undefined) {
  store = new Map(stored === undefined ? [] : [[KEY, stored]])
}

function osChanges(dark: boolean) {
  osDark = dark
  for (const l of changeListeners) l({ matches: dark })
}

beforeEach(() => {
  osDark = false
  changeListeners = []
  store = new Map()
  storageFails = false
  html.dataset = {}
  const guard = () => {
    if (storageFails) throw new DOMException('denied', 'SecurityError')
  }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (guard(), store.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), store.set(k, v)),
    removeItem: (k: string) => (guard(), store.delete(k)),
  })
  vi.stubGlobal('window', {
    matchMedia: (q: string) => {
      queries.push(q)
      return {
        matches: osDark,
        addEventListener: (_: 'change', l: (e: { matches: boolean }) => void) =>
          changeListeners.push(l),
      }
    },
  })
  vi.stubGlobal('document', { documentElement: html })
})
afterEach(() => {
  queries.length = 0
  vi.unstubAllGlobals()
})

describe('createThemeStore: initial state', () => {
  it.each([
    [undefined, false, 'system', 'light'],
    [undefined, true, 'system', 'dark'],
    ['dark', false, 'dark', 'dark'],
    ['light', true, 'light', 'light'],
    // Anything else stored is ignored.
    ['blue', true, 'system', 'dark'],
    ['', false, 'system', 'light'],
  ] as const)('stored %j, OS dark %s → mode %s, resolved %s', (stored, dark, mode, resolved) => {
    seed(stored)
    osDark = dark
    const t = createThemeStore()
    expect([t.mode, t.resolved]).toEqual([mode, resolved])
  })

  it('with a stored theme it needs no window (no OS listener)', () => {
    store.set(KEY, 'dark')
    Reflect.deleteProperty(globalThis, 'window')
    const t = createThemeStore()
    expect([t.mode, t.resolved]).toEqual(['dark', 'dark'])
    t.set('light')
    expect(html.dataset['theme']).toBe('light')
  })

  it('asks only about the dark-mode preference', () => {
    createThemeStore().set('system')
    expect(new Set(queries)).toEqual(new Set(['(prefers-color-scheme: dark)']))
  })

  it('falls back to the OS preference when storage throws', () => {
    storageFails = true
    osDark = true
    const t = createThemeStore()
    expect([t.mode, t.resolved]).toEqual(['system', 'dark'])
  })
})

describe('createThemeStore: set', () => {
  it('an explicit theme is stored, applied, and ignores OS changes', () => {
    const t = createThemeStore()
    t.set('dark')
    expect(store.get(KEY)).toBe('dark')
    expect(html.dataset['theme']).toBe('dark')
    expect([t.mode, t.resolved]).toEqual(['dark', 'dark'])
    osChanges(false)
    expect(t.resolved).toBe('dark')
    expect(html.dataset['theme']).toBe('dark')
  })

  it("'system' forgets the stored choice, applies the OS theme and follows it live", () => {
    store.set(KEY, 'light')
    osDark = true
    const t = createThemeStore()
    t.set('system')
    expect(store.has(KEY)).toBe(false)
    expect([t.mode, t.resolved, html.dataset['theme']]).toEqual(['system', 'dark', 'dark'])
    osChanges(false)
    expect([t.resolved, html.dataset['theme']]).toEqual(['light', 'light'])
  })

  it('works (in memory) when storage throws', () => {
    const t = createThemeStore()
    storageFails = true
    expect(() => t.set('dark')).not.toThrow()
    expect(t.resolved).toBe('dark')
    expect(() => t.set('system')).not.toThrow()
    expect(t.mode).toBe('system')
  })

  it('mode and resolved are reactive', () => {
    const t = createThemeStore()
    const tr = track(() => `${t.mode}/${t.resolved}`)
    t.set('dark')
    tr.flush()
    t.set('system')
    tr.flush()
    osChanges(true)
    tr.flush()
    tr.stop()
    expect(tr.seen).toEqual(['system/light', 'dark/dark', 'system/light', 'system/dark'])
  })
})
