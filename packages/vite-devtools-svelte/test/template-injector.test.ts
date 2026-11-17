import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import {
  injectIntoSvelteKitTemplate,
  sveltekitTemplateInjector,
  SVELTEKIT_DEV_SERVER_SUFFIX,
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
const FAKE_SERVER_JS = `import root from '../src/root.js';
import { set_assets } from '$app/paths/internal/server';

export const options = {
\ttemplates: {
\t\tapp: ({ head, body, assets, nonce, env }) => "<!doctype html>\\n<html><head>" + head + "</head><body><div>" + body + "</div></body></html>\\n",
\t\terror: ({ status, message }) => "<!doctype html>\\n<html><body><h1>" + message + "</h1></body></html>\\n"
\t},
\tversion_hash: "abc"
};
`

describe('injectIntoSvelteKitTemplate', () => {
  it('inserts the inject script before the first </body> in the app template', () => {
    const out = injectIntoSvelteKitTemplate(FAKE_SERVER_JS)
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
    const out = injectIntoSvelteKitTemplate(FAKE_SERVER_JS)!
    const appTagIdx = out.indexOf(INJECT_URL)
    const errorTemplateIdx = out.indexOf('error: ')
    expect(appTagIdx).toBeGreaterThan(-1)
    expect(appTagIdx).toBeLessThan(errorTemplateIdx)
  })

  it('is idempotent across re-runs (HMR)', () => {
    const once = injectIntoSvelteKitTemplate(FAKE_SERVER_JS)!
    const twice = injectIntoSvelteKitTemplate(once)
    expect(twice).toBeNull()
  })

  it('bails out cleanly if the templates marker is missing', () => {
    expect(injectIntoSvelteKitTemplate('export const x = 1;')).toBeNull()
  })

  it('bails out cleanly if no </body> appears', () => {
    expect(
      injectIntoSvelteKitTemplate(
        `export const options = { ${TEMPLATE_APP_MARKER} app: () => "" }`,
      ),
    ).toBeNull()
  })
})

/** A generated module whose app template literal is `app` (already JSON-escaped). */
const serverWith = (app: string, eol = '\n') =>
  [
    'export const options = {',
    '\ttemplates: {',
    `\t\tapp: ({ head, body }) => "${app}",`,
    '\t\terror: ({ message }) => "<html><body>" + message + "</body></html>"',
    '\t}',
    '};',
    '',
  ].join(eol)

const TAG = String.raw`<script type=\"module\" src=\"/__devtools/embedded.js\"></script>`

describe('injectIntoSvelteKitTemplate: app.html edge cases', () => {
  it.each([
    [
      '`</body>` in an HTML comment before the real one',
      String.raw`<html><body><!-- </body> -->" + body + "</body></html>`,
      String.raw`<html><body><!-- </body> -->" + body + "${TAG}</body></html>`,
    ],
    [
      '`</body>` inside an inline script string',
      String.raw`<body><script>const s = \"</body>\"</script>" + body + "</body>`,
      String.raw`<body><script>const s = \"</body>\"</script>" + body + "${TAG}</body>`,
    ],
    [
      'escaped CRLF line endings in app.html',
      String.raw`<html>\r\n<body>" + body + "</body>\r\n</html>\r\n`,
      String.raw`<html>\r\n<body>" + body + "${TAG}</body>\r\n</html>\r\n`,
    ],
    [
      'an unrelated script already present (old inject URL)',
      String.raw`<body>" + body + "<script src=\"/@id/@vitejs/devtools/client/inject\"></script></body>`,
      String.raw`<body>" + body + "<script src=\"/@id/@vitejs/devtools/client/inject\"></script>${TAG}</body>`,
    ],
  ])('%s: the tag goes before the document closing tag', (_, app, expected) => {
    expect(injectIntoSvelteKitTemplate(serverWith(app))).toBe(serverWith(expected))
  })

  it('handles a CRLF generated module (line ends after the literal)', () => {
    const app = '<body>" + body + "</body>'
    expect(injectIntoSvelteKitTemplate(serverWith(app, '\r\n'))).toBe(
      serverWith(`<body>" + body + "${TAG}</body>`, '\r\n'),
    )
  })

  it('patches exactly once; a second pass is a no-op', () => {
    const once = injectIntoSvelteKitTemplate(serverWith('<body></body>'))!
    expect(once.split('/__devtools/embedded.js')).toHaveLength(2)
    expect(injectIntoSvelteKitTemplate(once)).toBeNull()
  })

  it('never touches the error template', () => {
    const out = injectIntoSvelteKitTemplate(serverWith('<body></body>'))!
    const errorLine = out.split('\n').find(l => l.includes('error:'))!
    expect(errorLine).not.toContain('embedded.js')
  })

  it('a multi-line app literal (unexpected shape) falls back to the first `</body>`', () => {
    const code = 'export const options = { templates: {\napp: () => `<body>\n</body>`\n} }'
    expect(injectIntoSvelteKitTemplate(code)).toBe(code.replace('</body>', `${TAG}</body>`))
  })

  it.each([
    ['no `app:` key', 'export const options = { templates: { page: "<body></body>" } }'],
    [
      'the app literal on the last line (no newline)',
      'export const options = { templates: { app: () => "<body></body>" } }',
    ],
  ])('%s: the first `</body>` after the marker', (_, code) => {
    expect(injectIntoSvelteKitTemplate(code)).toBe(code.replace('</body>', `${TAG}</body>`))
  })

  it('a `</body>` only before the templates marker is not a target', () => {
    expect(
      injectIntoSvelteKitTemplate('// </body>\nexport const options = { templates: { app: x } }'),
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

  it('matches the SvelteKit dev server module and rewrites it', () => {
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string; map: null } | undefined
    const result = transform.call({}, FAKE_SERVER_JS, `/abs/project/${SVELTEKIT_DEV_SERVER_SUFFIX}`)
    expect(result).toBeDefined()
    expect(result!.code).toContain(INJECT_URL)
    expect(result!.code).not.toContain(REMOVED_INJECT_URL)
    // the build-time module is never a dev target
    expect(
      transform.call({}, FAKE_SERVER_JS, '/abs/project/.svelte-kit/generated/build/server.js'),
    ).toBeNull()
  })

  it('leaves the template untouched when the Vite DevTools hub is not present (standalone)', () => {
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown
    hosted = false
    try {
      expect(
        transform.call({}, FAKE_SERVER_JS, `/abs/project/${SVELTEKIT_DEV_SERVER_SUFFIX}`),
      ).toBeNull()
    } finally {
      hosted = true
    }
  })

  it('ignores other modules', () => {
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown
    expect(transform.call({}, FAKE_SERVER_JS, '/abs/project/src/lib/foo.ts')).toBeNull()
  })
})

/**
 * Early-warning test: load the actual dev server module SvelteKit generated
 * for an example app and assert that the structural markers we depend on are
 * still present. If a future SvelteKit version changes the generated shape,
 * this test fails and we know to revisit the path matching rather than
 * silently shipping a missing dock.
 */
describe('SvelteKit shape contract', () => {
  // Resolve relative to the test file so it works under both vitest cwd modes.
  const fixtureCandidates = ['examples/strict-csp-app', 'examples/sample-app', 'playground'].map(
    app => path.resolve(import.meta.dirname, '../../..', app, SVELTEKIT_DEV_SERVER_SUFFIX),
  )

  // Resolved at collection time so the contract tests below are reported as
  // skipped (not silently passed) when no generated fixture exists.
  const realPath = fixtureCandidates.find(candidate => fs.existsSync(candidate)) ?? null
  const realServer = realPath === null ? null : fs.readFileSync(realPath, 'utf8')
  if (realPath === null) {
    console.warn(
      '[skip] No generated/dev/server.js fixture found. ' +
        'Run `pnpm -C examples/strict-csp-app exec svelte-kit sync` to populate one.',
    )
  }
  const noFixture = realServer === null

  it.skipIf(noFixture)('contains the templates.app structural marker', () => {
    expect(realServer!).toContain(TEMPLATE_APP_MARKER)
  })

  it.skipIf(noFixture)('contains a literal </body> inside the app template arrow function', () => {
    // SvelteKit emits the template via `JSON.stringify`-style escaping which
    // leaves `/` untouched, so `</body>` appears verbatim inside the literal.
    expect(realServer!).toMatch(/templates:\s*\{[\s\S]*?app:[\s\S]*?<\/body>/)
  })

  it.skipIf(noFixture)('successfully rewrites the real generated file', () => {
    const out = injectIntoSvelteKitTemplate(realServer!)
    expect(out).not.toBeNull()
    expect(out!).toContain(INJECT_URL)
  })
})
