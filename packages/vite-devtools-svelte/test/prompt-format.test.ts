import { describe, it, expect } from 'vitest'

import {
  buildPrompt,
  elementTitle,
  formatSelection,
  isProjectFile,
  relLocation,
  relPath,
  type Inspected,
} from '../src/runtime/prompt-format.js'

const ROOT = '/home/me/app'

const picked = (overrides: Partial<Inspected> = {}): Inspected => ({
  epoch: 'e1',
  page: { url: 'http://localhost:5173/products', title: 'Shop', viewport: '1280×800' },
  element: { tag: 'button', id: '', classes: ['primary'] },
  source: { file: `${ROOT}/src/lib/Card.svelte`, line: 12, column: 4, enclosing: false },
  template: [
    {
      type: 'each',
      file: `${ROOT}/src/routes/+page.svelte`,
      line: 8,
      column: 2,
      componentTag: null,
    },
    {
      type: 'component',
      file: `${ROOT}/src/routes/+page.svelte`,
      line: 9,
      column: 4,
      componentTag: 'Card',
    },
  ],
  components: [
    { id: 7, name: 'Card', file: `${ROOT}/src/lib/Card.svelte` },
    { id: 3, name: '+page', file: `${ROOT}/src/routes/+page.svelte` },
    { id: 1, name: 'root', file: `${ROOT}/.svelte-kit/generated/root.svelte` },
  ],
  ...overrides,
})

describe('paths', () => {
  it('makes files root-relative with forward slashes', () => {
    expect(relPath(`${ROOT}/src/App.svelte`, ROOT)).toBe('src/App.svelte')
    expect(relPath(`${ROOT}/src/App.svelte`, `${ROOT}/`)).toBe('src/App.svelte')
    expect(relPath('C:\\app\\src\\App.svelte', 'C:\\app')).toBe('src/App.svelte')
    // outside the root, or no root: unchanged
    expect(relPath('/elsewhere/X.svelte', ROOT)).toBe('/elsewhere/X.svelte')
    expect(relPath(`${ROOT}-other/X.svelte`, ROOT)).toBe(`${ROOT}-other/X.svelte`)
    expect(relPath('/a/X.svelte', '')).toBe('/a/X.svelte')
    expect(relPath(null, ROOT)).toBe('')
  })

  it('formats a location with whatever line and column are known', () => {
    const file = `${ROOT}/src/App.svelte`
    expect(relLocation({ file, line: 3, column: 1 }, ROOT)).toBe('src/App.svelte:3:1')
    expect(relLocation({ file, line: 3, column: null }, ROOT)).toBe('src/App.svelte:3')
    expect(relLocation({ file, line: null, column: null }, ROOT)).toBe('src/App.svelte')
    expect(relLocation({ file: null, line: 1, column: 1 }, ROOT)).toBe('')
    expect(relLocation(null, ROOT)).toBe('')
  })

  it('treats installed packages and SvelteKit’s generated files as not the project’s', () => {
    expect(isProjectFile(`${ROOT}/src/App.svelte`)).toBe(true)
    expect(isProjectFile(`${ROOT}/node_modules/lib/Button.svelte`)).toBe(false)
    expect(isProjectFile('C:\\app\\node_modules\\lib\\Button.svelte')).toBe(false)
    expect(isProjectFile(`${ROOT}/.svelte-kit/generated/root.svelte`)).toBe(false)
    expect(isProjectFile(null)).toBe(false)
  })
})

describe('elementTitle', () => {
  it('names an element by tag, id and authored classes', () => {
    expect(elementTitle({ tag: 'a', id: 'buy', classes: ['cta', 'big'] })).toBe('a#buy.cta.big')
    expect(elementTitle({ tag: 'li', id: '', classes: [] })).toBe('li')
    expect(elementTitle(null)).toBe('element')
  })
})

describe('formatSelection', () => {
  it('describes where the element is written, who renders it and how to read its state', () => {
    expect(formatSelection(picked(), 2, ROOT)).toBe(
      [
        '### 2. `button.primary`',
        '- location: `src/lib/Card.svelte:12:4`',
        '- components (innermost first): `Card` (`src/lib/Card.svelte`) › `+page` (`src/routes/+page.svelte`)',
        '- live state: MCP tool `get_reactive_scope` of vite-devtools-svelte with `{"componentId":7,"epoch":"e1"}` (valid while this page stays loaded)',
        '- template (innermost first): `{#each}` at `src/routes/+page.svelte:8:2` › `<Card />` at `src/routes/+page.svelte:9:4`',
      ].join('\n'),
    )
  })

  it('says when the location is an ancestor’s', () => {
    const text = formatSelection(
      picked({
        source: { file: `${ROOT}/src/lib/Card.svelte`, line: 3, column: 0, enclosing: true },
      }),
      1,
      ROOT,
    )
    expect(text).toContain(
      '- location: inside `src/lib/Card.svelte:3:0` (Svelte recorded no location',
    )
    // an enclosing location says nothing about snippets
    expect(text).not.toContain('- note:')
  })

  it('says when no location is known', () => {
    const text = formatSelection(picked({ source: null, template: [] }), 1, ROOT)
    expect(text).toContain('- location: unknown')
    expect(text).not.toContain('- template')
  })

  it('points out markup written in one component and rendered by another', () => {
    const text = formatSelection(
      picked({
        source: { file: `${ROOT}/src/routes/+page.svelte`, line: 20, column: 6, enclosing: false },
      }),
      1,
      ROOT,
    )
    expect(text).toContain(
      '- note: written in `src/routes/+page.svelte` and rendered by `Card` (markup passed as a snippet or children)',
    )
  })

  it('leaves out components and live state when tracking found no instance', () => {
    const text = formatSelection(picked({ components: [] }), 1, ROOT)
    expect(text).not.toContain('- components')
    expect(text).not.toContain('- live state')
    // only library instances: nothing of the project's to name
    const library = formatSelection(
      picked({
        components: [{ id: 4, name: 'Dialog', file: `${ROOT}/node_modules/ui/Dialog.svelte` }],
      }),
      1,
      ROOT,
    )
    expect(library).not.toContain('- components')
  })

  it('omits the live-state handle without an epoch', () => {
    const text = formatSelection(picked({ epoch: undefined }), 1, ROOT)
    expect(text).toContain('- components')
    expect(text).not.toContain('get_reactive_scope')
  })

  it('labels every frame kind and keeps the frame list short', () => {
    const frames = [
      'if',
      'each',
      'await',
      'key',
      'render',
      'snippet',
      'boundary',
      'other',
      'component',
    ]
    const text = formatSelection(
      picked({
        template: frames.map((type, line) => ({
          type,
          file: `${ROOT}/src/A.svelte`,
          line,
          column: 0,
          componentTag: null,
        })),
      }),
      1,
      ROOT,
    )
    const line = text.split('\n').find(row => row.startsWith('- template'))!
    expect(line).toContain('`{#if}` at `src/A.svelte:0:0`')
    expect(line).toContain('`{@render}`')
    expect(line).toContain('`{#snippet}`')
    // six at most
    expect(line.split(' › ')).toHaveLength(6)
    expect(line).not.toContain('<svelte:boundary>')
    const tail = formatSelection(
      picked({
        template: [
          {
            type: 'boundary',
            file: `${ROOT}/src/A.svelte`,
            line: 1,
            column: 0,
            componentTag: null,
          },
          { type: 'other', file: `${ROOT}/src/A.svelte`, line: 2, column: 0, componentTag: null },
          {
            type: 'component',
            file: `${ROOT}/src/A.svelte`,
            line: 3,
            column: 0,
            componentTag: null,
          },
          {
            type: 'if',
            file: `${ROOT}/node_modules/x/B.svelte`,
            line: 4,
            column: 0,
            componentTag: null,
          },
        ],
      }),
      1,
      ROOT,
    )
    expect(tail).toContain(
      '- template (innermost first): `<svelte:boundary>` at `src/A.svelte:1:0` › `{#other}` at `src/A.svelte:2:0` › `<Component />` at `src/A.svelte:3:0`',
    )
  })
})

describe('buildPrompt', () => {
  it('puts the page, the request and every selection in one document', () => {
    const second = picked({
      element: { tag: 'h1', id: '', classes: [] },
      source: { file: `${ROOT}/src/routes/+page.svelte`, line: 2, column: 0, enclosing: false },
      template: [],
      components: [{ id: 3, name: '+page', file: `${ROOT}/src/routes/+page.svelte` }],
    })
    const prompt = buildPrompt([picked(), second], '  Make the button smaller  ', ROOT)
    expect(prompt.startsWith('# UI context from the running app\n\n')).toBe(true)
    expect(prompt).toContain('Page: `http://localhost:5173/products` (Shop)\nViewport: 1280×800')
    expect(prompt).toContain(
      '## Request\n\nMake the button smaller\n\n## Selected elements\n\n### 1. ',
    )
    expect(prompt).toContain('\n\n### 2. `h1`\n- location: `src/routes/+page.svelte:2:0`')
    expect(prompt.endsWith('\n')).toBe(true)
    // no absolute paths of the project
    expect(prompt).not.toContain(ROOT)
  })

  it('works without a request, a title or page information', () => {
    const untitled = buildPrompt(
      [picked({ page: { url: 'http://x/', title: '', viewport: '1×1' } })],
      '',
      ROOT,
    )
    expect(untitled).toContain('Page: `http://x/`\nViewport: 1×1')
    expect(untitled).toContain('## Request\n\n(describe the change here)')
    const pageless = buildPrompt([picked({ page: undefined })], 'x', ROOT)
    expect(pageless).not.toContain('Page:')
  })
})
