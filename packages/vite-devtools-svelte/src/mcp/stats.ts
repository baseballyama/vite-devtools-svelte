export function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

// reduce, not `Math.min(...)`: long lists overflow the stack
export function min<T>(xs: number[], fallback: T): number | T {
  return xs.length === 0 ? fallback : xs.reduce((m, x) => Math.min(m, x), Infinity);
}

export function max<T>(xs: number[], fallback: T): number | T {
  return xs.length === 0 ? fallback : xs.reduce((m, x) => Math.max(m, x), -Infinity);
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function avgRenderTime(p: { renderCount: number; totalRenderTime: number }): number {
  return p.renderCount > 0 ? p.totalRenderTime / p.renderCount : 0;
}
