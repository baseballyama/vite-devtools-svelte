import path from 'node:path'

import type { Plugin } from 'vite'

import type { CompilerWarning } from '../types.js'

/** The fields of a Svelte compiler `Warning` we read. */
interface SvelteWarning {
  code: string
  message: string
  filename?: string
  start?: { line: number; column: number }
}

type OnWarn = (warning: SvelteWarning, defaultHandler: (warning: SvelteWarning) => void) => void

/**
 * vite-plugin-svelte's resolved options: one object its sub-plugins share as
 * `api.options` and read `onwarn` from on every compile.
 */
function svelteOptions(plugins: readonly Plugin[]): { onwarn?: OnWarn } | undefined {
  for (const p of plugins) {
    if (!p.name.startsWith('vite-plugin-svelte')) continue
    const options = (p.api as { options?: unknown } | undefined)?.options
    if (typeof options === 'object' && options !== null) return options
  }
  return undefined
}

/**
 * Report every Svelte compiler warning of the app to `record`, as the
 * compiler's structured warning (vite-plugin-svelte prints dev warnings with
 * `console.log`, past Vite's logger). The user's `onwarn` (or the default
 * handler) still runs, so console output is unchanged. Dependencies'
 * warnings are skipped, as vite-plugin-svelte does in dev.
 *
 * Must run after vite-plugin-svelte's own `configResolved`, which creates
 * the options (a restart creates new ones, so wrappers never stack).
 */
export function captureCompilerWarnings(
  plugins: readonly Plugin[],
  record: (warning: CompilerWarning) => void,
): void {
  const options = svelteOptions(plugins)
  if (!options) return
  const userOnwarn = options.onwarn
  options.onwarn = (warning, defaultHandler) => {
    if (!warning.filename?.includes('node_modules')) {
      record({
        code: warning.code,
        message: warning.message,
        // Relative to the cwd the compiler ran in.
        file: warning.filename ? path.resolve(warning.filename) : '',
        line: warning.start?.line,
        column: warning.start?.column,
      })
    }
    if (userOnwarn) userOnwarn(warning, defaultHandler)
    else defaultHandler(warning)
  }
}
