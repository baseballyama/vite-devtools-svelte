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
  if (!name) return 0 // an empty name matched every declaration
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Identifier end: `(?![\w$])`, as `\b` fails after a trailing `$` (`let a$`).
  const regex = new RegExp(`\\b(?:let|const|var)\\s+${escaped}(?![\\w$])`)
  const idx = lines.findIndex(l => regex.test(l))
  return idx + 1
}
