// The bootstrap script in index.html sets `data-theme` first to avoid FOUC;
// this module keeps it in sync.

const STORAGE_KEY = 'svelte-devtools-theme';
const MQ = '(prefers-color-scheme: dark)';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

function readStored(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(MQ).matches ? 'dark' : 'light';
}

export function createThemeStore() {
  const stored = readStored();
  let mode = $state<ThemeMode>(stored ?? 'system');
  let resolved = $state<ResolvedTheme>(stored ?? systemTheme());

  function apply(next: ResolvedTheme) {
    document.documentElement.dataset.theme = next;
    resolved = next;
  }

  // Listen for OS preference changes — only relevant in 'system' mode, but
  // attach unconditionally so toggling back to 'system' takes immediate effect.
  if (typeof window !== 'undefined') {
    window.matchMedia(MQ).addEventListener('change', e => {
      if (mode === 'system') apply(e.matches ? 'dark' : 'light');
    });
  }

  function set(next: ThemeMode) {
    mode = next;
    if (next === 'system') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      apply(systemTheme());
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      apply(next);
    }
  }

  return {
    get mode() {
      return mode;
    },
    get resolved() {
      return resolved;
    },
    set,
  };
}
