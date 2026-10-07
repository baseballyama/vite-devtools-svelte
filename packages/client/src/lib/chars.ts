/**
 * Character classes for the hand-written scanners (highlighter, search,
 * hash parsing). Each takes one character, or `undefined` past the end.
 */

/**
 * Same set as a regex `\s`. The ASCII ones are space and `\t`–`\r`; past
 * ASCII, `trim()` strips exactly the rest (NBSP, BOM, U+2000…).
 */
export const isSpace = (c: string | undefined) =>
  c !== undefined && (c <= ' ' ? c === ' ' || (c >= '\t' && c <= '\r') : c > '~' && c.trim() === '')

/** ASCII `0`–`9` (a regex `\d`). */
export const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9'

/** ASCII letter or `_` (`\w` minus the digits). */
const isAlpha = (c: string | undefined) =>
  !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_')

/** ASCII letter, digit or `_` (a regex `\w`). */
export const isWord = (c: string | undefined) => isAlpha(c) || isDigit(c)

/** First character of a JS identifier (ASCII only). */
export const isIdentStart = (c: string | undefined) => isAlpha(c) || c === '$'

/** Index of the first character at or after `from` that fails `test`. */
export function skip(s: string, from: number, test: (c: string | undefined) => boolean): number {
  let i = from
  while (i < s.length && test(s[i])) i++
  return i
}

/** Non-empty whitespace-separated words of `s`. */
export function words(s: string): string[] {
  const out: string[] = []
  let start = -1
  for (let i = 0; i < s.length; i++) {
    if (!isSpace(s[i])) {
      if (start === -1) start = i
    } else if (start !== -1) {
      out.push(s.slice(start, i))
      start = -1
    }
  }
  if (start !== -1) out.push(s.slice(start))
  return out
}

/** `s` is one or more ASCII digits. */
export const isDigits = (s: string) => s.length > 0 && skip(s, 0, isDigit) === s.length

/** Every ASCII digit of `s`, in order (`'12 34'` → `'1234'`). */
export function digitsOf(s: string): string {
  let out = ''
  for (const c of s) if (isDigit(c)) out += c
  return out
}

/** The leading ASCII digits of `s` (possibly empty). */
export const leadingDigits = (s: string) => s.slice(0, skip(s, 0, isDigit))
