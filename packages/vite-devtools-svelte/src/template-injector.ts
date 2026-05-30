/// <reference types="@vitejs/devtools-kit" />
import type { Plugin } from 'vite'

/**
 * SvelteKit dev bypasses Vite's `transformIndexHtml`, so `@vitejs/devtools`'s
 * `DevToolsInjection` never reaches the served HTML and the dock is invisible
 * on every SvelteKit page. Tracked upstream at
 * https://github.com/baseballyama/vite-devtools-repl/tree/main/sveltekit-transform-index-html-bypass
 *
 * As a stopgap, SvelteKit inlines `src/app.html` as a JS string literal inside
 * `.svelte-kit/generated/server/internal.js`:
 *
 *     templates: {
 *       app: ({ head, body, ... }) => "<!doctype html>...<body>...</body>...",
 *     }
 *
 * That file is loaded through Vite's module pipeline (`vite.ssrLoadModule`),
 * so a regular `transform` hook can rewrite the literal to insert the dock's
 * inject script before `</body>`. The actual `<script>` runs in the browser
 * once the HTML is delivered, so no SSR safety guard on the inject module is
 * needed for this path.
 *
 * This is intentionally narrow — SvelteKit-specific path match plus a
 * structural assertion — and there's a test (`template-injector.test.ts`)
 * that fails if SvelteKit's generated shape changes, so a silent break shows
 * up in CI instead of as a missing dock in production.
 */

export const SVELTEKIT_INTERNAL_SUFFIX =
  '.svelte-kit/generated/server/internal.js'

/** Marker that the `templates.app` literal in SvelteKit's generated server. */
export const TEMPLATE_APP_MARKER = 'templates: {'

/** Where to inject the inject script — escaped because we're editing a JS string literal. */
const INJECT_SCRIPT_URL = '/@id/@vitejs/devtools/client/inject'
const INJECT_TAG = `<script type=\\"module\\" src=\\"${INJECT_SCRIPT_URL}\\"></script>`

/**
 * `</body>` as it appears inside SvelteKit's generated string literal.
 * SvelteKit emits `app.html` via `JSON.stringify`-style escaping, which leaves
 * `/` alone — only control characters and quotes are escaped. So the literal
 * substring we actually search for is plain `</body>`.
 */
const BODY_CLOSE = '</body>'

/**
 * Transform `.svelte-kit/generated/server/internal.js` to add the
 * `@vitejs/devtools` inject script right before `</body>` inside the app
 * template literal. Exposed for unit testing.
 *
 * Returns the new source if a substitution was made, or `null` to signal
 * "nothing to do" (already injected, structural marker missing, etc.).
 */
export function injectIntoSvelteKitInternal(code: string): string | null {
  // Cheap structural sanity check — bail if SvelteKit changed how it generates
  // the template object. The companion test asserts this branch is reachable.
  if (!code.includes(TEMPLATE_APP_MARKER)) return null
  if (!code.includes(BODY_CLOSE)) return null

  // Idempotence: don't double-inject across HMR re-runs.
  if (code.includes(INJECT_SCRIPT_URL)) return null

  // Only patch the literal that follows the `templates: {` marker, so a
  // future `</body>` mentioned in unrelated source code won't be touched.
  const markerIdx = code.indexOf(TEMPLATE_APP_MARKER)
  const bodyIdx = code.indexOf(BODY_CLOSE, markerIdx)
  if (bodyIdx === -1) return null

  return (
    code.slice(0, bodyIdx) +
    INJECT_TAG +
    code.slice(bodyIdx)
  )
}

/**
 * Vite plugin: inject `@vitejs/devtools/client/inject` into SvelteKit's
 * dev-only generated server template. Dev-only by construction.
 */
export function sveltekitTemplateInjector(): Plugin {
  return {
    name: 'vite-devtools-svelte:sveltekit-template-injector',
    enforce: 'post',
    apply: (_userConfig, env) => env.command === 'serve' && !env.isSsrBuild,

    transform(code, id) {
      if (!id.endsWith(SVELTEKIT_INTERNAL_SUFFIX)) return
      const next = injectIntoSvelteKitInternal(code)
      if (next === null) return
      return { code: next, map: null }
    },
  }
}
