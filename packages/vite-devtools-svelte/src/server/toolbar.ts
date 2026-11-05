import type { ViteDevServer } from 'vite'

import { promptToolbarCode } from '../runtime/index.js'

/**
 * The floating prompt toolbar is a plain ES module served by a dev-server
 * middleware, not a virtual module: SvelteKit serves its HTML without Vite's
 * `transformIndexHtml`, so the app template can only reference a real URL, and
 * a static file needs no import rewrites (the toolbar imports nothing).
 *
 * What it needs from the project — the root, for repository-relative paths, and
 * the Vite base, for `/@fs` source reads — is written into the *served script*,
 * not the URL: the page markup stays the same on every machine.
 */
export const PROMPT_TOOLBAR_PATH = '__svelte-devtools/prompt-toolbar.js'

/** URL of the toolbar script, absolute to the served page (respects `base`). */
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
 * The served script: the toolbar source plus one line of configuration. The
 * root never reaches the page's HTML (where it would be visible to anything
 * reading the markup), and `JSON.stringify` keeps the values safe to inline.
 */
export function promptToolbarModule(root: string, base: string): string {
  return `globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__ = ${JSON.stringify({ root, base })}\n${promptToolbarCode}`
}

/**
 * Serve the toolbar script. Registered on the dev server's own middleware
 * stack before SvelteKit's catch-all handler, so the URL never reaches the
 * app router.
 */
export function servePromptToolbar(server: ViteDevServer, base: string, root: string): void {
  server.middlewares.use(`${base}${PROMPT_TOOLBAR_PATH}`, (_request, response) => {
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(promptToolbarModule(root, base))
  })
}
