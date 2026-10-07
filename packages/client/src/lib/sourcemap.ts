/**
 * Minimal Source Map v3 `mappings` decoder that keeps line-level links only
 * (the Compiled output panel highlights whole lines). Lines are 1-based.
 */
const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const charToInt = new Map<string, number>()
for (let i = 0; i < VLQ_CHARS.length; i++) charToInt.set(VLQ_CHARS[i], i)

function decodeVLQ(encoded: string): number[] {
  const out: number[] = []
  let shift = 0
  let value = 0
  for (const c of encoded) {
    const digit = charToInt.get(c)
    if (digit === undefined) continue
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
    } else {
      out.push(value & 1 ? -(value >> 1) : value >> 1)
      value = 0
      shift = 0
    }
  }
  return out
}

export interface LineMaps {
  compiledToSource: Map<number, Set<number>>
  sourceToCompiled: Map<number, Set<number>>
}

export function parseLineMappings(mappings: string): LineMaps {
  const c2s = new Map<number, Set<number>>()
  const s2c = new Map<number, Set<number>>()
  let sl = 0
  const lines = mappings.split(';')
  for (let gl = 0; gl < lines.length; gl++) {
    const line = lines[gl]
    if (!line) continue
    for (const seg of line.split(',')) {
      const d = decodeVLQ(seg)
      if (d.length < 4) continue
      sl += d[2]
      const g = gl + 1
      const s = sl + 1
      ;(c2s.get(g) ?? c2s.set(g, new Set()).get(g)!).add(s)
      ;(s2c.get(s) ?? s2c.set(s, new Set()).get(s)!).add(g)
    }
  }
  return { compiledToSource: c2s, sourceToCompiled: s2c }
}
