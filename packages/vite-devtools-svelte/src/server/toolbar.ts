import { PROMPT_TOOLBAR_MODULE_ID } from '../runtime/ids.js'

/**
 * URL of the prompt toolbar module, absolute to the served page. It is a
 * virtual module, addressed the way Vite addresses one from the browser
 * (`/@id/__x00__<id>`): SvelteKit serves its HTML without
 * `transformIndexHtml`, so the injected tag has to carry a final URL.
 */
export function promptToolbarUrl(base: string): string {
  return `${base}@id/__x00__${PROMPT_TOOLBAR_MODULE_ID}`
}

/**
 * `<script type="module" src>` for SvelteKit's generated app template, which
 * is a JS string literal: the quotes are escaped once more so the emitted HTML
 * keeps real attribute quotes. (`transformIndexHtml` pages get the tag as a
 * descriptor instead.)
 */
export function promptToolbarTagForTemplate(url: string): string {
  return `<script type=\\"module\\" src=\\"${url}\\"></script>`
}
