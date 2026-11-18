/**
 * Same set as a regex `\s`. The ASCII ones are space and `\t`–`\r`; past
 * ASCII, `trim()` strips exactly the rest (NBSP, BOM, U+2000…).
 */
export const isSpace = (c: string | undefined) =>
  c !== undefined &&
  (c <= ' ' ? c === ' ' || (c >= '\t' && c <= '\r') : c > '~' && c.trim() === '');

export const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';

const isAlpha = (c: string | undefined) =>
  !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');

export const isWord = (c: string | undefined) => isAlpha(c) || isDigit(c);

/** First character of a JS identifier (ASCII only). */
export const isIdentStart = (c: string | undefined) => isAlpha(c) || c === '$';

/** Index of the first character at or after `from` that fails `test`. */
export function skip(s: string, from: number, test: (c: string | undefined) => boolean): number {
  let i = from;
  while (i < s.length && test(s[i])) i++;
  return i;
}

export function words(s: string): string[] {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (!isSpace(s[i])) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      out.push(s.slice(start, i));
      start = -1;
    }
  }
  if (start !== -1) out.push(s.slice(start));
  return out;
}

export const isDigits = (s: string) => s.length > 0 && skip(s, 0, isDigit) === s.length;

export function digitsOf(s: string): string {
  let out = '';
  for (const c of s) if (isDigit(c)) out += c;
  return out;
}

export const leadingDigits = (s: string) => s.slice(0, skip(s, 0, isDigit));
