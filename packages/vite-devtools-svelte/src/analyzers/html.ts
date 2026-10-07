import { DIGITS, HEX_DIGITS, consistsOf } from './text.js'

export interface HtmlTag {
  /** Lowercase tag name. */
  name: string
  closing: boolean
  selfClosing: boolean
  /** Lowercase attribute names; the first of repeated attributes wins. Values are not decoded. */
  attrs: Map<string, string>
  /** The raw text content of `<script>`, `<style>`, `<title>`, … */
  text?: string
}

/** ASCII whitespace as HTML defines it. */
export const HTML_WHITESPACE = new Set([' ', '\t', '\n', '\f', '\r'])

/** Elements whose content is text up to their end tag, never markup. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
])

const isAsciiLetter = (ch: string | undefined) =>
  ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'))

/**
 * The start and end tags of an HTML document in order, following the HTML
 * tokenizer where it matters for reading `<meta>` and `<title>`: comments,
 * doctypes and the content of raw text elements (a `<meta>` inside a
 * `<script>` string) are no tags, attribute values may hold `>`, and
 * names are case-insensitive. Truncated input ends the scan.
 */
export function* htmlTags(html: string): Generator<HtmlTag> {
  let i = 0
  while ((i = html.indexOf('<', i)) !== -1) {
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      if (close === -1) return
      i = close + 3
      continue
    }
    const closing = html[i + 1] === '/'
    const nameStart = i + (closing ? 2 : 1)
    if (!isAsciiLetter(html[nameStart])) {
      // `<!doctype …>`, `<?…>`, `</ >`: skipped up to `>`; a lone `<` is text
      if (html[i + 1] === '!' || html[i + 1] === '?' || closing) {
        const close = html.indexOf('>', i)
        if (close === -1) return
        i = close + 1
      } else {
        i++
      }
      continue
    }
    let at = nameStart
    while (
      at < html.length &&
      !HTML_WHITESPACE.has(html[at]!) &&
      html[at] !== '/' &&
      html[at] !== '>'
    ) {
      at++
    }
    const tag: HtmlTag = {
      name: html.slice(nameStart, at).toLowerCase(),
      closing,
      selfClosing: false,
      attrs: new Map(),
    }
    at = readAttributes(html, at, tag)
    if (at === -1) return
    if (!closing && !tag.selfClosing && RAW_TEXT.has(tag.name)) {
      const end = indexOfEndTag(html, tag.name, at)
      tag.text = html.slice(at, end === -1 ? html.length : end)
      yield tag
      if (end === -1) return
      i = end
      continue
    }
    yield tag
    i = at
  }
}

/** Read the attributes of the tag whose name ends at `at`; the offset past its `>`, or -1. */
function readAttributes(html: string, from: number, tag: HtmlTag): number {
  let at = from
  for (;;) {
    while (HTML_WHITESPACE.has(html[at]!) || html[at] === '/') {
      tag.selfClosing = html[at] === '/'
      at++
    }
    if (at >= html.length) return -1
    if (html[at] === '>') return at + 1
    tag.selfClosing = false
    const nameStart = at
    at++ // a name may start with `=`
    while (
      at < html.length &&
      !HTML_WHITESPACE.has(html[at]!) &&
      html[at] !== '/' &&
      html[at] !== '>' &&
      html[at] !== '='
    ) {
      at++
    }
    const name = html.slice(nameStart, at).toLowerCase()
    let value = ''
    let next = skipWhitespace(html, at)
    if (html[next] === '=') {
      next = skipWhitespace(html, next + 1)
      const quote = html[next]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, next + 1)
        if (close === -1) return -1
        value = html.slice(next + 1, close)
        at = close + 1
      } else {
        at = next
        while (at < html.length && !HTML_WHITESPACE.has(html[at]!) && html[at] !== '>') at++
        value = html.slice(next, at)
      }
    }
    if (!tag.attrs.has(name)) tag.attrs.set(name, value)
  }
}

function skipWhitespace(html: string, from: number): number {
  let at = from
  while (HTML_WHITESPACE.has(html[at]!)) at++
  return at
}

/** Offset of the `</name` that ends a raw text element (case-insensitive), or -1. */
function indexOfEndTag(html: string, name: string, from: number): number {
  for (let at = html.indexOf('</', from); at !== -1; at = html.indexOf('</', at + 2)) {
    const after = html[at + 2 + name.length]
    if (
      html.slice(at + 2, at + 2 + name.length).toLowerCase() === name &&
      (after === undefined || after === '>' || after === '/' || HTML_WHITESPACE.has(after))
    ) {
      return at
    }
  }
  return -1
}

const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
])

/** Decode the character references that show up in attribute values and titles. */
export function decodeEntities(s: string): string {
  let out = ''
  let i = 0 // start of the text not yet copied to `out`
  let amp = s.indexOf('&')
  while (amp !== -1) {
    const semi = s.indexOf(';', amp + 1)
    if (semi === -1) break
    const char = decodeReference(s.slice(amp + 1, semi))
    if (char !== undefined) {
      out += s.slice(i, amp) + char
      i = semi + 1
    }
    amp = s.indexOf('&', char === undefined ? amp + 1 : i)
  }
  return out + s.slice(i)
}

/** The character of `&ref;`: `amp`, `#38`, `#x26`, … (undefined when unknown). */
function decodeReference(ref: string): string | undefined {
  if (!ref.startsWith('#')) return NAMED_ENTITIES.get(ref.toLowerCase())
  const hex = ref[1] === 'x' || ref[1] === 'X'
  const digits = ref.slice(hex ? 2 : 1)
  if (!consistsOf(digits, hex ? HEX_DIGITS : DIGITS)) return undefined
  const code = hex ? Number.parseInt(digits, 16) : Number(digits)
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined
}

/** `s` with ASCII whitespace runs collapsed to one space and trimmed. */
export function collapseWhitespace(s: string): string {
  let out = ''
  let space = false
  for (const ch of s) {
    if (HTML_WHITESPACE.has(ch)) {
      space = out !== ''
      continue
    }
    if (space) out += ' '
    space = false
    out += ch
  }
  return out
}
