import { describe, it, expect } from 'vitest'

import { PROMPT_TOOLBAR_MODULE_ID } from '../src/runtime/ids.js'
import { promptToolbarModule, wrapperCode, wrapperModule } from '../src/runtime/index.js'
import {
  injectIntoSvelteKitInternal,
  injectIntoSvelteKitTemplate,
} from '../src/server/template-injector.js'
import { promptToolbarTagForTemplate, promptToolbarUrl } from '../src/server/toolbar.js'

const FAKE_INTERNAL_JS = `export const options = {
\ttemplates: {
\t\tapp: ({ head, body }) => "<!doctype html>\\n<html><head>" + head + "</head><body>" + body + "</body></html>\\n",
\t},
};
`

describe('prompt toolbar modules', () => {
  it('addresses the toolbar the way Vite addresses a virtual module, under the base', () => {
    expect(promptToolbarUrl('/')).toBe(`/@id/__x00__${PROMPT_TOOLBAR_MODULE_ID}`)
    expect(promptToolbarUrl('/app/')).toBe(`/app/@id/__x00__${PROMPT_TOOLBAR_MODULE_ID}`)
  })

  it('escapes the tag for SvelteKit’s app template (a JS string literal)', () => {
    expect(promptToolbarTagForTemplate('/x')).toBe(
      '<script type=\\"module\\" src=\\"/x\\"></script>',
    )
  })

  it('writes the project values into the served module, not the page', () => {
    const code = promptToolbarModule({ root: '/home/me/app', tracking: false })
    const [first] = code.split('\n')
    expect(first).toBe(
      'globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__ = {"root":"/home/me/app","tracking":false}',
    )
    expect(code).toContain("from 'virtual:vite-devtools-svelte/prompt-format'")
  })

  it('leaves the svelte/internal/client wrapper untouched when the toolbar is off', () => {
    expect(wrapperModule(false)).toBe(wrapperCode)
    const on = wrapperModule(true)
    expect(on.startsWith(wrapperCode)).toBe(true)
    expect(on).toContain('export function append(')
    expect(on).toContain('export function add_locations(')
  })
})

describe('injectIntoSvelteKitTemplate', () => {
  const toolbarTag = promptToolbarTagForTemplate(promptToolbarUrl('/'))

  it('adds the toolbar before the closing body, next to the DevTools tag', () => {
    const withDock = injectIntoSvelteKitInternal(FAKE_INTERNAL_JS)!
    const withBoth = injectIntoSvelteKitTemplate(withDock, toolbarTag)!
    expect(withBoth).toContain('__devtools/embedded.js')
    expect(withBoth).toContain(`${toolbarTag}</body>`)
  })

  it('is idempotent per tag', () => {
    const once = injectIntoSvelteKitTemplate(FAKE_INTERNAL_JS, toolbarTag)!
    expect(once).toContain(toolbarTag)
    expect(injectIntoSvelteKitTemplate(once, toolbarTag)).toBeNull()
  })

  it('does nothing for code without an app template', () => {
    expect(injectIntoSvelteKitTemplate('export const x = 1;', toolbarTag)).toBeNull()
  })
})
