import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { haystack, haystackMatcher, highlightParts, matcher } from './match.js'

/** `m(...args)`, or `null` when the query produced no matcher. */
function applyOrNull<A extends unknown[]>(
  m: ((...args: A) => boolean) | null,
  ...args: A
): boolean | null {
  return m ? m(...args) : null
}

/** Offsets highlighted by `parts` that no occurrence of a term covers. */
function uncoveredMarks(text: string, terms: string[], parts: { t: string; m: boolean }[]) {
  const lower = text.toLowerCase()
  const covered = new Uint8Array(text.length)
  for (const t of terms)
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1))
      covered.fill(1, i, i + t.length)
  const out: number[] = []
  let at = 0
  for (const p of parts) {
    for (let i = at; i < at + p.t.length; i++) if (p.m && !covered[i]) out.push(i)
    at += p.t.length
  }
  return out
}

/** Highlighted segments of `text` for query `q`. */
const marked = (text: string, q: string) =>
  highlightParts(text, q)
    .filter(p => p.m)
    .map(p => p.t)

describe('matcher', () => {
  it.each(['', '   ', '\t\n'])('a blank query (%j) means "no filter" (null)', q => {
    expect(matcher(q)).toBeNull()
    expect(haystackMatcher(q)).toBeNull()
  })

  it.each([
    // [query, fields, expected]
    ['count', ['Counter'], true],
    ['COUNT', ['counter'], true],
    ['  count  ', ['counter'], true],
    ['counter 42', ['Counter', '42'], true],
    ['42 counter', ['Counter', '42'], true],
    ['counter 43', ['Counter', '42'], false],
    ['missing', ['Counter'], false],
    // Terms are literal substrings, not patterns.
    ['a.b', ['axb'], false],
    ['a.b', ['a.b'], true],
    ['(x', ['f(x)'], true],
    ['[0]', ['items[0]'], true],
    ['$state', ['$state(0)'], true],
    ['.*', ['anything'], false],
    ['\\', ['C:\\app'], true],
    // Empty / missing fields are skipped.
    ['x', [undefined, null, '', 'x'], true],
    ['x', [undefined, null], false],
  ] as const)('matcher(%j)(%j) → %s', (q, fields, expected) => {
    expect(matcher(q)!(...fields)).toBe(expected)
  })

  it('one term must not match across two fields', () => {
    expect(matcher('ab')!('a', 'b')).toBe(false)
  })

  it('haystackMatcher(q)(haystack(...f)) ≡ matcher(q)(...f)', () => {
    const field = fc.option(fc.string({ maxLength: 8 }), { nil: undefined })
    fc.assert(
      fc.property(fc.string({ maxLength: 6 }), fc.array(field, { maxLength: 4 }), (q, fields) => {
        const a = matcher(q)
        const b = haystackMatcher(q)
        expect(applyOrNull(b, haystack(...fields))).toBe(applyOrNull(a, ...fields))
      }),
    )
  })
})

describe('haystack', () => {
  it('joins non-empty fields lowercased with newlines', () => {
    expect(haystack('A', undefined, '', null, 'B c')).toBe('a\nb c')
    expect(haystack()).toBe('')
  })
})

describe('highlightParts', () => {
  it.each([
    ['Counter', '', [{ t: 'Counter', m: false }]],
    ['Counter', '   ', [{ t: 'Counter', m: false }]],
    ['', 'x', [{ t: '', m: false }]],
    ['Counter', 'zz', [{ t: 'Counter', m: false }]],
    ['Counter', 'counter', [{ t: 'Counter', m: true }]],
    [
      'my Counter',
      'COUNT',
      [
        { t: 'my ', m: false },
        { t: 'Count', m: true },
        { t: 'er', m: false },
      ],
    ],
  ])('highlightParts(%j, %j)', (text, q, expected) => {
    expect(highlightParts(text, q)).toEqual(expected)
  })

  it('marks every occurrence of every term', () => {
    expect(marked('abcabc', 'b')).toEqual(['b', 'b'])
    expect(marked('foo bar foo', 'foo bar')).toEqual(['foo', 'bar', 'foo'])
  })

  it('merges overlapping and adjacent term ranges into one part', () => {
    expect(highlightParts('abcd', 'abc bcd')).toEqual([{ t: 'abcd', m: true }])
    expect(highlightParts('xabyz', 'ab y')).toEqual([
      { t: 'x', m: false },
      { t: 'aby', m: true },
      { t: 'z', m: false },
    ])
  })

  it('finds non-overlapping repeats of a term (aaa / aa)', () => {
    expect(highlightParts('aaa', 'aa')).toEqual([
      { t: 'aa', m: true },
      { t: 'a', m: false },
    ])
  })

  it('treats regex metacharacters literally', () => {
    expect(marked('f(x) = a.b*[0]', '( .b* [0]')).toEqual(['(', '.b*[0]'])
    expect(marked('abc', '.')).toEqual([])
  })

  it('keeps offsets aligned when lowercasing changes the length (İ → i̇)', () => {
    // 'İ'.toLowerCase() is two code units; marks used to shift right by one.
    expect(marked('İstanbul code', 'code')).toEqual(['code'])
    expect(marked('İİ abc', 'abc')).toEqual(['abc'])
  })

  it('property: parts concatenate back to the text and alternate', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 30 }),
        fc.string({ unit: 'binary', maxLength: 6 }),
        (text, q) => {
          const parts = highlightParts(text, q)
          expect(parts.map(p => p.t).join('')).toBe(text)
          for (let i = 1; i < parts.length; i++) {
            expect(parts[i]!.m).not.toBe(parts[i - 1]!.m)
            expect(parts[i]!.t).not.toBe('')
          }
        },
      ),
    )
  })

  it('property: a marked part is covered by query terms; a match marks something', () => {
    const word = fc.stringMatching(/^[a-cA-C]{1,3}$/)
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-cA-C ]{0,20}$/),
        fc.array(word, { minLength: 1, maxLength: 3 }),
        (text, terms) => {
          const q = terms.join(' ')
          const parts = highlightParts(text, q)
          const lowerTerms = terms.map(t => t.toLowerCase())
          expect(uncoveredMarks(text, lowerTerms, parts)).toEqual([])
          const anyTermFound = lowerTerms.some(t => text.toLowerCase().includes(t))
          expect(parts.some(p => p.m)).toBe(anyTermFound)
        },
      ),
    )
  })
})
