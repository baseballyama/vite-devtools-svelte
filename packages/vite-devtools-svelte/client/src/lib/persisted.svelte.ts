/**
 * Small `$state` wrapper persisted to localStorage — used for UI preferences
 * (nav collapsed, split widths, view modes). Storage failures (private mode,
 * sandboxed iframes) silently fall back to in-memory state.
 */
const PREFIX = 'svelte-devtools:'

export function persisted<T>(key: string, initial: T) {
  let value = $state<T>(read(key, initial))
  return {
    get value() {
      return value
    },
    set value(v: T) {
      value = v
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(v))
      } catch {}
    },
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
