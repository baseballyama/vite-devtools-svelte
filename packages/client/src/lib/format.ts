/**
 * Path / file display helpers shared across panels.
 *
 * Vite normalizes paths to forward-slash on every platform, but we still
 * accept backslash too so that anything bypassing Vite's normalization
 * (e.g. raw FS paths surfaced from analyzers on Windows) renders correctly.
 */

const PATH_SEP = /[\\/]/

/**
 * Last `depth` segments of a path, joined with `/`. Useful for compact
 * display in lists where the full path is in a tooltip / detail panel.
 *
 * @example
 *   shortPath('src/lib/components/Counter.svelte') // → 'components/Counter.svelte'
 *   shortPath('src/lib/components/Counter.svelte', 3) // → 'lib/components/Counter.svelte'
 *   shortPath('Counter.svelte') // → 'Counter.svelte'
 */
export function shortPath(path: string, depth = 2): string {
  if (!path) return ''
  return path.split(PATH_SEP).slice(-depth).join('/')
}

/**
 * Last segment of a path (basename), without directory.
 *
 * @example
 *   basename('src/lib/Counter.svelte') // → 'Counter.svelte'
 *   basename('') // → ''
 */
export function basename(path: string): string {
  if (!path) return ''
  return path.split(PATH_SEP).pop() ?? ''
}

/**
 * Display name for a Svelte component file. Strips both the directory
 * prefix and the `.svelte` extension. Falls back to a passed default.
 *
 * @example
 *   componentName('src/lib/Counter.svelte') // → 'Counter'
 *   componentName('') // → 'Unknown'
 *   componentName(undefined, '?') // → '?'
 */
export function componentName(file: string | undefined | null, fallback = 'Unknown'): string {
  if (!file) return fallback
  const last = basename(file)
  return last.replace(/\.svelte$/, '') || fallback
}

/** Human-readable byte size: `512 B`, `1.4 KB`, `2.31 MB`. */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Millisecond duration with precision that adapts to magnitude. */
export function formatMs(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 100) return `${ms.toFixed(0)} ms`
  if (ms >= 10) return `${ms.toFixed(1)} ms`
  return `${ms.toFixed(2)} ms`
}

/** Wall-clock time `HH:MM:SS` (optionally with milliseconds). */
export function formatClock(ts: number, millis = false): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(millis ? { fractionalSecondDigits: 3 } : {}),
  })
}

/** Compact one-line rendering of an arbitrary value (JSON-ish, truncated). */
export function formatValue(v: unknown, max = 80): string {
  if (v === undefined) return 'undefined'
  let s: string
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v))
  } catch {
    s = String(v)
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Pretty multi-line rendering of an arbitrary value for inspectors. */
export function prettyValue(v: unknown): string {
  if (v === undefined) return 'undefined'
  try {
    return JSON.stringify(v, null, 2) ?? String(v)
  } catch {
    return String(v)
  }
}

/** Relative "x s ago" label for freshness indicators. */
export function formatAgo(ts: number | null, now = Date.now()): string {
  if (ts == null) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}
