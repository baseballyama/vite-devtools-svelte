import { parseSync, Visitor } from 'vite';
import type { ESTree } from 'vite';

import { RUNTIME_MODULE_ID } from './ids.js';

const PUSH_CALL = '$.push($$props';

// The same text can sit in a string or template literal (`<pre>$.push($$props)</pre>`
// in markup is hoisted as a template string, and a line of it may start with
// the call), so the text is trusted only when it occurs once; otherwise parse.
function componentPushOffset(code: string): number {
  const at = code.indexOf(PUSH_CALL);
  if (at === -1) return -1;
  if (!code.includes(PUSH_CALL, at + PUSH_CALL.length)) {
    const next = code[at + PUSH_CALL.length];
    return atLineStart(code, at) && (next === ',' || next === ')') ? at : -1;
  }
  return parsedPushOffset(code);
}

function atLineStart(code: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && (code[i] === ' ' || code[i] === '\t')) i--;
  return i === -1 || code[i] === '\n';
}

function parsedPushOffset(code: string): number {
  const { program, errors } = parseSync('component.js', code);
  if (errors.length > 0) return -1;
  let first = -1;
  new Visitor({
    ExpressionStatement(node) {
      if (isComponentPush(node.expression) && (first === -1 || node.start < first)) {
        first = node.start;
      }
    },
  }).visit(program);
  return first;
}

function isIdentifier(node: ESTree.Node | undefined, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name;
}

function isComponentPush(call: ESTree.Expression): boolean {
  return (
    call.type === 'CallExpression' &&
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    isIdentifier(call.callee.object, '$') &&
    isIdentifier(call.callee.property, 'push') &&
    isIdentifier(call.arguments[0], '$$props')
  );
}

// Nothing is inserted as a new line, so the caller can return `map: null`:
// stack traces and the compiler's sourcemap stay aligned.
export function injectComponentTracking(code: string, id: string): string | null {
  const at = componentPushOffset(code);
  if (at === -1) return null;
  // Spliced by index, not via `String#replace`: a replacement string would
  // expand `$&`, `$'`, `$1`… sequences that are legal in file paths.
  const hint = `if (typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__) { window.__SVELTE_DEVTOOLS__._pendingFile = ${JSON.stringify(id)}; } `;
  return `import '${RUNTIME_MODULE_ID}';` + code.slice(0, at) + hint + code.slice(at);
}

const SVELTE_MODULE_SUFFIXES = ['js', 'ts', 'mjs', 'mts', 'cjs', 'cts'].map(
  ext => `.svelte.${ext}`,
);

/** `file` must have no query. */
export function isSvelteModule(file: string): boolean {
  return SVELTE_MODULE_SUFFIXES.some(suffix => file.endsWith(suffix));
}

// The bracket is plain JS so it works before or after vite-plugin-svelte
// compiles the module (with `svelteDevtools()` before `sveltekit()`, a
// `.svelte.ts` module is compiled after this transform).
export function injectModuleTracking(code: string, id: string): string | null {
  if (code.includes('svelte/internal/server')) return null;
  const safeId = JSON.stringify(id);
  const dt = `(typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__)`;
  return (
    `import '${RUNTIME_MODULE_ID}';if (${dt}) { window.__SVELTE_DEVTOOLS__._enterModule(${safeId}); }` +
    code +
    `\n;if (${dt}) { window.__SVELTE_DEVTOOLS__._leaveModule(); }\n`
  );
}
