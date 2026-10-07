import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { countBy, groupBy } from './collections.js'

describe('countBy', () => {
  it('counts per key in first-occurrence order', () => {
    const m = countBy(['b', 'a', 'b', 'c', 'b'], s => s)
    expect([...m]).toEqual([
      ['b', 3],
      ['a', 1],
      ['c', 1],
    ])
  })

  it('accepts any iterable and non-string keys', () => {
    expect([...countBy(new Set([1, 2, 3, 4]), n => n % 2 === 0)]).toEqual([
      [false, 2],
      [true, 2],
    ])
    expect(countBy([], () => 0).size).toBe(0)
  })

  it('property: counts add up to the input length', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 })), xs => {
        const m = countBy(xs, x => x)
        expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(xs.length)
        for (const [k, v] of m) expect(v).toBe(xs.filter(x => x === k).length)
      }),
    )
  })
})

describe('groupBy', () => {
  it('groups items in input order, keys in first-occurrence order', () => {
    const m = groupBy(
      [
        { f: 'a', n: 1 },
        { f: 'b', n: 2 },
        { f: 'a', n: 3 },
      ],
      x => x.f,
    )
    expect([...m.keys()]).toEqual(['a', 'b'])
    expect(m.get('a')!.map(x => x.n)).toEqual([1, 3])
  })

  it('maps values when given a value function', () => {
    const m = groupBy(
      [1, 2, 3, 4],
      n => n % 2,
      n => n * 10,
    )
    expect([...m]).toEqual([
      [1, [10, 30]],
      [0, [20, 40]],
    ])
  })

  it('property: flattening the groups gives back every item once', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 })), xs => {
        const m = groupBy(xs, x => x % 3)
        expect([...m.values()].flat().toSorted((a, b) => a - b)).toEqual(
          xs.toSorted((a, b) => a - b),
        )
        for (const [k, group] of m) expect(group).toEqual(xs.filter(x => x % 3 === k))
      }),
    )
  })
})
