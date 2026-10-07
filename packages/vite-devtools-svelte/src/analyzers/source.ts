import { parseScripts, walk } from './script.js'
import type { AstNode } from './script.js'

/** Where a source declares things, as offsets into it. */
interface ReactiveIndex {
  /** First declaration of each binding name and `Class.field` / `Class.#field`. */
  declared: Map<string, number>
  /** `$effect(…)` (`effect`) and `$effect.pre(…)` (`effect_pre`) calls, in source order. */
  effects: Map<string, number[]>
  /** Calls of either kind, in source order. */
  allEffects: number[]
}

/** The last source indexed: jumping to several signals of one file parses it once. */
let last: { source: string; index: ReactiveIndex } | undefined

/**
 * Find the 1-based line of a reactive declaration in a component (its
 * `<script>` blocks) or a `.svelte.js` / `.svelte.ts` module, from the parsed
 * code, so comments, strings and look-alike names never match. Effects: the
 * runtime names them `effect_N` / `effect_pre_N`, the N-th `$effect(…)` /
 * `$effect.pre(…)` call; any other effect name is the first call of either
 * kind. Otherwise `name` is a variable binding (destructuring included) or a
 * `Class.field` / `Class.#field` class field (Svelte's label for `$state`
 * fields). Returns 0 when not found or when the code does not parse.
 */
export function findReactiveLine(source: string, name: string, type: string): number {
  const effect = type === 'effect'
  // Nothing to find unless the source spells the name (a field's without its class).
  const spelled = effect ? '$effect' : name.slice(name.lastIndexOf('.') + 1)
  if (!spelled || !source.includes(spelled)) return 0
  if (last?.source !== source) last = { source, index: indexSource(source) }
  const { declared, effects, allEffects } = last.index
  const at = effect ? (nthEffect(effects, name) ?? allEffects[0]) : declared.get(name)
  return at === undefined ? 0 : lineAt(source, at)
}

/** The offset of the effect the runtime names `effect_N` / `effect_pre_N`. */
function nthEffect(effects: Map<string, number[]>, name: string): number | undefined {
  const separator = name.lastIndexOf('_')
  const n = Number(name.slice(separator + 1))
  if (!Number.isInteger(n) || n < 1) return undefined
  return effects.get(name.slice(0, separator))?.[n - 1]
}

function lineAt(source: string, offset: number): number {
  let line = 1
  for (let i = source.indexOf('\n'); i !== -1 && i < offset; i = source.indexOf('\n', i + 1)) {
    line++
  }
  return line
}

function indexSource(source: string): ReactiveIndex {
  const index: ReactiveIndex = {
    declared: new Map(),
    effects: new Map([
      ['effect', []],
      ['effect_pre', []],
    ]),
    allEffects: [],
  }
  const declare = (name: string, at: number) => {
    if (!index.declared.has(name)) index.declared.set(name, at)
  }
  for (const { offset, result } of parseScripts(source)) {
    walk(result.program, (node, className) => {
      if (node.type === 'VariableDeclarator') {
        forEachBinding(node.id as AstNode, id => declare(id.name as string, offset + id.start))
      } else if (node.type === 'PropertyDefinition' && className !== undefined && !node.computed) {
        const key = node.key as AstNode
        const field = key.type === 'PrivateIdentifier' ? `#${key.name as string}` : key.name
        if (typeof field === 'string') declare(`${className}.${field}`, offset + node.start)
      } else {
        const kind = effectKind(node)
        if (kind) {
          index.effects.get(kind)!.push(offset + node.start)
          index.allEffects.push(offset + node.start)
        }
      }
    })
  }
  return index
}

/** `effect` for `$effect(…)`, `effect_pre` for `$effect.pre(…)`. */
function effectKind(node: AstNode): string | undefined {
  if (node.type !== 'CallExpression') return undefined
  const callee = node.callee as AstNode
  if (isIdentifier(callee, '$effect')) return 'effect'
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    isIdentifier(callee.object, '$effect') &&
    isIdentifier(callee.property, 'pre')
  ) {
    return 'effect_pre'
  }
  return undefined
}

/** Each identifier the binding pattern `id` (`a`, `{ a, b: [c = 1, ...d] }`, …) declares. */
function forEachBinding(id: AstNode | null, visit: (identifier: AstNode) => void): void {
  if (!id) return // an array pattern hole
  switch (id.type) {
    case 'Identifier':
      visit(id)
      break
    case 'ObjectPattern':
      for (const p of id.properties as AstNode[]) {
        forEachBinding((p.type === 'RestElement' ? p.argument : p.value) as AstNode, visit)
      }
      break
    case 'ArrayPattern':
      for (const e of id.elements as Array<AstNode | null>) forEachBinding(e, visit)
      break
    case 'AssignmentPattern':
      forEachBinding(id.left as AstNode, visit)
      break
    case 'RestElement':
      forEachBinding(id.argument as AstNode, visit)
      break
  }
}

function isIdentifier(node: unknown, name: string): boolean {
  return (node as AstNode).type === 'Identifier' && (node as AstNode).name === name
}
