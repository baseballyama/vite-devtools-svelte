// Transforms that hook compiled Svelte modules up to the runtime.
import { parseSync, Visitor } from 'vite'
import type { ESTree } from 'vite'

import { RUNTIME_MODULE_ID } from './ids.js'

const PUSH_CALL = '$.push($$props'

/**
 * Source offset of the component's own `$.push($$props, …)` statement, or -1.
 * The compiler emits it as a statement at the start of a line. The same text
 * can also be in a string or template literal (`<pre>$.push($$props)</pre>`
 * in the markup is hoisted above the component as a template string, and a
 * line of it may start with the call). So the text is trusted only when it
 * occurs once in the module; otherwise the program is parsed and the first
 * real call statement wins (-1 when the module does not parse).
 */
function componentPushOffset(code: string): number {
  const at = code.indexOf(PUSH_CALL)
  if (at === -1) return -1
  if (!code.includes(PUSH_CALL, at + PUSH_CALL.length)) {
    const next = code[at + PUSH_CALL.length]
    return atLineStart(code, at) && (next === ',' || next === ')') ? at : -1
  }
  return parsedPushOffset(code)
}

// Only spaces / tabs between the previous line break (or the start) and `at`.
function atLineStart(code: string, at: number): boolean {
  let i = at - 1
  while (i >= 0 && (code[i] === ' ' || code[i] === '\t')) i--
  return i === -1 || code[i] === '\n'
}

function parsedPushOffset(code: string): number {
  const { program, errors } = parseSync('component.js', code)
  if (errors.length > 0) return -1
  let first = -1
  new Visitor({
    ExpressionStatement(node) {
      if (isComponentPush(node.expression) && (first === -1 || node.start < first)) {
        first = node.start
      }
    },
  }).visit(program)
  return first
}

function isIdentifier(node: ESTree.Node | undefined, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name
}

// `$.push($$props, …)`
function isComponentPush(call: ESTree.Expression): boolean {
  return (
    call.type === 'CallExpression' &&
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    isIdentifier(call.callee.object, '$') &&
    isIdentifier(call.callee.property, 'push') &&
    isIdentifier(call.arguments[0], '$$props')
  )
}

/**
 * Component-tracking transform for one compiled client `.svelte` module:
 * imports the runtime and names the file for the wrapper's next `push()`.
 * `null` when the module has no component (`$.push($$props`) to track.
 *
 * Nothing is inserted as a new line, so every original line keeps its
 * number (`map: null` = mappings unchanged; stack traces and the
 * compiler's sourcemap stay aligned).
 */
export function injectComponentTracking(code: string, id: string): string | null {
  const at = componentPushOffset(code)
  if (at === -1) return null
  // Spliced by index, not via `String#replace`: a replacement string would
  // expand `$&`, `$'`, `$1`… sequences that are legal in file paths.
  const hint = `if (typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__) { window.__SVELTE_DEVTOOLS__._pendingFile = ${JSON.stringify(id)}; } `
  return `import '${RUNTIME_MODULE_ID}';` + code.slice(0, at) + hint + code.slice(at)
}

/** A Svelte module (`.svelte.js` / `.svelte.ts`, runes outside components). */
export const SVELTE_MODULE_RE = /\.svelte\.[cm]?[jt]s$/

/**
 * Module-scope transform for one client Svelte module: signals created while
 * its body runs (shared state, `export const cart = $state(...)`) are tracked
 * under a scope named after the file. The body is bracketed by enter/leave
 * calls; nothing is inserted as a new line. The bracket is plain JS, so it
 * works before or after vite-plugin-svelte compiles the module (with
 * `svelteDevtools()` listed before `sveltekit()`, a `.svelte.ts` module is
 * compiled after this transform). `null` for a server-compiled module.
 */
export function injectModuleTracking(code: string, id: string): string | null {
  if (code.includes('svelte/internal/server')) return null
  const safeId = JSON.stringify(id)
  const dt = `(typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__)`
  return (
    `import '${RUNTIME_MODULE_ID}';if (${dt}) { window.__SVELTE_DEVTOOLS__._enterModule(${safeId}); }` +
    code +
    `\n;if (${dt}) { window.__SVELTE_DEVTOOLS__._leaveModule(); }\n`
  )
}
