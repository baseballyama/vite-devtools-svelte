// The bootstrap script in index.html sets `data-theme` first to avoid FOUC;
// this module keeps it in sync.

const STORAGE_KEY = 'svelte-devtools-theme';
const MQ = '(prefers-color-scheme: dark)';

export type ThemeMode = 'system' | 'light' | 'dark';

function readStored(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia(MQ).matches ? 'dark' : 'light';
}

function apply(next: 'light' | 'dark') {
  document.documentElement.dataset.theme = next;
}

export function createTheme() {
  const stored = readStored();
  let mode = $state<ThemeMode>(stored ?? 'system');

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
    set,
  };
}
