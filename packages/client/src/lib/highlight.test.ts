import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { highlightJS, highlightSvelte } from './highlight.js'

/** The only markup the highlighter may emit. */
const TAG = /<span class="hl-[a-z]{2}">|<\/span>/g

const unescape = (s: string) =>
  s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** Text content of highlighted HTML. */
const text = (html: string) => unescape(html.replaceAll(TAG, ''))

/** `[class, text]` of each highlighted span (spans never nest). */
const spans = (html: string) =>
  [...html.matchAll(/<span class="(hl-[a-z]{2})">(.*?)<\/span>/g)].map(m => [
    m[1]!,
    unescape(m[2]!),
  ])

const cls = (html: string, c: string) =>
  spans(html)
    .filter(([k]) => k === c)
    .map(([, t]) => t)

const js = (line: string) => highlightJS([line])[0]!

describe('highlighter safety (output goes to {@html})', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '</span><script>x</script>',
    '"><svg onload=alert(1)>',
    'a && b < c > d',
    '&lt; already escaped &amp;',
    `'single' "double" \`tick\``,
    '<!-- comment --> <![CDATA[ x ]]>',
    '{@html "<b>"}',
  ]

  it.each(payloads)('escapes %j in JS and in every Svelte section', payload => {
    const outputs = [
      ...highlightJS([payload]),
      ...highlightSvelte([payload]),
      ...highlightSvelte(['<script>', payload, '</script>']),
      ...highlightSvelte(['<style>', payload, '</style>']),
    ]
    for (const html of outputs) {
      expect(html.replaceAll(TAG, '')).not.toMatch(/[<>]/)
    }
    expect(text(highlightJS([payload])[0]!)).toBe(payload)
    expect(text(highlightSvelte([payload])[0]!)).toBe(payload)
  })

  it('escapes & so entities in the source are shown literally', () => {
    expect(js('a &lt; b')).toBe('a &amp;lt; b')
  })

  // Arbitrary text, biased towards the characters the tokenizers react to.
  const special = fc.constantFrom(
    ...'<>&"\'`{}/*\\=:; \t$.()1e_-|'.split(''),
    '<script>',
    '</script>',
    '<style>',
    '</style>',
    '/*',
    '*/',
    '//',
    '${',
  )
  const line = fc
    .array(fc.oneof(special, fc.string({ unit: 'binary', maxLength: 4 })), { maxLength: 12 })
    .map(p => p.join(''))
  const lines = fc.array(line, { maxLength: 8 })

  it('property: output is input with only <span class="hl-*"> markup added (JS)', () => {
    fc.assert(
      fc.property(lines, ls => {
        const out = highlightJS(ls)
        expect(out).toHaveLength(ls.length)
        for (const [i, html] of out.entries()) {
          expect(html.replaceAll(TAG, '')).not.toMatch(/[<>]/)
          expect(text(html)).toBe(ls[i])
        }
      }),
      { numRuns: 500 },
    )
  })

  it('property: output is input with only <span class="hl-*"> markup added (Svelte)', () => {
    fc.assert(
      fc.property(lines, ls => {
        const out = highlightSvelte(ls)
        expect(out).toHaveLength(ls.length)
        for (const [i, html] of out.entries()) {
          expect(html.replaceAll(TAG, '')).not.toMatch(/[<>]/)
          expect(text(html)).toBe(ls[i])
        }
      }),
      { numRuns: 500 },
    )
  })
})

describe('highlightJS tokens', () => {
  it('classifies keywords, literals, numbers, calls, strings, comments and runes', () => {
    const html = js('const x = $state(42) + foo(true) // done')
    expect(cls(html, 'hl-kw')).toEqual(['const'])
    expect(cls(html, 'hl-sv')).toEqual(['$state'])
    expect(cls(html, 'hl-nm')).toEqual(['42'])
    expect(cls(html, 'hl-fn')).toEqual(['foo'])
    expect(cls(html, 'hl-lt')).toEqual(['true'])
    expect(cls(html, 'hl-cm')).toEqual(['// done'])
  })

  it.each([
    ['$.template(x)', 'hl-sv', '$.template'],
    ['$derived.by(f)', 'hl-sv', '$derived.by'],
    ['"a \\" b" + c', 'hl-st', '"a \\" b"'],
    ["'it''s'", 'hl-st', "'it'"],
    ['x = 1.5e3', 'hl-nm', '1.5e3'],
    ['null ?? undefined', 'hl-lt', 'null'],
  ])('%j has %s %j', (src, c, tok) => {
    expect(cls(js(src), c)).toContain(tok)
  })

  it('does not treat digits inside identifiers as numbers', () => {
    expect(cls(js('item2 = h1'), 'hl-nm')).toEqual([])
  })

  it('does not start a comment inside a string', () => {
    const html = js('const url = "http://x" // real')
    expect(cls(html, 'hl-st')).toEqual(['"http://x"'])
    expect(cls(html, 'hl-cm')).toEqual(['// real'])
  })

  it('keeps an unterminated string (or trailing backslash) to the end of the line', () => {
    expect(cls(js('"open'), 'hl-st')).toEqual(['"open'])
    expect(cls(js("'a\\"), 'hl-st')).toEqual(["'a\\"])
  })

  it('highlights block comments on one line', () => {
    const html = js('a /* note */ + b')
    expect(cls(html, 'hl-cm')).toEqual(['/* note */'])
    expect(text(html)).toBe('a /* note */ + b')
  })

  it('carries block comments across lines (JSDoc)', () => {
    const out = highlightJS(['/**', ' * @param x <b>', ' */ const y = 1'])
    expect(cls(out[0]!, 'hl-cm')).toEqual(['/**'])
    expect(cls(out[1]!, 'hl-cm')).toEqual([' * @param x <b>'])
    expect(cls(out[2]!, 'hl-cm')).toEqual([' */'])
    expect(cls(out[2]!, 'hl-kw')).toEqual(['const'])
  })

  it('carries template literals across lines, then resumes code', () => {
    const out = highlightJS(['const t = `<div>', '  ${x} \\` still', '</div>` + f(1)'])
    expect(cls(out[0]!, 'hl-st')).toEqual(['`<div>'])
    expect(cls(out[1]!, 'hl-st')).toEqual(['  ${x} \\` still'])
    expect(cls(out[2]!, 'hl-st')).toEqual(['</div>`'])
    expect(cls(out[2]!, 'hl-fn')).toEqual(['f'])
    expect(cls(out[2]!, 'hl-nm')).toEqual(['1'])
  })

  it('a // comment inside a block comment is still a comment, not a new state', () => {
    const out = highlightJS(['/* a // b', 'c */ d'])
    expect(cls(out[1]!, 'hl-cm')).toEqual(['c */'])
  })

  it('handles empty input and empty lines', () => {
    expect(highlightJS([])).toEqual([])
    expect(highlightJS([''])).toEqual([''])
  })
})

describe('highlightSvelte sections', () => {
  const src = [
    '<script lang="ts">',
    '  let count = $state(0)',
    '</script>',
    '',
    '<button onclick={() => count++} disabled class:on={count > 0}>',
    '  Clicks: {count}',
    '</button>',
    '<style>',
    '  button {',
    '    color: red;',
    '  }',
    '</style>',
  ]
  const out = highlightSvelte(src)

  it('preserves every line', () => {
    expect(out.map(text)).toEqual(src)
  })

  it('highlights tags and attributes on <script>', () => {
    expect(cls(out[0]!, 'hl-tg')).toEqual(['<script', '>'])
    expect(cls(out[0]!, 'hl-at')).toEqual(['lang'])
    expect(cls(out[0]!, 'hl-st')).toEqual(['"ts"'])
  })

  it('highlights the script body as JS', () => {
    expect(cls(out[1]!, 'hl-kw')).toEqual(['let'])
    expect(cls(out[1]!, 'hl-sv')).toEqual(['$state'])
  })

  it('highlights markup: attributes, expressions and directives', () => {
    expect(cls(out[4]!, 'hl-at')).toEqual(['onclick', 'disabled', 'class:on'])
    expect(cls(out[4]!, 'hl-ex')[0]).toBe('{() => count++}')
    expect(cls(out[5]!, 'hl-ex')).toEqual(['{count}'])
    expect(cls(out[6]!, 'hl-tg')).toEqual(['</button', '>'])
  })

  it('highlights CSS selectors, properties and values in <style>', () => {
    expect(cls(out[8]!, 'hl-cs')).toEqual(['button'])
    expect(cls(out[9]!, 'hl-cp')).toEqual(['color'])
    expect(cls(out[9]!, 'hl-cv')).toEqual(['red'])
  })

  it('returns to markup after </script> and </style>', () => {
    const after = highlightSvelte([
      '<script>',
      'let a',
      '</script>',
      'let a',
      '<style>',
      'a { }',
      '</style>',
      'color: red',
    ])
    expect(cls(after[3]!, 'hl-kw')).toEqual([])
    expect(cls(after[7]!, 'hl-cp')).toEqual([])
  })

  it('a one-line <script>…</script> does not open a script section', () => {
    const o = highlightSvelte(['<script>let a</script>', 'let b'])
    expect(cls(o[1]!, 'hl-kw')).toEqual([])
    const s = highlightSvelte(['<style>a{}</style>', 'color: red'])
    expect(cls(s[1]!, 'hl-cp')).toEqual([])
  })

  it('an unterminated block comment does not leak out of its <script>', () => {
    const o = highlightSvelte([
      '<script>',
      '/* open',
      '</script>',
      '<script>',
      'let x',
      '</script>',
    ])
    expect(cls(o[4]!, 'hl-kw')).toEqual(['let'])
  })

  it('handles unquoted / unterminated attribute values and stray braces', () => {
    for (const l of [
      '<a href=x>',
      '<a title="open>',
      '<a on:x={a {b}>',
      '{unclosed',
      '}',
      '<>',
      '< not a tag',
      '<!-- c -->',
    ]) {
      expect(text(highlightSvelte([l])[0]!)).toBe(l)
    }
    expect(cls(highlightSvelte(['<a title="x">'])[0]!, 'hl-st')).toEqual(['"x"'])
    expect(cls(highlightSvelte(["<a title='x'>"])[0]!, 'hl-st')).toEqual(["'x'"])
    expect(cls(highlightSvelte(['<a {...rest} />'])[0]!, 'hl-tg')).toEqual(['<a', '/', '>'])
  })

  it('a selector with a pseudo-class is a selector, not a declaration', () => {
    const o = highlightSvelte(['<style>', '  button:focus-visible {', '  a:hover{ ', '</style>'])
    expect(cls(o[1]!, 'hl-cs')).toEqual(['button:focus-visible'])
    expect(cls(o[1]!, 'hl-cp')).toEqual([])
    expect(cls(o[2]!, 'hl-cs')).toEqual(['a:hover'])
    expect(text(o[2]!)).toBe('  a:hover{ ')
  })

  it('declarations keep their `;` and spacing outside the value', () => {
    const o = highlightSvelte(['<style>', '  margin : 0 auto;  ', '  color:;', '</style>'])
    expect(cls(o[1]!, 'hl-cp')).toEqual(['margin'])
    expect(cls(o[1]!, 'hl-cv')).toEqual(['0 auto'])
    expect(text(o[1]!)).toBe('  margin : 0 auto;  ')
    expect(cls(o[2]!, 'hl-cv')).toEqual([';'])
  })

  it('CSS lines that are neither rule nor declaration are kept plain', () => {
    const o = highlightSvelte(['<style>', '  }', '  @media (x) {', '</style>'])
    expect(o[1]).toBe('  }')
    expect(cls(o[2]!, 'hl-cs')).toEqual(['@media (x)'])
  })
})
