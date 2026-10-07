/** One option of a kind filter (`Segmented`). */
export interface KindOption<K extends string> {
  value: K | 'all'
  label: string
  count: number
}

/**
 * Options for a kind filter: "All", then each kind of `order` that has
 * items. The `current` choice stays listed even at 0 items — a filter whose
 * option vanished would stay applied with nothing showing it is on.
 */
export function kindOptions<K extends string>(
  order: readonly K[],
  counts: ReadonlyMap<K, number>,
  current: K | 'all',
  label: (kind: K) => string,
): KindOption<K>[] {
  let total = 0
  for (const n of counts.values()) total += n
  return [
    { value: 'all', label: 'All', count: total },
    ...order
      .filter(k => k === current || (counts.get(k) ?? 0) > 0)
      .map(k => ({ value: k, label: label(k), count: counts.get(k) ?? 0 })),
  ]
}
