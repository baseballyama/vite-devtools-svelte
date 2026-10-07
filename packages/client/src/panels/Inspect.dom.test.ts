import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { InspectResult } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import Inspect from './Inspect.svelte'

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>'

const files: rpc.SvelteFileEntry[] = [
  { file: '/app/src/lib/Card.svelte', name: 'Card' },
  { file: '/app/src/routes/+page.svelte', name: '+page' },
]

// Compiled line 1 ← source 1; compiled 2 and 3 ← source 2.
const card: InspectResult = {
  file: '/app/src/lib/Card.svelte',
  source: `<script>let n = 1</script>\n<p>{n}</p>\n${XSS}`,
  compiled: `import 'svelte'\nconst p = "${XSS}"\n$.template(p)`,
  mappings: 'AAAA;AACA;AAAA',
  sources: ['Card.svelte'],
}

async function setup() {
  const user = userEvent.setup()
  render(Inspect)
  await settle()
  return { user, list: screen.getByRole('listbox', { name: 'Svelte files' }) }
}

async function pick(user: ReturnType<typeof userEvent.setup>, list: HTMLElement, name: string) {
  await user.click(within(list).getByText(name))
  await settle()
}

const pane = (name: 'Source' | 'Compiled JS') =>
  screen.getByRole('region', { name: `${name} code` })
const lines = (region: HTMLElement) => [...region.querySelectorAll<HTMLElement>('.line')]
const highlighted = (region: HTMLElement) =>
  lines(region)
    .filter(l => l.classList.contains('hl'))
    .map(l => Number(l.querySelector('.ln')!.textContent))

/** Only the `.code` container is narrow. */
const narrow = (el: HTMLElement) => ({
  width: el.classList.contains('code') ? 600 : 1200,
  height: 600,
})

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }))
  vi.mocked(rpc.getSvelteFiles).mockResolvedValue(files)
  vi.mocked(rpc.inspectFile).mockResolvedValue(card)
})

describe('Inspect', () => {
  it('lists .svelte files and invites a pick', async () => {
    const { list } = await setup()
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(within(list).getByText('src/lib/Card.svelte')).toBeTruthy()
    expect(screen.getByText('Pick a component')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Compiled output/ }).textContent).toContain('2')
  })

  it('filters files and shows a no-match state', async () => {
    const { user, list } = await setup()
    await user.type(screen.getByRole('searchbox'), 'page')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(within(list).getByText('No files match')).toBeTruthy()
  })

  it('shows "Listing files…" until the file list loads', async () => {
    vi.mocked(rpc.getSvelteFiles).mockReturnValue(new Promise(() => {}))
    const { list } = await setup()
    expect(within(list).getByText('Listing files…')).toBeTruthy()
  })

  it('compiles the picked file and shows source and compiled code side by side', async () => {
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    expect(rpc.inspectFile).toHaveBeenCalledWith('/app/src/lib/Card.svelte')
    expect(screen.getByText('source map')).toBeTruthy()
    expect(screen.getByTitle('/app/src/lib/Card.svelte').textContent).toBe('src/lib/Card.svelte')
    expect(lines(pane('Source'))).toHaveLength(3)
    expect(lines(pane('Compiled JS'))).toHaveLength(3)
    expect(screen.getAllByText('3 lines')).toHaveLength(2)
  })

  it('renders markup in source and compiled code as text, never as elements', async () => {
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    for (const region of [pane('Source'), pane('Compiled JS')]) {
      expect(region.querySelector('img, script')).toBeNull()
      expect(region.textContent).toContain('<img src=x onerror=')
      expect(region.textContent).toContain('<script>alert(2)</script>')
    }
  })

  it('links a clicked source line to its compiled lines, and back', async () => {
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    await user.click(lines(pane('Source'))[1]!)
    expect(highlighted(pane('Source'))).toEqual([2])
    expect(highlighted(pane('Compiled JS'))).toEqual([2, 3])
    // One connector per linked pair in the gutter.
    expect(document.querySelectorAll('.gutter path')).toHaveLength(2)

    await user.click(lines(pane('Compiled JS'))[0]!)
    expect(highlighted(pane('Compiled JS'))).toEqual([1])
    expect(highlighted(pane('Source'))).toEqual([1])
    expect(document.querySelectorAll('.gutter path')).toHaveLength(1)

    // Arrow keys walk the line in the focused pane.
    await fireEvent.keyDown(pane('Compiled JS'), { key: 'ArrowDown' })
    expect(highlighted(pane('Compiled JS'))).toEqual([2])
    expect(highlighted(pane('Source'))).toEqual([2])
  })

  it('stacks the panes in narrow containers and drops the connectors', async () => {
    layout(narrow)
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    await user.click(lines(pane('Source'))[1]!)
    expect(highlighted(pane('Compiled JS'))).toEqual([2, 3])
    expect(document.querySelector('.gutter')).toBeNull()
  })

  it('works without a source map', async () => {
    vi.mocked(rpc.inspectFile).mockResolvedValue({ ...card, mappings: undefined })
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    expect(screen.getByText('no source map')).toBeTruthy()
    await user.click(lines(pane('Source'))[0]!)
    expect(highlighted(pane('Source'))).toEqual([1])
    expect(highlighted(pane('Compiled JS'))).toEqual([])
    await user.click(lines(pane('Compiled JS'))[0]!)
    expect(highlighted(pane('Source'))).toEqual([])
    expect(document.querySelectorAll('.gutter path')).toHaveLength(0)
  })

  it('opens the source in the editor and recompiles', async () => {
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    await user.click(screen.getByRole('button', { name: 'Open source in editor' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('/app/src/lib/Card.svelte')
    await user.click(screen.getByRole('button', { name: 'Recompile' }))
    await settle()
    expect(rpc.inspectFile).toHaveBeenCalledTimes(2)
  })

  it('shows a compile error, then recovers on the next pick', async () => {
    vi.mocked(rpc.inspectFile).mockRejectedValueOnce(new Error('Unexpected token'))
    vi.mocked(rpc.inspectFile).mockRejectedValueOnce('boom')
    const { user, list } = await setup()
    await pick(user, list, 'Card')
    expect(screen.getByRole('alert').textContent).toContain('Unexpected token')
    await pick(user, list, '+page')
    expect(screen.getByRole('alert').textContent).toContain('boom')
    await pick(user, list, 'Card')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(pane('Source')).toBeTruthy()
  })

  it('shows "Compiling…" and keeps only the answer for the latest pick', async () => {
    const pending: ((r: InspectResult) => void)[] = []
    const fail: ((e: Error) => void)[] = []
    vi.mocked(rpc.inspectFile).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          pending.push(resolve)
          fail.push(reject)
        }),
    )
    const { user, list } = await setup()
    await user.click(within(list).getByText('Card'))
    expect(screen.getByText('Compiling…')).toBeTruthy()
    await user.click(within(list).getByText('+page'))
    // The first (stale) answer arrives last and is dropped, success or failure.
    pending[1]!({ ...card, file: '/app/src/routes/+page.svelte', source: 'page', compiled: 'x' })
    await settle()
    pending[0]!(card)
    fail[0]!(new Error('stale'))
    await settle()
    expect(screen.getByTitle('/app/src/routes/+page.svelte')).toBeTruthy()
    expect(lines(pane('Source'))).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops a stale failure', async () => {
    const fail: ((e: Error) => void)[] = []
    vi.mocked(rpc.inspectFile)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail.push(reject)
          }),
      )
      .mockResolvedValueOnce(card)
    const { user, list } = await setup()
    await user.click(within(list).getByText('+page'))
    await pick(user, list, 'Card')
    fail[0]!(new Error('stale'))
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTitle('/app/src/lib/Card.svelte')).toBeTruthy()
  })
})
