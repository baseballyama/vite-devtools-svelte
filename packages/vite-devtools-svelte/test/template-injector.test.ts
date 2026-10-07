import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import {
  injectIntoSvelteKitInternal,
  sveltekitTemplateInjector,
  SVELTEKIT_INTERNAL_SUFFIX,
  SVELTEKIT3_DEV_SERVER_SUFFIX,
  TEMPLATE_APP_MARKER,
} from '../src/server/template-injector.js'

const INJECT_URL = '/__devtools/embedded.js'
/** Removed from `@vitejs/devtools` 0.7.6; requesting it 500s (review H-INJ). */
const REMOVED_INJECT_URL = '/@id/@vitejs/devtools/client/inject'

/**
 * Hand-rolled mock that mirrors the literal SvelteKit's `sync.server()` emits.
 * In real generated code `</body>` is NOT escaped (`JSON.stringify` doesn't
 * touch `/`), only newlines and quotes are.
 */
const FAKE_INTERNAL_JS = `import root from '../src/root.js';
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
      /<script type=\\"module\\" src=\\"\/__devtools\/embedded\.js\\"><\/script><\/body>/,
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
  let hosted = true
  const plugin = sveltekitTemplateInjector(() => hosted)

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
    expect(result!.code).not.toContain(REMOVED_INJECT_URL)
  })

  it('matches the SvelteKit 3 dev server module and rewrites it', () => {
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string; map: null } | undefined
    const result = transform.call(
      {},
      FAKE_INTERNAL_JS,
      `/abs/project/${SVELTEKIT3_DEV_SERVER_SUFFIX}`,
    )
    expect(result).toBeDefined()
    expect(result!.code).toContain(INJECT_URL)
    // the build-time module is never a dev target
    expect(
      transform.call({}, FAKE_INTERNAL_JS, '/abs/project/.svelte-kit/generated/build/server.js'),
    ).toBeNull()
  })

  it('leaves the template untouched when the Vite DevTools hub is not present (standalone)', () => {
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown
    hosted = false
    try {
      expect(
        transform.call(
          {},
          FAKE_INTERNAL_JS,
          `/abs/project/.svelte-kit/generated/server/internal.js`,
        ),
      ).toBeNull()
    } finally {
      hosted = true
    }
  })

  it('ignores other modules', () => {
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown
    expect(transform.call({}, FAKE_INTERNAL_JS, '/abs/project/src/lib/foo.ts')).toBeNull()
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
      import.meta.dirname,
      '../../../examples/strict-csp-app/.svelte-kit/generated/server/internal.js',
    ),
    path.resolve(
      import.meta.dirname,
      '../../../examples/sample-app/.svelte-kit/generated/server/internal.js',
    ),
    path.resolve(
      import.meta.dirname,
      '../../../playground/.svelte-kit/generated/server/internal.js',
    ),
  ]

  // Resolved at collection time so the contract tests below are reported as
  // skipped (not silently passed) when no generated fixture exists.
  const realPath = fixtureCandidates.find(candidate => fs.existsSync(candidate)) ?? null
  const realInternal = realPath === null ? null : fs.readFileSync(realPath, 'utf8')
  if (realPath === null) {
    console.warn(
      '[skip] No generated/server/internal.js fixture found. ' +
        'Run `pnpm -C examples/strict-csp-app exec svelte-kit sync` to populate one.',
    )
  }
  const noFixture = realInternal === null

  it.skipIf(noFixture)('uses the documented generated file suffix', () => {
    expect(realPath!.endsWith(SVELTEKIT_INTERNAL_SUFFIX)).toBe(true)
  })

  it.skipIf(noFixture)('contains the templates.app structural marker', () => {
    expect(realInternal!).toContain(TEMPLATE_APP_MARKER)
  })

  it.skipIf(noFixture)('contains a literal </body> inside the app template arrow function', () => {
    // SvelteKit emits the template via `JSON.stringify`-style escaping which
    // leaves `/` untouched, so `</body>` appears verbatim inside the literal.
    expect(realInternal!).toMatch(/templates:\s*\{[\s\S]*?app:[\s\S]*?<\/body>/)
  })

  it.skipIf(noFixture)('successfully rewrites the real generated file', () => {
    const out = injectIntoSvelteKitInternal(realInternal!)
    expect(out).not.toBeNull()
    expect(out!).toContain(INJECT_URL)
  })
})
