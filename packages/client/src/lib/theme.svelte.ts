/**
 * Theme management for the DevTools UI.
 *
 * Three modes are exposed to the user:
 * - `'system'` — follow `prefers-color-scheme`; updates live as the OS preference
 *   changes. This is the default on first load (no localStorage entry).
 * - `'light'` / `'dark'` — explicit override; persisted to localStorage and the
 *   OS preference is ignored until the user goes back to `'system'`.
 *
 * The actual `data-theme` attribute is always `'light'` or `'dark'` (set by the
 * bootstrap script in index.html so we avoid FOUC). This module wraps that
 * mechanism with a Svelte 5 reactive state and exposes a `setTheme()` function
 * for the toggle UI to call.
 */

const STORAGE_KEY = 'svelte-devtools-theme'
const MQ = '(prefers-color-scheme: dark)'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

function readStored(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(MQ).matches ? 'dark' : 'light'
}

/** A reactive store of the current theme state. Use `theme.mode` and
 * `theme.resolved` from Svelte components; both are tracked. */
export function createThemeStore() {
  const stored = readStored()
  let mode = $state<ThemeMode>(stored ?? 'system')
  let resolved = $state<ResolvedTheme>(stored ?? systemTheme())

  // Keep `data-theme` attribute in sync so CSS variables apply.
  function apply(next: ResolvedTheme) {
    document.documentElement.dataset.theme = next
    resolved = next
  }

  // Listen for OS preference changes — only relevant in 'system' mode, but
  // attach unconditionally so toggling back to 'system' takes immediate effect.
  if (typeof window !== 'undefined') {
    window.matchMedia(MQ).addEventListener('change', e => {
      if (mode === 'system') apply(e.matches ? 'dark' : 'light')
    })
  }

  function set(next: ThemeMode) {
    mode = next
    if (next === 'system') {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {}
      apply(systemTheme())
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {}
      apply(next)
    }
  }

  return {
    get mode() {
      return mode
    },
    get resolved() {
      return resolved
    },
    set,
  }
}

export type ThemeStore = ReturnType<typeof createThemeStore>
