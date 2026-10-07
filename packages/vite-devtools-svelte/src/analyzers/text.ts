export const DIGITS = '0123456789'
export const HEX_DIGITS = `${DIGITS}abcdefABCDEF`
/** The characters of a regex `\w`. */
export const WORD_CHARS = `${HEX_DIGITS}ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ_`

/** Whether `s` is non-empty and made only of `chars`. */
export function consistsOf(s: string, chars: string): boolean {
  if (s === '') return false
  for (const ch of s) if (!chars.includes(ch)) return false
  return true
}
