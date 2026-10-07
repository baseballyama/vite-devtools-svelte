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

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const

/** Human-readable byte size: `512 B`, `1.4 KB`, `2.31 MB`, `1.50 GB`. */
export function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—'
  // The unit follows the magnitude (a negative delta of 2 MB is `-2.00 MB`,
  // not `-2097152 B`), and sizes past 1 GB no longer read as `1048576.00 MB`.
  if (Math.abs(bytes) < 1024) return `${bytes} B`
  let v = bytes / 1024
  let unit = 0
  while (Math.abs(v) >= 1024 && unit < BYTE_UNITS.length - 1) {
    v /= 1024
    unit++
  }
  return `${v.toFixed(unit === 0 ? 1 : 2)} ${BYTE_UNITS[unit]}`
}

/** Millisecond duration with precision that adapts to magnitude. */
export function formatMs(ms: number | undefined | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
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

/**
 * Last-resort `String()` for values JSON cannot represent (functions,
 * symbols, bigints, cyclic objects). Objects intentionally keep their own
 * `toString()` (or the `[object Object]` default) — there is nothing better
 * to show for an unserialisable value.
 */
export function toText(v: unknown): string {
  return typeof v === 'string' ? v : String(v)
}

/** Compact one-line rendering of an arbitrary value (JSON-ish, truncated). */
export function formatValue(v: unknown, max = 80): string {
  if (v === undefined) return 'undefined'
  // JSON has no NaN / ±Infinity (`JSON.stringify(NaN) === 'null'`): showing
  // `null` for them would misreport the value.
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
  let s: string
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? toText(v))
  } catch {
    s = toText(v)
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Pretty multi-line rendering of an arbitrary value for inspectors. */
export function prettyValue(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v) // see formatValue
  try {
    return JSON.stringify(v, null, 2) ?? toText(v)
  } catch {
    return toText(v)
  }
}

/** Relative "x s ago" label for freshness indicators. */
export function formatAgo(ts: number | null, now = Date.now()): string {
  if (ts === null) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}
