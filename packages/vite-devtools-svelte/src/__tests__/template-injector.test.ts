import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  injectIntoSvelteKitInternal,
  sveltekitTemplateInjector,
  SVELTEKIT_INTERNAL_SUFFIX,
  TEMPLATE_APP_MARKER,
} from '../template-injector.js'

const INJECT_URL = '/@id/@vitejs/devtools/client/inject'

/**
 * Hand-rolled mock that mirrors the literal SvelteKit's `sync.server()` emits.
 * In real generated code `</body>` is NOT escaped (`JSON.stringify` doesn't
 * touch `/`), only newlines and quotes are.
 */
const FAKE_INTERNAL_JS = `import root from '../root.js';
import { set_assets } from '$app/paths/internal/server';

export const options = {
\ttemplates: {
\t\tapp: ({ head, body, assets, nonce, env }) => "<!doctype html>\\n<html><head>" + head + "</head><body><div>" + body + "</div></body></html>\\n",
\t\terror: ({ status, message }) => "<!doctype html>\\n<html><body><h1>" + message + "</h1></body></html>\\n"
\t},
\tversion_hash: "abc"
};
`

describe('injectIntoSvelteKitInternal', () => {
  it('inserts the inject script before the first </body> in the app template', () => {
    const out = injectIntoSvelteKitInternal(FAKE_INTERNAL_JS)
    expect(out).not.toBeNull()
    expect(out!).toContain(INJECT_URL)
    // The inject tag is itself a JS string literal substring, so the quotes
    // around the src attribute appear as \" in the patched source. After
    // injection, the literal sequence we expect is `</script></body>`.
    expect(out!).toMatch(
      /<script[^>]*src=\\"\/@id\/@vitejs\/devtools\/client\/inject\\"[^>]*><\/script><\/body>/,
    )
  })

  it('targets the app template literal, not later body close tags', () => {
    const out = injectIntoSvelteKitInternal(FAKE_INTERNAL_JS)!
    const appTagIdx = out.indexOf(INJECT_URL)
    const errorTemplateIdx = out.indexOf('error: ')
    expect(appTagIdx).toBeGreaterThan(-1)
    expect(appTagIdx).toBeLessThan(errorTemplateIdx)
  })

  it('is idempotent across re-runs (HMR)', () => {
    const once = injectIntoSvelteKitInternal(FAKE_INTERNAL_JS)!
    const twice = injectIntoSvelteKitInternal(once)
    expect(twice).toBeNull()
  })

  it('bails out cleanly if the templates marker is missing', () => {
    expect(injectIntoSvelteKitInternal('export const x = 1;')).toBeNull()
  })

  it('bails out cleanly if no </body> appears', () => {
    expect(
      injectIntoSvelteKitInternal(
        `export const options = { ${TEMPLATE_APP_MARKER} app: () => "" }`,
      ),
    ).toBeNull()
  })
})

describe('sveltekitTemplateInjector plugin', () => {
  const plugin = sveltekitTemplateInjector()

  it('only applies during dev serve', () => {
    const apply = plugin.apply as (
      cfg: unknown,
      env: { command: string; isSsrBuild?: boolean },
    ) => boolean
    expect(apply({}, { command: 'serve', isSsrBuild: false })).toBe(true)
    expect(apply({}, { command: 'serve', isSsrBuild: true })).toBe(false)
    expect(apply({}, { command: 'build', isSsrBuild: false })).toBe(false)
  })

  it('matches the SvelteKit generated path and rewrites it', () => {
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string; map: null } | undefined
    const result = transform.call(
      {},
      FAKE_INTERNAL_JS,
      `/abs/project/.svelte-kit/generated/server/internal.js`,
    )
    expect(result).toBeDefined()
    expect(result!.code).toContain(INJECT_URL)
  })

  it('ignores other modules', () => {
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown
    expect(transform.call({}, FAKE_INTERNAL_JS, '/abs/project/src/lib/foo.ts')).toBeUndefined()
  })
})

/**
 * Early-warning test: load the actual `internal.js` SvelteKit produced for the
 * strict-csp-app fixture and assert that the structural markers we depend on
 * are still present. If a future SvelteKit version changes the generated
 * shape, this test fails and we know to revisit the path matching rather
 * than silently shipping a missing dock.
 */
describe('SvelteKit shape contract', () => {
  const fixtureCandidates = [
    // Resolve relative to the test file so it works under both vitest cwd modes.
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../examples/strict-csp-app/.svelte-kit/generated/server/internal.js',
    ),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../examples/sample-app/.svelte-kit/generated/server/internal.js',
    ),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../playground/.svelte-kit/generated/server/internal.js',
    ),
  ]

  let realInternal: string | null = null
  let realPath: string | null = null

  beforeAll(() => {
    for (const candidate of fixtureCandidates) {
      if (fs.existsSync(candidate)) {
        realInternal = fs.readFileSync(candidate, 'utf8')
        realPath = candidate
        break
      }
    }
  })

  it('uses the documented generated file suffix', () => {
    if (!realPath) {
      console.warn(
        '[skip] No generated/server/internal.js fixture found. ' +
          'Run `pnpm -C examples/strict-csp-app exec svelte-kit sync` to populate one.',
      )
      return
    }
    expect(realPath.endsWith(SVELTEKIT_INTERNAL_SUFFIX)).toBe(true)
  })

  it('contains the templates.app structural marker', () => {
    if (!realInternal) return
    expect(realInternal).toContain(TEMPLATE_APP_MARKER)
  })

  it('contains a literal </body> inside the app template arrow function', () => {
    if (!realInternal) return
    // SvelteKit emits the template via `JSON.stringify`-style escaping which
    // leaves `/` untouched, so `</body>` appears verbatim inside the literal.
    expect(realInternal).toMatch(/templates:\s*\{[\s\S]*?app:[\s\S]*?<\/body>/)
  })

  it('successfully rewrites the real generated file', () => {
    if (!realInternal) return
    const out = injectIntoSvelteKitInternal(realInternal)
    expect(out).not.toBeNull()
    expect(out!).toContain(INJECT_URL)
  })
})
