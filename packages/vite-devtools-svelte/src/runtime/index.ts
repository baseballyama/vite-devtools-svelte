// Browser code the plugin serves as virtual modules. The sources are plain
// JavaScript files next to this one (linted and formatted like any other
// source) and are inlined as strings at build time.
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import runtimeSource from './client.js?raw'
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import promptFormatSource from './prompt-format.js?raw'
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import promptToolbarSource from './prompt-toolbar.js?raw'
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import wrapperToolbarSource from './wrapper-toolbar.js?raw'
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import wrapperSource from './wrapper.js?raw'

export {
  PROMPT_FORMAT_MODULE_ID,
  PROMPT_TOOLBAR_MODULE_ID,
  RESOLVED_PROMPT_FORMAT_ID,
  RESOLVED_PROMPT_TOOLBAR_ID,
  RESOLVED_RUNTIME_ID,
  RUNTIME_MODULE_ID,
  WRAPPER_MODULE_ID,
} from './ids.js'

/**
 * Wrapper code for svelte/internal/client (`./wrapper.js`).
 *
 * Re-exports everything from the real module, then overrides:
 * - push/pop: component lifecycle tracking
 * - tag/tag_proxy: named signal/proxy tracking (Svelte dev mode)
 * - state/derived/proxy: type markers consumed by tag/tag_proxy
 * - user_effect/user_pre_effect: effect tracking
 * - template_effect/deferred_template_effect: render count/time profiling
 * - each/if/key/await/component/boundary: block-callback owner attribution
 *
 * This single module replaces all post-compilation regex transforms
 * for reactive tracking, making the approach Svelte-compiler-output agnostic.
 */
export const wrapperCode: string = wrapperSource

/** The devtools runtime (`./client.js`), installed once as `window.__SVELTE_DEVTOOLS__`. */
export const runtimeCode: string = runtimeSource

/**
 * The `svelte/internal/client` module the plugin serves: the wrapper, plus the
 * prompt toolbar's element ownership (`./wrapper-toolbar.js`) only when the
 * toolbar is enabled. Without it the module is `wrapperCode`, unchanged.
 */
export function wrapperModule(promptToolbar: boolean): string {
  return promptToolbar ? wrapperSource + '\n' + wrapperToolbarSource : wrapperSource
}

/**
 * The prompt toolbar module (`./prompt-toolbar.js`), preceded by the values it
 * needs from the project. They go into the served module rather than the page
 * HTML, so the markup does not carry the project's absolute path.
 */
export function promptToolbarModule(options: { root: string; tracking: boolean }): string {
  const config = JSON.stringify({ root: options.root, tracking: options.tracking })
  return `globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__ = ${config}\n${promptToolbarSource}`
}

/** The toolbar's markdown helpers (`./prompt-format.js`). */
export const promptFormatCode: string = promptFormatSource
