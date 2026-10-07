import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { parseLineMappings } from './sourcemap.js'

// Reference Base64 VLQ encoder (Source Map v3), independent of the decoder.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1
  let out = ''
  do {
    let digit = v & 31
    v >>>= 5
    if (v > 0) digit |= 32
    out += B64.charAt(digit)
  } while (v > 0)
  return out
}
const seg = (fields: number[]) => fields.map(vlq).join('')

/** `{ compiledLine: [sourceLines] }` with sorted, 1-based numbers. */
function plain(m: Map<number, Set<number>>): Record<number, number[]> {
  return Object.fromEntries([...m].map(([k, v]) => [k, [...v].toSorted((a, b) => a - b)]))
}

/** `k:v` for every link of a line map, sorted. */
const pairs = (m: Map<number, Set<number>>) =>
  [...m].flatMap(([k, vs]) => [...vs].map(v => `${k}:${v}`)).toSorted()
/** `v:k` for every link (the inverse relation), sorted. */
const flipped = (m: Map<number, Set<number>>) =>
  [...m].flatMap(([k, vs]) => [...vs].map(v => `${v}:${k}`)).toSorted()

function link(m: Map<number, Set<number>>, k: number, v: number) {
  const set = m.get(k) ?? new Set<number>()
  set.add(v)
  m.set(k, set)
}

/** Reference line maps from decoded segments (`[col]` or `[col, src, line, srcCol, name?]` deltas). */
function referenceLineMaps(lines: number[][][]) {
  const c2s = new Map<number, Set<number>>()
  const s2c = new Map<number, Set<number>>()
  let src = 0
  for (const [i, l] of lines.entries()) {
    for (const fields of l) {
      if (fields.length < 4) continue
      src += fields[2]!
      link(c2s, i + 1, src + 1)
      link(s2c, src + 1, i + 1)
    }
  }
  return { c2s, s2c }
}

describe('reference encoder', () => {
  it.each([
    [0, 'A'],
    [1, 'C'],
    [-1, 'D'],
    [15, 'e'],
    [16, 'gB'],
    [-16, 'hB'],
    [1000, 'w+B'],
  ])('vlq(%i) = %j (spec examples)', (n, s) => {
    expect(vlq(n)).toBe(s)
  })
})

describe('parseLineMappings', () => {
  it('returns empty maps for empty mappings', () => {
    for (const m of ['', ';', ';;;', ',', ';,;']) {
      const r = parseLineMappings(m)
      expect(r.compiledToSource.size).toBe(0)
      expect(r.sourceToCompiled.size).toBe(0)
    }
  })

  it('links compiled line 1 to source line 1 for AAAA', () => {
    const r = parseLineMappings('AAAA')
    expect(plain(r.compiledToSource)).toEqual({ 1: [1] })
    expect(plain(r.sourceToCompiled)).toEqual({ 1: [1] })
  })

  it('accumulates the source-line delta across segments and lines, skipping empty lines', () => {
    // line 1: src +0, line 2: (empty), line 3: src +2 and +1, line 4: src -3
    const m = [
      seg([0, 0, 0, 0]),
      '',
      `${seg([0, 0, 2, 0])},${seg([4, 0, 1, 0])}`,
      seg([0, 0, -3, 0]),
    ].join(';')
    const r = parseLineMappings(m)
    expect(plain(r.compiledToSource)).toEqual({ 1: [1], 3: [3, 4], 4: [1] })
    expect(plain(r.sourceToCompiled)).toEqual({ 1: [1, 4], 3: [3], 4: [3] })
  })

  it('decodes multi-character values (deltas ≥ 16)', () => {
    const r = parseLineMappings(seg([0, 0, 1000, 0]))
    expect(plain(r.compiledToSource)).toEqual({ 1: [1001] })
  })

  it('ignores 1-field segments (unmapped columns) without losing the running source line', () => {
    const m = `${seg([0, 0, 5, 0])},${seg([3])};${seg([0, 0, 1, 0])}`
    expect(plain(parseLineMappings(m).compiledToSource)).toEqual({ 1: [6], 2: [7] })
  })

  it('accepts 5-field segments (with a name index)', () => {
    expect(plain(parseLineMappings(seg([0, 0, 2, 0, 7])).compiledToSource)).toEqual({ 1: [3] })
  })

  it('skips characters outside the Base64 alphabet', () => {
    expect(plain(parseLineMappings('AA!AA').compiledToSource)).toEqual({ 1: [1] })
  })

  it('property: matches a direct computation from the encoded segments', () => {
    const segment = fc.oneof(
      { weight: 1, arbitrary: fc.tuple(fc.integer({ min: 0, max: 50 })).map(a => Array.from(a)) },
      {
        weight: 5,
        arbitrary: fc
          .tuple(
            fc.integer({ min: 0, max: 200 }),
            fc.integer({ min: -3, max: 3 }),
            fc.integer({ min: -40, max: 40 }),
            fc.integer({ min: -100, max: 100 }),
          )
          .map(a => Array.from(a)),
      },
    )
    const lines = fc.array(fc.array(segment, { maxLength: 4 }), { maxLength: 12 })
    fc.assert(
      fc.property(lines, ls => {
        const mappings = ls.map(l => l.map(seg).join(',')).join(';')
        const { c2s, s2c } = referenceLineMaps(ls)
        const r = parseLineMappings(mappings)
        expect(plain(r.compiledToSource)).toEqual(plain(c2s))
        expect(plain(r.sourceToCompiled)).toEqual(plain(s2c))
      }),
    )
  })

  it('property: the two maps are inverse relations', () => {
    const quad = fc
      .tuple(fc.nat(30), fc.constant(0), fc.integer({ min: -5, max: 5 }), fc.nat(30))
      .map(a => seg(Array.from(a)))
    fc.assert(
      fc.property(fc.array(fc.array(quad, { maxLength: 3 }), { maxLength: 8 }), ls => {
        const r = parseLineMappings(ls.map(l => l.join(',')).join(';'))
        expect(pairs(r.compiledToSource)).toEqual(flipped(r.sourceToCompiled))
      }),
    )
  })
})
