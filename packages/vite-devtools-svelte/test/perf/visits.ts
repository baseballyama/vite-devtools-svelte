// Deterministic work counter: number of elements visited by Map/Set/Array
// iteration while `fn` runs. Wall-clock ratios are too noisy on shared CI
// machines; element visits expose O(n²) loops exactly. Shared by the perf and
// reactivity scaling tests. Patching the prototypes permanently disables V8
// fast paths (protectors) for the worker, so callers live in their own files.
export function countVisits(fn: () => void): number {
  let visits = 0
  const restores: Array<() => void> = []
  const patchIter = (proto: any, key: PropertyKey) => {
    const orig = proto[key]
    proto[key] = function (this: any, ...args: any[]) {
      const it = orig.apply(this, args)
      const next = it.next.bind(it)
      return {
        next() {
          visits++
          return next()
        },
        [Symbol.iterator]() {
          return this
        },
      }
    }
    restores.push(() => {
      proto[key] = orig
    })
  }
  const patchLinear = (proto: any, key: string) => {
    const orig = proto[key]
    proto[key] = function (this: any, ...args: any[]) {
      visits += this.length ?? this.size ?? 0
      return orig.apply(this, args)
    }
    restores.push(() => {
      proto[key] = orig
    })
  }
  for (const proto of [Map.prototype, Set.prototype]) {
    for (const key of ['entries', 'keys', 'values', Symbol.iterator]) patchIter(proto, key)
    patchLinear(proto, 'forEach')
  }
  for (const key of [
    'filter',
    'indexOf',
    'includes',
    'splice',
    'forEach',
    'map',
    'some',
    'find',
    'findIndex',
  ]) {
    patchLinear(Array.prototype, key)
  }
  try {
    fn()
  } finally {
    for (const r of restores.toReversed()) r()
  }
  return visits
}
