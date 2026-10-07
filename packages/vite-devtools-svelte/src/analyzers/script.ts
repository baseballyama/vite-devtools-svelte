import { parseSync } from 'vite'

/** An ESTree node of the oxc AST, read structurally. */
export interface AstNode {
  type: string
  start: number
  [key: string]: unknown
}

export interface ParsedScript {
  /** Where `code` starts in the file. */
  offset: number
  code: string
  /**
   * The parser's result. Its `program` (the AST, as an `AstNode`) is built
   * on first access, which costs several times the parse: read `module` (the
   * import / export summary) when that is enough.
   */
  result: ReturnType<typeof parseSync>
}

/**
 * The parsed `<script>` blocks of a component, each with the offset of its
 * code in the file (HTML comments skipped), or the whole source when there is
 * none (a JS / TS module). Blocks that do not parse are left out.
 */
export function parseScripts(source: string): ParsedScript[] {
  const parsed: ParsedScript[] = []
  for (const { offset, code } of scriptBlocks(source)) {
    // TypeScript is a superset of the JS a script may hold.
    const result = parseSync('script.ts', code)
    if (result.errors.length === 0) parsed.push({ offset, code, result })
  }
  return parsed
}

/** Visit every node in source order, with the name of the class it lies in. */
export function walk(
  value: unknown,
  visit: (node: AstNode, className: string | undefined) => void,
  className?: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, className)
    return
  }
  if (typeof value !== 'object' || value === null || !('type' in value)) return
  const node = value as AstNode
  visit(node, className)
  const inner =
    node.type === 'ClassDeclaration' || node.type === 'ClassExpression'
      ? ((node.id as AstNode | null)?.name as string | undefined)
      : className
  for (const key in node) {
    const child = node[key]
    if (typeof child === 'object' && child !== null) walk(child, visit, inner)
  }
}

const TAG_NAME_END = new Set(['>', '/', ' ', '\t', '\n', '\r', '\f'])

function scriptBlocks(source: string): Array<{ offset: number; code: string }> {
  const blocks: Array<{ offset: number; code: string }> = []
  let i = source.indexOf('<')
  while (i !== -1) {
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4)
      if (close === -1) break
      i = source.indexOf('<', close + 3)
      continue
    }
    if (source.startsWith('<script', i) && TAG_NAME_END.has(source[i + 7] ?? '')) {
      const open = startTagEnd(source, i + 7)
      const close = open === -1 ? -1 : source.indexOf('</script', open)
      if (close === -1) break
      blocks.push({ offset: open, code: source.slice(open, close) })
      i = source.indexOf('<', close + 1)
      continue
    }
    i = source.indexOf('<', i + 1)
  }
  return blocks.length > 0 ? blocks : [{ offset: 0, code: source }]
}

/** Offset just past the `>` ending a start tag (`>` may sit in a quoted value), or -1. */
function startTagEnd(source: string, from: number): number {
  let quote = ''
  for (let i = from; i < source.length; i++) {
    const ch = source[i]!
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i + 1
    }
  }
  return -1
}
