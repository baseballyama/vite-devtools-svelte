import { describe, it, expect } from 'vitest'

import {
  injectIntoSvelteKitInternal,
  injectIntoSvelteKitTemplate,
} from '../src/server/template-injector.js'
import {
  PROMPT_TOOLBAR_PATH,
  promptToolbarModule,
  promptToolbarTag,
  promptToolbarTagForTemplate,
  promptToolbarUrl,
} from '../src/server/toolbar.js'

const FAKE_INTERNAL_JS = `export const options = {
\ttemplates: {
\t\tapp: ({ head, body }) => "<!doctype html>\\n<html><head>" + head + "</head><body>" + body + "</body></html>\\n",
\t},
};
`

describe('prompt toolbar URL and tags', () => {
  it('respects the base and carries no configuration in the URL', () => {
    expect(promptToolbarUrl('/')).toBe('/' + PROMPT_TOOLBAR_PATH)
    expect(promptToolbarUrl('/base/')).toBe(`/base/${PROMPT_TOOLBAR_PATH}`)
  })

  it('builds a module script tag, escaped for SvelteKit’s JS template literal', () => {
    const url = promptToolbarUrl('/')
    expect(promptToolbarTag(url)).toBe(`<script type="module" src="${url}"></script>`)
    expect(promptToolbarTagForTemplate(url)).toBe(
      `<script type=\\"module\\" src=\\"${url}\\"></script>`,
    )
  })

  it('writes the root and the base into the served script, not the page', () => {
    const code = promptToolbarModule('/home/me/app', '/base/')
    expect(code.startsWith('globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__ = ')).toBe(true)
    const config = JSON.parse(code.split('\n')[0]!.split(' = ')[1]!)
    expect(config).toEqual({ root: '/home/me/app', base: '/base/' })
    expect(code).toContain('mountToolbar')
  })
})

describe('injectIntoSvelteKitTemplate', () => {
  const toolbarTag = promptToolbarTagForTemplate(promptToolbarUrl('/'))

  it('adds the toolbar next to the devtools dock tag', () => {
    const withDock = injectIntoSvelteKitInternal(FAKE_INTERNAL_JS)!
    const withBoth = injectIntoSvelteKitTemplate(withDock, toolbarTag)!
    expect(withBoth).toContain('__devtools/embedded.js')
    expect(withBoth).toContain(PROMPT_TOOLBAR_PATH)
    // both tags sit right before the document's closing body
    expect(withBoth).toMatch(/prompt-toolbar[^"]*\\"><\/script><\/body>/)
  })

  it('is idempotent per tag', () => {
    const once = injectIntoSvelteKitTemplate(FAKE_INTERNAL_JS, toolbarTag)!
    expect(injectIntoSvelteKitTemplate(once, toolbarTag)).toBeNull()
  })

  it('does nothing for code without an app template', () => {
    expect(injectIntoSvelteKitTemplate('export const x = 1;', toolbarTag)).toBeNull()
  })
})
