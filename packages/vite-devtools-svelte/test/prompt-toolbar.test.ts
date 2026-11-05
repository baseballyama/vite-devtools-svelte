import { describe, it, expect } from 'vitest'

// The toolbar is a plain browser module served verbatim by the dev server, so
// it ships no declarations: only the pure formatting helpers are used here.
// @ts-expect-error -- plain JS browser module without type declarations
import * as toolbar from '../src/runtime/prompt-toolbar.js'

const {
  relPath,
  relLocation,
  sourceWindow,
  fenceLanguage,
  formatSelection,
  buildPrompt,
  matchSourceLine,
  resolveElementSource,
  summarizeValue,
  summarizeProps,
} = toolbar as unknown as {
  relPath: (file: string, root: string) => string
  relLocation: (loc: { file: string; line?: number; column?: number }, root: string) => string
  sourceWindow: (text: string, line: number) => string | null
  fenceLanguage: (file: string) => string
  matchSourceLine: (
    text: string,
    element: { tag: string; id?: string; classes?: string[]; attrs?: Record<string, string> },
    hintLine?: number | null,
  ) => { line: number; basis: string } | null
  resolveElementSource: (
    payload: {
      source?: Payload['source']
      element?: unknown
      components?: Array<{ file: string }>
    },
    file: { file: string; text: string } | null,
    root: string,
  ) => {
    file: string
    line: number | null
    column: number | null
    compiledLine: number | null
    matched: string | null
  } | null
  summarizeValue: (json: string) => string
  summarizeProps: (json: string | null) => string
  formatSelection: (
    payload: Payload,
    source: { file: string; text: string } | null,
    options: Record<string, unknown>,
    root: string,
  ) => string
  buildPrompt: (
    selections: Array<{ payload: Payload; source: unknown }>,
    options: Record<string, unknown>,
    meta?: { root?: string; plugin?: string },
  ) => string
}

const ROOT = '/home/me/project'

interface Payload {
  page?: { url: string; path: string; title: string; viewport: string }
  element: {
    tag: string
    id: string
    classes: string[]
    attrs: Record<string, string>
    outerHTML: string
    size: string
    selector: string
  }
  source: { file: string; line: number; column: number } | null
  template: Array<{
    type: string
    file: string | null
    line: number | null
    column: number | null
    componentTag: string | null
  }>
  components: Array<{
    id: number
    name: string
    file: string
    usage: { file: string; line: number; column: number; componentTag: string | null } | null
    props: string | null
    state: Array<{ name: string; type: string; value: string }>
    renders: number
  }>
}

const payload: Payload = {
  page: {
    url: 'http://localhost:3000/settings',
    path: '/settings',
    title: 'Settings',
    viewport: '1440×900',
  },
  element: {
    tag: 'button',
    id: 'save',
    classes: ['primary'],
    attrs: { id: 'save', class: 'primary', type: 'submit' },
    outerHTML: '<button id="save" class="primary" type="submit">Save</button>',
    size: '96×32',
    selector: 'main > form > button#save.primary',
  },
  source: { file: `${ROOT}/src/lib/components/Form.svelte`, line: 12, column: 2 },
  template: [
    {
      type: 'component',
      file: `${ROOT}/src/routes/settings/+page.svelte`,
      line: 8,
      column: 2,
      componentTag: 'Form',
    },
    {
      type: 'if',
      file: `${ROOT}/src/routes/settings/+page.svelte`,
      line: 6,
      column: 0,
      componentTag: null,
    },
  ],
  components: [
    {
      id: 2,
      name: 'Form',
      file: `${ROOT}/src/lib/components/Form.svelte`,
      usage: {
        file: `${ROOT}/src/routes/settings/+page.svelte`,
        line: 8,
        column: 2,
        componentTag: 'Form',
      },
      props: '{"title":"Profile"}',
      state: [
        { name: 'saving', type: 'state', value: 'false' },
        { name: 'label', type: 'derived', value: '"Save"' },
      ],
      renders: 3,
    },
    {
      id: 1,
      name: 'SettingsPage',
      file: `${ROOT}/src/routes/settings/+page.svelte`,
      usage: null,
      props: null,
      state: [],
      renders: 1,
    },
  ],
}

const source = {
  file: `${ROOT}/src/lib/components/Form.svelte`,
  line: 12,
  text: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'),
}

describe('relPath / relLocation', () => {
  it('strips the project root', () => {
    expect(relPath(`${ROOT}/src/App.svelte`, ROOT)).toBe('src/App.svelte')
    expect(relPath('/elsewhere/App.svelte', ROOT)).toBe('/elsewhere/App.svelte')
    expect(relPath('/elsewhere/App.svelte', '')).toBe('/elsewhere/App.svelte')
    expect(relPath('', ROOT)).toBe('')
  })

  it('formats file:line:column', () => {
    expect(relLocation({ file: `${ROOT}/src/App.svelte`, line: 3, column: 7 }, ROOT)).toBe(
      'src/App.svelte:3:7',
    )
    expect(relLocation({ file: `${ROOT}/src/App.svelte` }, ROOT)).toBe('src/App.svelte')
    expect(relLocation({ file: '', line: 1 }, ROOT)).toBe('')
  })
})

describe('sourceWindow', () => {
  const text = Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n')

  it('marks the selected line and numbers the window', () => {
    const window = sourceWindow(text, 12)!
    expect(window.split('\n')).toHaveLength(17)
    expect(window).toContain('  4 | l4')
    expect(window).toContain('> 12 | l12')
    expect(window).toContain(' 20 | l20')
  })

  it('clamps at the start of the file', () => {
    const window = sourceWindow(text, 1)!
    expect(window).toContain('> 1 | l1')
    expect(window).not.toContain('| l0')
  })

  it('returns null without a line', () => {
    expect(sourceWindow(text, 0)).toBeNull()
    expect(sourceWindow('', 4)).toBeNull()
  })
})

describe('fenceLanguage', () => {
  it('maps extensions', () => {
    expect(fenceLanguage('a.svelte')).toBe('svelte')
    expect(fenceLanguage('a.ts')).toBe('ts')
    expect(fenceLanguage('a.js')).toBe('js')
    expect(fenceLanguage('a.txt')).toBe('')
  })
})

describe('matchSourceLine / resolveElementSource', () => {
  const file = `${ROOT}/src/routes/dashboard/+page.svelte`
  // Line 43 is what Svelte recorded (the enclosing <div>); the picked <a> is 55.
  const lines = Array.from({ length: 70 }, (_, i) => `// line ${i + 1}`)
  lines[42] = '  <div class="app-layout">'
  lines[54] = '        <a class="button button-quiet" href="/files">Abrir espaço</a>'
  lines[58] = '        <a class="button" href="/agent">Abrir chat</a>'
  const text = lines.join('\n')

  const anchor = {
    tag: 'a',
    id: '',
    classes: ['button', 'button-quiet', 'svelte-abc123'],
    attrs: { class: 'button button-quiet svelte-abc123', href: '/files' },
  }

  it('finds the element line by its authored classes, ignoring Svelte hashes', () => {
    expect(matchSourceLine(text, anchor, 43)).toEqual({
      line: 55,
      basis: 'class="button button-quiet"',
    })
  })

  it('honours the tag and the closest occurrence', () => {
    // Same class on a different tag is not a match.
    expect(matchSourceLine(text, { tag: 'button', classes: ['button-quiet'] }, 43)).toBeNull()
    // The second CTA shares the tag but not the classes.
    expect(matchSourceLine(text, { tag: 'a', classes: [], attrs: { href: '/agent' } }, 43)).toEqual(
      {
        line: 59,
        basis: 'href="/agent"',
      },
    )
  })

  it('replaces an enclosing location with the matched line, keeping the original', () => {
    const input = {
      source: { file, line: 43, column: 0, enclosing: true },
      element: anchor,
      components: [{ file }],
    }
    expect(resolveElementSource(input, { file, text }, ROOT)).toEqual({
      file,
      line: 55,
      column: null,
      compiledLine: 43,
      matched: 'class="button button-quiet"',
    })
  })

  it('keeps a location that already points at the element', () => {
    const input = {
      source: { file, line: 55, column: 8, enclosing: false },
      element: anchor,
      components: [{ file }],
    }
    expect(resolveElementSource(input, { file, text }, ROOT)).toMatchObject({
      line: 55,
      column: 8,
      matched: null,
    })
  })

  it('falls back to the innermost component file when Svelte recorded nothing', () => {
    const input = { source: null, element: anchor, components: [{ file }] }
    expect(resolveElementSource(input, { file, text }, ROOT)).toMatchObject({
      file,
      line: 55,
      matched: 'class="button button-quiet"',
    })
  })

  it('reports the location note in the markdown and marks the right source line', () => {
    const input = {
      source: { file, line: 43, column: 0, enclosing: true },
      element: anchor,
      components: [],
    }
    const out = formatSelection(input as unknown as Payload, { file, text }, {}, ROOT)
    expect(out).toContain('- markup: `src/routes/dashboard/+page.svelte:55`')
    expect(out).toContain(
      '- location note: line matched by `class="button button-quiet"`; Svelte recorded the enclosing element at `src/routes/dashboard/+page.svelte:43`',
    )
    expect(out).toContain('> 55 |         <a class="button button-quiet" href="/files">')
  })
})

describe('summarizeValue / summarizeProps', () => {
  it('keeps small values readable', () => {
    expect(summarizeValue('false')).toBe('false')
    expect(summarizeValue('"Seu espaço"')).toBe('"Seu espaço"')
    expect(summarizeValue('{"editing":false}')).toBe('{editing: false}')
    expect(summarizeValue('{"last-active":1}')).toBe('{"last-active": 1}')
  })

  it('keeps the values of a small object, which is what explains the component', () => {
    const health = JSON.stringify({
      status: 'ok',
      service: 'web',
      database: 'ok',
      uptimeSeconds: 1234,
      latencyMs: 12,
      timestamp: '2026-11-05T09:47:48.222Z',
    })
    expect(summarizeValue(health)).toBe(
      '{status: "ok", service: "web", database: "ok", uptimeSeconds: 1234, latencyMs: 12, timestamp: "2026-11-05T09:47:48.222Z"}',
    )
    // nested objects and lists are inlined too
    expect(summarizeValue('{"a": {"b": 1}, "c": [1, 2]}')).toBe('{a: {b: 1}, c: [1, 2]}')
  })

  it('summarises values past the budget instead of dumping them', () => {
    // six keys with long strings do not fit: structure only
    const wide = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(key => [key, 'x'.repeat(40)]),
    )
    expect(summarizeValue(JSON.stringify(wide))).toBe('{a, b, c, d, e, f}')
    // a long list of numbers still inlines its first items
    const list = Array.from({ length: 60 }, (_, index) => index)
    expect(summarizeValue(JSON.stringify(list))).toBe('[0, 1, 2, 3, 4, 5, …54 more]')
    // wide records do not fit: structure only
    const records = Array.from({ length: 60 }, (_, index) => ({
      a: 'x'.repeat(40) + index,
      b: 'x'.repeat(40) + index,
      c: 'x'.repeat(40) + index,
      d: 'x'.repeat(40) + index,
      e: 'x'.repeat(40) + index,
      f: 'x'.repeat(40) + index,
    }))
    expect(summarizeValue(JSON.stringify(records))).toBe('[60 items]')
    // six items inline, a note for the rest
    const rows = Array.from({ length: 9 }, (_, index) => ({ id: index }))
    expect(summarizeValue(JSON.stringify(rows))).toContain('…3 more')
  })

  it('renders props as name=value pairs, dropping the $$slots plumbing', () => {
    const props = JSON.stringify({
      title: 'Welcome back.',
      compact: true,
      children: '() => {…}',
      $$slots: { default: true },
      data: { locale: 'pt', user: { id: 'x'.repeat(200) } },
    })
    expect(summarizeProps(props)).toBe(
      'title="Welcome back.", compact=true, children="() => {…}", data={locale: "pt", user: {id: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…"}}',
    )
  })
})

describe('formatSelection', () => {
  it('reports location, DOM path and the component chain with state', () => {
    const text = formatSelection(payload, source, {}, ROOT)
    // Identification only: tag, id and authored classes (no `svelte-xxxx`).
    expect(text).toContain('### Selected element button#save.primary')
    expect(text).toContain('- markup: `src/lib/components/Form.svelte:12:2`')
    expect(text).toContain('- DOM path: `main > form > button#save.primary`')
    expect(text).toContain('- attributes: id="save" type="submit"')
    expect(text).toContain('<button id="save" class="primary" type="submit">Save</button>')
    expect(text).toContain('- <Form /> at `src/routes/settings/+page.svelte:8:2`')
    expect(text).toContain('- {#if} at `src/routes/settings/+page.svelte:6:0`')
    expect(text).toContain('1. Form — `src/lib/components/Form.svelte`')
    expect(text).toContain('  - rendered by `src/routes/settings/+page.svelte:8:2`')
    expect(text).toContain('  - renders: 3')
    expect(text).toContain('  - props: title="Profile"')
    expect(text).toContain('  - $state saving = false')
    expect(text).toContain('  - $derived label = "Save"')
    expect(text).toContain('2. SettingsPage — `src/routes/settings/+page.svelte`')
    expect(text).toContain('Source of `src/lib/components/Form.svelte`:')
    expect(text).toContain('```svelte')
  })

  it('labels the component that defines the markup when another one renders it', () => {
    // `{@render children()}`: Svelte attributes the DOM to the rendering
    // component, so the chain starts at AuthShell while the file is the page's.
    const split = {
      ...payload,
      source: {
        file: `${ROOT}/src/routes/login/+page.svelte`,
        line: 41,
        column: 6,
        enclosing: false,
      },
      components: [
        {
          id: 2,
          name: 'AuthShell',
          file: `${ROOT}/src/lib/components/AuthShell.svelte`,
          usage: {
            file: `${ROOT}/src/routes/login/+page.svelte`,
            line: 27,
            column: 0,
            componentTag: 'AuthShell',
          },
          props: null,
          state: [],
          renders: 1,
        },
        {
          id: 3,
          name: '+page',
          file: `${ROOT}/src/routes/login/+page.svelte`,
          usage: null,
          props: null,
          state: [],
          renders: 1,
        },
      ],
    }
    const out = formatSelection(split, null, {}, ROOT)
    expect(out).toContain(
      '1. AuthShell — `src/lib/components/AuthShell.svelte` — renders the markup',
    )
    expect(out).toContain('2. +page — `src/routes/login/+page.svelte` — defines the markup')
    // a normal chain stays unannotated
    expect(formatSelection(payload, null, {}, ROOT)).not.toContain('defines the markup')
  })

  it('drops the parts the user turned off', () => {
    const text = formatSelection(
      payload,
      source,
      {
        state: false,
        props: false,
        source: false,
        template: false,
      },
      ROOT,
    )
    expect(text).not.toContain('$state saving')
    expect(text).not.toContain('  - props:')
    expect(text).not.toContain('Template context')
    expect(text).not.toContain('Source of')
    expect(text).toContain('1. Form')
  })

  it('drops frames and instances from installed packages', () => {
    const noisy: Payload = {
      ...payload,
      template: [
        ...payload.template,
        {
          type: 'component',
          file: `${ROOT}/node_modules/.pnpm/@sveltejs+kit/node_modules/@sveltejs/kit/src/runtime/components/root.svelte`,
          line: 38,
          column: 3,
          componentTag: 'Component',
        },
      ],
      components: [
        ...payload.components,
        {
          id: 9,
          name: 'root',
          file: `${ROOT}/node_modules/.pnpm/@sveltejs+kit/node_modules/@sveltejs/kit/src/runtime/components/root.svelte`,
          usage: null,
          props: null,
          state: [],
          renders: 1,
        },
      ],
    }
    const text = formatSelection(noisy, null, {}, ROOT)
    expect(text).not.toContain('node_modules')
    expect(text).toContain('2. SettingsPage')
  })

  it('tolerates an empty payload', () => {
    const text = formatSelection({} as Payload, null, {}, ROOT)
    expect(text).toContain('### Selected element element')
  })
})

describe('buildPrompt', () => {
  it('wraps the selections in page context and the user request', () => {
    const text = buildPrompt(
      [{ payload, source }],
      { instructions: 'Make the Save button sticky.' },
      { root: ROOT, plugin: 'vite-devtools-svelte prompt toolbar' },
    )
    expect(text).toContain('# UI context from the running app')
    expect(text).toContain('Page: `http://localhost:3000/settings` (Settings)')
    expect(text).toContain('Viewport: 1440×900')
    expect(text).toContain('## What I need')
    expect(text).toContain('Make the Save button sticky.')
    expect(text).toContain('## Selection')
    expect(text).toContain('### Selected element button#save.primary')
  })

  it('asks for instructions when the panel is empty', () => {
    const text = buildPrompt([{ payload, source }], {}, { root: ROOT })
    expect(text).toContain('(no instructions added')
  })

  it('separates several selections', () => {
    const text = buildPrompt(
      [
        { payload, source },
        { payload, source },
      ],
      {},
      { root: ROOT },
    )
    expect(text.match(/### Selected element/g)).toHaveLength(2)
    expect(text).toContain('\n---\n')
  })
})
