import { describe, it, expect } from 'vitest'

import {
  injectIntoSvelteKitInternal,
  injectIntoSvelteKitTemplate,
} from '../src/server/template-injector.js'
import {
  PROMPT_TOOLBAR_PATH,
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
  it('respects the base and carries the root for relative paths', () => {
    const url = promptToolbarUrl('/', '/home/me/app', 'v1')
    expect(url).toBe('/' + PROMPT_TOOLBAR_PATH + '?root=%2Fhome%2Fme%2Fapp&version=v1')
    expect(promptToolbarUrl('/base/', '/home/me/app', 'v1')).toMatch(/^\/base\/__svelte-devtools\//)
  })

  it('builds a module script tag, escaped for SvelteKit’s JS template literal', () => {
    const url = promptToolbarUrl('/', '/home/me/app', 'v1')
    expect(promptToolbarTag(url)).toBe(`<script type="module" src="${url}"></script>`)
    expect(promptToolbarTagForTemplate(url)).toBe(
      `<script type=\\"module\\" src=\\"${url}\\"></script>`,
    )
  })
})

describe('injectIntoSvelteKitTemplate', () => {
  const toolbarTag = promptToolbarTagForTemplate(promptToolbarUrl('/', '/home/me/app', 'v1'))

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
