import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet, type ComponentProps } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import DataTableHarness from '../test/DataTableHarness.svelte'
import { layout } from '../test/dom.js'
import type { Column } from './types.js'

// A type alias (not an interface) so it satisfies the harness's `Record<string, unknown>`.
type File = {
  name: string
  size: number
  kind: string
}

const files: File[] = [
  { name: 'b.js', size: 300, kind: 'js' },
  { name: 'a.css', size: 100, kind: 'css' },
  { name: 'c.svg', size: 200, kind: 'image' },
]

const columns: Column<File>[] = [
  { id: 'name', label: 'Name', width: '1fr', sort: (a, b) => a.name.localeCompare(b.name) },
  {
    id: 'size',
    label: 'Size',
    width: '80px',
    align: 'end',
    descFirst: true,
    sort: (a, b) => a.size - b.size,
  },
  { id: 'kind', label: 'Kind', width: '80px', minWidth: 500 },
]

type Props = ComponentProps<typeof DataTableHarness<File>>

function setup(width: number, props: Partial<Props> = {}) {
  layout(el => {
    if (el.classList.contains('table')) return { width, height: 400 }
    if (el.classList.contains('viewport')) return { width, height: 300 }
    return { width: 0, height: 0 }
  })
  const onselect = vi.fn()
  // The harness prints one cell per visible column, `|`-joined.
  const result = render(DataTableHarness<File>, {
    items: files,
    columns,
    getKey: (f: File) => f.name,
    label: 'Files',
    onselect,
    ...props,
  })
  return { ...result, onselect }
}

const rows = () => screen.getAllByRole('option').map(o => o.textContent.trim())
const header = (name: string) =>
  screen.getAllByRole('columnheader').find(h => h.textContent.trim() === name)!

describe('DataTable', () => {
  it('renders all columns and rows in data order when wide', () => {
    setup(800)
    // The header row is owned by a table (no orphaned ARIA row).
    const head = screen.getByRole('table', { name: 'Files columns' })
    expect(head.querySelector('[role=row]')).not.toBeNull()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Name',
      'Size',
      'Kind',
    ])
    expect(rows()).toEqual(['b.js|300|js', 'a.css|100|css', 'c.svg|200|image'])
    expect(header('Name').getAttribute('aria-sort')).toBe('none')
    // Unsortable columns have no sort state and no button.
    expect(header('Kind').hasAttribute('aria-sort')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Kind' })).toBeNull()
  })

  it('hides columns below their minimum width', () => {
    setup(400)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Name',
      'Size',
    ])
    expect(rows()).toEqual(['b.js|300', 'a.css|100', 'c.svg|200'])
  })

  it('sorts ascending, then toggles to descending', async () => {
    setup(800)
    const name = screen.getByRole('button', { name: 'Name' })
    expect(name.getAttribute('type')).toBe('button')
    await fireEvent.click(name)
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending')
    expect(rows().map(r => r.split('|')[0])).toEqual(['a.css', 'b.js', 'c.svg'])
    await fireEvent.click(name)
    expect(header('Name').getAttribute('aria-sort')).toBe('descending')
    expect(rows().map(r => r.split('|')[0])).toEqual(['c.svg', 'b.js', 'a.css'])
  })

  it('sorts descending first for columns that ask for it, resetting the other column', async () => {
    setup(800, { sort: { id: 'name', desc: false } })
    await fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    expect(header('Size').getAttribute('aria-sort')).toBe('descending')
    expect(header('Name').getAttribute('aria-sort')).toBe('none')
    expect(rows().map(r => r.split('|')[1])).toEqual(['300', '200', '100'])
    await fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    expect(rows().map(r => r.split('|')[1])).toEqual(['100', '200', '300'])
  })

  it('keeps data order when sorted by an unsortable or unknown column', () => {
    setup(800, { sort: { id: 'kind', desc: true } })
    expect(rows().map(r => r.split('|')[0])).toEqual(['b.js', 'a.css', 'c.svg'])
  })

  it('selects rows and reports the item', async () => {
    const onactivate = vi.fn()
    const { onselect } = setup(800, { onactivate })
    await fireEvent.click(screen.getByText('a.css|100|css'))
    expect(onselect).toHaveBeenCalledWith(files[1])
    await fireEvent.keyDown(screen.getByRole('listbox', { name: 'Files' }), { key: 'Enter' })
    expect(onactivate).toHaveBeenCalledWith(files[1])
  })

  it('works without selection callbacks', async () => {
    setup(800, { onselect: undefined })
    await fireEvent.click(screen.getByText('a.css|100|css'))
    await fireEvent.dblClick(screen.getByText('a.css|100|css'))
    expect(
      screen.getByText('a.css|100|css').closest('[role=option]')!.getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('shows the empty state without rows', () => {
    const empty = createRawSnippet(() => ({ render: () => '<p>No files</p>' }))
    setup(800, { items: [], empty })
    expect(screen.getByText('No files')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
