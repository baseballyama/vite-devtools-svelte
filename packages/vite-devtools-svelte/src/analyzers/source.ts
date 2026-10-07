/**
 * Find the 1-based line of a reactive declaration in a component source:
 * the first `$effect(` / `$effect.pre(` for effects, otherwise the
 * `let|const|var <name>` declaration. Returns 0 when not found.
 */
export function findReactiveLine(source: string, name: string, type: string): number {
  const lines = source.split('\n')
  if (type === 'effect') {
    const idx = lines.findIndex(l => l.includes('$effect(') || l.includes('$effect.pre('))
    return idx + 1
  }
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(?:let|const|var)\\s+${escaped}\\b`)
  const idx = lines.findIndex(l => regex.test(l))
  return idx + 1
}
