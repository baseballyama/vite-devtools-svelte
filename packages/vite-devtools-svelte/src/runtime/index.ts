// Browser code the plugin serves as virtual modules. The sources are plain
// JavaScript files next to this one (linted and formatted like any other
// source) and are inlined as strings at build time.
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import runtimeSource from './client.js?raw'
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import wrapperSource from './wrapper.js?raw'

export { RESOLVED_RUNTIME_ID, RUNTIME_MODULE_ID, WRAPPER_MODULE_ID } from './ids.js'

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
