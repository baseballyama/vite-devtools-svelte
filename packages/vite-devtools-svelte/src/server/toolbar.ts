import { PROMPT_TOOLBAR_MODULE_ID } from '../runtime/ids.js'
import { promptToolbarCode } from '../runtime/index.js'

/**
 * The floating prompt toolbar is a Vite module, not a static file: its DOM
 * layer imports the typed helpers from `prompt-format.ts`, and that module has
 * to go through Vite's pipeline (TypeScript transform, import rewriting) like
 * any other. SvelteKit serves its HTML without `transformIndexHtml`, so the
 * injected tag carries the module URL directly (`/@id/__x00__…` is how Vite
 * addresses a virtual module from the browser).
 *
 * What the toolbar needs from the project — the root, for repository-relative
 * paths, and the Vite base, for `/@fs` source reads — is written into the
 * *served module*, not the URL: the page markup stays the same on every machine.
 */
export const PROMPT_TOOLBAR_PATH = `@id/__x00__${PROMPT_TOOLBAR_MODULE_ID}`

/** URL of the toolbar module, absolute to the served page (respects `base`). */
export function promptToolbarUrl(base: string): string {
  return `${base}${PROMPT_TOOLBAR_PATH}`
}

/** `<script type="module" src>` for the toolbar, as plain HTML. */
export function promptToolbarTag(url: string): string {
  return `<script type="module" src="${url}"></script>`
}

/**
 * The same tag escaped for SvelteKit's generated app template, which is a JS
 * string literal: quotes must be escaped once more so the emitted HTML keeps
 * real attribute quotes.
 */
export function promptToolbarTagForTemplate(url: string): string {
  return promptToolbarTag(url).replaceAll('"', '\\"')
}

/**
 * The served module: the toolbar source plus one line of configuration. The
 * root never reaches the page's HTML (where it would be visible to anything
 * reading the markup), and `JSON.stringify` keeps the values safe to inline.
 */
export function promptToolbarModule(root: string, base: string): string {
  const config = JSON.stringify({ root, base })
  return `globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__ = ${config}\n${promptToolbarCode}`
}
