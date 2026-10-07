/**
 * Small collection helpers for building indexes from RPC payloads. Maps keep
 * first-occurrence (insertion) order, like the hand-written loops they
 * replace.
 */

/** Number of items per key. */
export function countBy<T, K>(items: Iterable<T>, key: (item: T) => K): Map<K, number> {
  const out = new Map<K, number>()
  for (const item of items) {
    const k = key(item)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

/** Items (or `value(item)`) per key, each group in input order. */
export function groupBy<T, K>(items: Iterable<T>, key: (item: T) => K): Map<K, T[]>
export function groupBy<T, K, V>(
  items: Iterable<T>,
  key: (item: T) => K,
  value: (item: T) => V,
): Map<K, V[]>
export function groupBy<T, K, V>(
  items: Iterable<T>,
  key: (item: T) => K,
  value?: (item: T) => V,
): Map<K, (T | V)[]> {
  const out = new Map<K, (T | V)[]>()
  for (const item of items) {
    const k = key(item)
    const v = value ? value(item) : item
    const group = out.get(k)
    if (group) group.push(v)
    else out.set(k, [v])
  }
  return out
}
