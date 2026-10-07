// Transforms that hook compiled Svelte modules up to the runtime.
import { RUNTIME_MODULE_ID } from './ids.js'

/**
 * Component-tracking transform for one compiled client `.svelte` module:
 * imports the runtime and names the file for the wrapper's next `push()`.
 * `null` when the module has no component (`$.push(`) to track.
 *
 * Nothing is inserted as a new line, so every original line keeps its
 * number (`map: null` = mappings unchanged; stack traces and the
 * compiler's sourcemap stay aligned).
 */
export function injectComponentTracking(code: string, id: string): string | null {
  if (!code.includes('$.push(')) return null
  const safeId = JSON.stringify(id)
  return (
    `import '${RUNTIME_MODULE_ID}';` +
    code.replace(
      /(\$\.push\([^)]+\);?)/,
      `if (typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__) { window.__SVELTE_DEVTOOLS__._pendingFile = ${safeId}; } $1`,
    )
  )
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
