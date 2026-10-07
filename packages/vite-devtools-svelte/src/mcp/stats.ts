/** Arithmetic mean, 0 for no values. */
export function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Smallest value, `fallback` for no values (reduce, not `Math.min(...)`: long lists overflow the stack). */
export function min<T>(xs: number[], fallback: T): number | T {
  return xs.length === 0 ? fallback : xs.reduce((m, x) => Math.min(m, x), Infinity)
}

/** Largest value, `fallback` for no values. */
export function max<T>(xs: number[], fallback: T): number | T {
  return xs.length === 0 ? fallback : xs.reduce((m, x) => Math.max(m, x), -Infinity)
}

/** Rounded to 2 decimals. */
export function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Average render time of a profile, 0 when it never rendered. */
export function avgRenderTime(p: { renderCount: number; totalRenderTime: number }): number {
  return p.renderCount > 0 ? p.totalRenderTime / p.renderCount : 0
}
