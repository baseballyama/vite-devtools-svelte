// Vite normalizes paths to `/`, but anything bypassing it (e.g. raw FS paths
// from analyzers on Windows) can still carry `\`.
const segments = (path: string) => path.replaceAll('\\', '/').split('/');

export function shortPath(path: string, depth = 2): string {
  return segments(path).slice(-depth).join('/');
}

export function basename(path: string): string {
  return segments(path).pop()!;
}

export function componentName(file: string | undefined | null, fallback = 'Unknown'): string {
  if (!file) return fallback;
  // Only a trailing `.svelte` is the component extension: module state lives
  // in `x.svelte.ts`, which must not read as `x.ts`.
  const last = basename(file);
  return (last.endsWith('.svelte') ? last.slice(0, -'.svelte'.length) : last) || fallback;
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  // The unit follows the magnitude: a negative delta of 2 MB is `-2.00 MB`,
  // not `-2097152 B`.
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  let v = bytes / 1024;
  let unit = 0;
  while (Math.abs(v) >= 1024 && unit < BYTE_UNITS.length - 1) {
    v /= 1024;
    unit++;
  }
  return `${v.toFixed(unit === 0 ? 1 : 2)} ${BYTE_UNITS[unit]}`;
}

export function formatMs(ms: number | undefined | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

export function formatClock(ts: number, millis = false): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(millis ? { fractionalSecondDigits: 3 } : {}),
  });
}

/**
 * Objects intentionally keep their own `toString()` (or `[object Object]`):
 * there is nothing better to show for a value JSON cannot represent.
 */
export function toText(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function formatValue(v: unknown, max = 80): string {
  if (v === undefined) return 'undefined';
  // JSON has no NaN / ±Infinity (`JSON.stringify(NaN) === 'null'`): showing
  // `null` for them would misreport the value.
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  let s: string;
  try {
    s = JSON.stringify(v) ?? toText(v);
  } catch {
    s = toText(v);
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function formatAgo(ts: number | null, now = Date.now()): string {
  if (ts === null) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function prettyValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v); // see formatValue
  try {
    return JSON.stringify(v, null, 2) ?? toText(v);
  } catch {
    return toText(v);
  }
}
