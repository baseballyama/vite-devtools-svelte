import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  basename,
  componentName,
  formatAgo,
  formatBytes,
  formatClock,
  formatMs,
  formatValue,
  prettyValue,
  shortPath,
  toText,
} from './format.js'

/** Index of the unit of a formatted size in B < KB < MB < GB < TB. */
const unitRank = (formatted: string) =>
  ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(formatted.split(' ')[1]!)

/** Local timestamp (formatClock shows local time). */
const at = (h: number, m: number, s: number, ms = 0) => new Date(2024, 0, 2, h, m, s, ms).getTime()

/** Reference truncation: at most `max` characters, the last one an ellipsis when cut. */
function truncated(full: string, max: number): string {
  return full.length <= max ? full : full.slice(0, max - 1) + '…'
}

describe('shortPath', () => {
  it.each([
    ['src/lib/components/Counter.svelte', 2, 'components/Counter.svelte'],
    ['src/lib/components/Counter.svelte', 3, 'lib/components/Counter.svelte'],
    ['src/lib/components/Counter.svelte', 1, 'Counter.svelte'],
    ['src/lib/components/Counter.svelte', 99, 'src/lib/components/Counter.svelte'],
    ['Counter.svelte', 2, 'Counter.svelte'],
    ['C:\\app\\src\\lib\\Counter.svelte', 2, 'lib/Counter.svelte'],
    ['src\\lib/mixed\\Counter.svelte', 3, 'lib/mixed/Counter.svelte'],
    ['/abs/x.svelte', 2, 'abs/x.svelte'],
    ['', 2, ''],
  ])('shortPath(%j, %i) → %j', (path, depth, expected) => {
    expect(shortPath(path, depth)).toBe(expected)
  })

  it('defaults to two segments', () => {
    expect(shortPath('a/b/c/d')).toBe('c/d')
  })

  it('never shows more segments than asked, always ends with the basename', () => {
    const seg = fc.stringMatching(/^[a-z.]{1,6}$/)
    fc.assert(
      fc.property(
        fc.array(seg, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 10 }),
        (segs, depth) => {
          const out = shortPath(segs.join('/'), depth)
          expect(out.split('/')).toHaveLength(Math.min(depth, segs.length))
          expect(out.endsWith(segs.at(-1)!)).toBe(true)
          expect(shortPath(segs.join('\\'), depth)).toBe(out)
        },
      ),
    )
  })
})

describe('basename', () => {
  it.each([
    ['src/lib/Counter.svelte', 'Counter.svelte'],
    ['Counter.svelte', 'Counter.svelte'],
    ['C:\\Users\\me\\app\\Counter.svelte', 'Counter.svelte'],
    ['src\\lib/Counter.svelte', 'Counter.svelte'],
    ['src/lib/', ''],
    ['', ''],
  ])('basename(%j) → %j', (path, expected) => {
    expect(basename(path)).toBe(expected)
  })
})

describe('componentName', () => {
  it.each([
    ['src/lib/Counter.svelte', undefined, 'Counter'],
    ['C:\\app\\Row.svelte', undefined, 'Row'],
    // Only the trailing extension is stripped.
    ['src/lib/store.svelte.ts', undefined, 'store.svelte.ts'],
    ['src/my.svelte.thing.svelte', undefined, 'my.svelte.thing'],
    ['', undefined, 'Unknown'],
    [undefined, undefined, 'Unknown'],
    [null, undefined, 'Unknown'],
    [undefined, '?', '?'],
    // Nothing left after stripping → fallback, not an empty label.
    ['src/.svelte', undefined, 'Unknown'],
    ['src/lib/', '?', '?'],
  ])('componentName(%j, %j) → %j', (file, fallback, expected) => {
    expect(componentName(file, fallback)).toBe(expected)
  })
})

describe('formatBytes', () => {
  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024
  const TB = GB * 1024
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [MB - 1, '1024.0 KB'],
    [MB, '1.00 MB'],
    [2.5 * MB, '2.50 MB'],
    [GB, '1.00 GB'],
    [1.5 * GB, '1.50 GB'],
    [TB, '1.00 TB'],
    // TB is the largest unit.
    [2048 * TB, '2048.00 TB'],
    [-1, '-1 B'],
    [-2048, '-2.0 KB'],
    [-2 * MB, '-2.00 MB'],
    [Number.NaN, '—'],
    [Infinity, '—'],
    [-Infinity, '—'],
    [undefined, '—'],
    [null, '—'],
  ])('formatBytes(%s) → %j', (n, expected) => {
    expect(formatBytes(n)).toBe(expected)
  })

  it('is monotonic in the shown unit order (B < KB < MB < GB < TB)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2 ** 50, noNaN: true }),
        fc.double({ min: 0, max: 2 ** 50, noNaN: true }),
        (a, b) => {
          expect(unitRank(formatBytes(Math.min(a, b)))).toBeLessThanOrEqual(
            unitRank(formatBytes(Math.max(a, b))),
          )
        },
      ),
    )
  })
})

describe('formatMs', () => {
  it.each([
    [0, '0.00 ms'],
    [0.004, '0.00 ms'],
    [0.5, '0.50 ms'],
    [9.99, '9.99 ms'],
    [10, '10.0 ms'],
    [99.94, '99.9 ms'],
    [100, '100 ms'],
    [999.4, '999 ms'],
    [1000, '1.00 s'],
    [1234.5, '1.23 s'],
    [61_000, '61.00 s'],
    [Number.NaN, '—'],
    [Infinity, '—'],
    [undefined, '—'],
    [null, '—'],
  ])('formatMs(%s) → %j', (n, expected) => {
    expect(formatMs(n)).toBe(expected)
  })
})

describe('formatClock', () => {
  it('is a 24-hour HH:MM:SS clock', () => {
    expect(formatClock(at(13, 5, 9))).toMatch(/^13\D05\D09$/)
    expect(formatClock(at(0, 0, 0))).toMatch(/^00\D00\D00$/)
    expect(formatClock(at(23, 59, 59))).toMatch(/^23\D59\D59$/)
  })

  it('adds milliseconds on request', () => {
    expect(formatClock(at(13, 5, 9, 7), true)).toMatch(/^13\D05\D09\D007$/)
  })
})

describe('toText', () => {
  it.each([
    ['abc', 'abc'],
    [1n, '1'],
    [Symbol('s'), 'Symbol(s)'],
    [null, 'null'],
    [{ toString: () => 'custom' }, 'custom'],
    [{}, '[object Object]'],
  ])('toText(%s) → %j', (v, expected) => {
    expect(toText(v)).toBe(expected)
  })
})

describe('formatValue', () => {
  const cyclic: Record<string, unknown> = { a: 1 }
  cyclic['self'] = cyclic

  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [0, '0'],
    [true, 'true'],
    ['hi', '"hi"'],
    ['', '""'],
    ['say "x"', '"say \\"x\\""'],
    [[1, 'a'], '[1,"a"]'],
    [{ a: 1 }, '{"a":1}'],
    // Values JSON cannot represent.
    [Number.NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
    [10n, '10'],
    [Symbol('k'), 'Symbol(k)'],
    [cyclic, '[object Object]'],
  ])('formatValue(%s) → %j', (v, expected) => {
    expect(formatValue(v)).toBe(expected)
  })

  it('renders functions as their source', () => {
    expect(formatValue(function f() {})).toBe('function f() {}')
  })

  it('truncates to exactly `max` characters with an ellipsis', () => {
    expect(formatValue('x'.repeat(10), 5)).toBe('"xxx…')
    expect(formatValue('abc', 5)).toBe('"abc"')
    expect(formatValue('abcd', 5)).toBe('"abc…')
    expect(formatValue('x'.repeat(200))).toHaveLength(80)
  })

  it('never exceeds max and keeps short values intact', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer({ min: 1, max: 120 }), (v, max) => {
        const out = formatValue(v, max)
        expect(out.length).toBeLessThanOrEqual(max)
        expect(out).toBe(truncated(JSON.stringify(v), max))
      }),
    )
  })
})

describe('prettyValue', () => {
  const cyclic: unknown[] = []
  cyclic.push(cyclic)

  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [{ a: [1] }, '{\n  "a": [\n    1\n  ]\n}'],
    ['s', '"s"'],
    [Number.NaN, 'NaN'],
    [-Infinity, '-Infinity'],
    [2n, '2'],
    [Symbol('p'), 'Symbol(p)'],
    [cyclic, ''],
  ])('prettyValue(%s) → %j', (v, expected) => {
    expect(prettyValue(v)).toBe(expected)
  })
})

describe('formatAgo', () => {
  const now = 1_000_000_000
  it.each([
    [null, 'never'],
    [now, 'just now'],
    [now - 1499, 'just now'],
    [now - 2000, '2s ago'],
    [now - 59_000, '59s ago'],
    [now - 60_000, '1m ago'],
    [now - 59 * 60_000, '59m ago'],
    [now - 60 * 60_000, '1h ago'],
    [now - 25 * 3_600_000, '25h ago'],
    // A timestamp from the future (clock skew) is not "-5s ago".
    [now + 5000, 'just now'],
  ])('formatAgo(%s) → %j', (ts, expected) => {
    expect(formatAgo(ts, now)).toBe(expected)
  })

  it('defaults `now` to the current time', () => {
    expect(formatAgo(Date.now())).toBe('just now')
  })
})
