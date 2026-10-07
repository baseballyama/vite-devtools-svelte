/** Case-insensitive substring matcher shared by every search field. */
export function matcher(
  query: string,
): ((...fields: (string | undefined | null)[]) => boolean) | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const terms = q.split(/\s+/)
  return (...fields) => {
    const hay = fields.filter(Boolean).join('\n').toLowerCase()
    return terms.every(t => hay.includes(t))
  }
}

/**
 * Same matching as {@link matcher}, for callers that precompute one
 * lowercase haystack per item (fields joined with '\n') so a keystroke
 * costs only `includes` per item.
 */
export function haystackMatcher(query: string): ((hay: string) => boolean) | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const terms = q.split(/\s+/)
  return hay => terms.every(t => hay.includes(t))
}

/** Lowercase haystack for {@link haystackMatcher}; empty fields are skipped like in {@link matcher}. */
export function haystack(...fields: (string | undefined | null)[]): string {
  return fields.filter(Boolean).join('\n').toLowerCase()
}

/** Split `text` into plain / highlighted segments for `<Highlight>`. */
export function highlightParts(text: string, query: string): { t: string; m: boolean }[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0 || !text) return [{ t: text, m: false }]
  // Offsets in `lower` must be offsets in `text`. A few characters lowercase
  // to more code units ('İ' → 'i̇'), which would shift every later mark; then
  // lowercase per code unit, keeping the ones that would change length.
  let lower = text.toLowerCase()
  if (lower.length !== text.length) {
    lower = Array.from({ length: text.length }, (_, i) => {
      const c = text.charAt(i)
      const l = c.toLowerCase()
      return l.length === 1 ? l : c
    }).join('')
  }
  const marks = new Uint8Array(text.length)
  for (const term of terms) {
    let i = lower.indexOf(term)
    while (i !== -1) {
      marks.fill(1, i, i + term.length)
      i = lower.indexOf(term, i + term.length)
    }
  }
  const parts: { t: string; m: boolean }[] = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      parts.push({ t: text.slice(start, i), m: marks[start] === 1 })
      start = i
    }
  }
  return parts
}
