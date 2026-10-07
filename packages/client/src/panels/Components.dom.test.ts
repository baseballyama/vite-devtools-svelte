import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reactiveScope } from '../lib/reactive-selection.svelte.js'
import { router } from '../lib/router.svelte.js'
import * as rpc from '../lib/rpc.js'
import type { ComponentInstance, ComponentRelation, LiveComponentsMeta } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import Components from './Components.svelte'

const c = (
  id: number,
  name: string,
  parentId: number | null,
  file = `src/lib/${name}.svelte`,
  mounted = true,
): ComponentInstance => ({ id, name, parentId, file, mounted })

// App > Layout > Page > (Row, Row)
const instances: ComponentInstance[] = [
  c(1, 'App', null, 'src/App.svelte'),
  c(2, 'Layout', 1, 'src/routes/+layout.svelte'),
  c(3, 'Page', 2, 'src/routes/+page.svelte'),
  c(4, 'Row', 3),
  c(5, 'Row', 3),
]

const relations: ComponentRelation[] = [
  {
    file: 'src/routes/+page.svelte',
    name: 'Page',
    imports: ['src/lib/Row.svelte', 'src/lib/Icon.svelte'],
  },
  { file: 'src/lib/Row.svelte', name: 'Row', imports: [] },
  { file: 'src/App.svelte', name: 'App', imports: ['src/routes/+page.svelte'] },
]

const meta = (over: Partial<LiveComponentsMeta> = {}): LiveComponentsMeta => ({
  total: 5,
  kept: 5,
  truncated: false,
  epoch: 'e1',
  epochs: 1,
  ...over,
})

const tree = () => screen.getByRole('tree', { name: 'Mounted component tree' })
const items = () => within(tree()).queryAllByRole('treeitem')
const labels = () => items().map(r => r.querySelector('.tag')?.textContent?.trim())
const row = (name: string, n = 0) =>
  items().filter(r => r.querySelector('.tag')?.textContent?.trim() === `<${name}>`)[n]!

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }))
  vi.mocked(rpc.getLiveComponents).mockResolvedValue(instances)
  vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue(meta())
  vi.mocked(rpc.getComponentRelations).mockResolvedValue(relations)
  reactiveScope.set(null)
})

describe('Components: live tree', () => {
  it('renders the mounted tree with the first levels open and ARIA tree attributes', async () => {
    render(Components)
    await settle()
    expect(labels()).toEqual(['<App>', '<Layout>', '<Page>', '<Row>', '<Row>'])
    const page = row('Page')
    expect(page.getAttribute('aria-level')).toBe('3')
    expect(page.getAttribute('aria-expanded')).toBe('true')
    const second = row('Row', 1)
    expect(second.getAttribute('aria-level')).toBe('4')
    expect(second.getAttribute('aria-posinset')).toBe('2')
    expect(second.getAttribute('aria-setsize')).toBe('2')
    expect(second.hasAttribute('aria-expanded')).toBe(false)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('5')
  })

  it('collapses and expands all', async () => {
    render(Components)
    await settle()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(labels()).toEqual(['<App>'])
    // Collapsed branches show their child count.
    expect(row('App').querySelector('.kids')?.textContent).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(labels()).toHaveLength(5)
  })

  it('navigates with the keyboard: ← collapses, → expands', async () => {
    render(Components)
    await settle()
    tree().focus()
    await userEvent.keyboard('{ArrowDown}') // select App
    expect(row('App').getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{ArrowLeft}')
    expect(labels()).toEqual(['<App>'])
    await userEvent.keyboard('{ArrowRight}')
    expect(labels()).toContain('<Layout>')
  })

  it('filters instances by name or file', async () => {
    render(Components)
    await settle()
    const search = screen.getByRole('searchbox', { name: 'Filter' })
    expect(search.getAttribute('placeholder')).toBe('Filter instances…')
    await userEvent.type(search, 'Row')
    // Ancestors of matches stay as context.
    expect(labels()).toContain('<Row>')
    expect(screen.getByText('2', { selector: '.hits' })).toBeTruthy()
    await userEvent.clear(search)
    await userEvent.type(search, 'nothing-like-this')
    expect(screen.getByText('No instances match “nothing-like-this”')).toBeTruthy()
  })

  it('inspects an instance: ancestors, children, imports, editor and reactivity', async () => {
    render(Components)
    await settle()
    await userEvent.click(row('Page'))
    await settle()
    const aside = screen.getByRole('complementary', { name: '<Page> details' })
    expect(within(aside).getByText('mounted')).toBeTruthy()
    expect(within(aside).getByText('#3')).toBeTruthy()
    // Ancestors breadcrumb.
    expect(within(aside).getByRole('button', { name: 'App' })).toBeTruthy()
    expect(within(aside).getByRole('button', { name: 'Layout' })).toBeTruthy()
    // Children and static imports (relations load once something is selected).
    expect(within(aside).getAllByRole('button', { name: /^Row\s*#\d$/ })).toHaveLength(2)
    expect(within(aside).getByRole('button', { name: /^Icon/ })).toBeTruthy()

    await userEvent.click(within(aside).getByRole('button', { name: /^Icon/ }))
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/lib/Icon.svelte')
    await userEvent.click(within(aside).getByRole('button', { name: 'Open in editor' }))
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/routes/+page.svelte')

    // Reveal an ancestor from the breadcrumb.
    await userEvent.click(within(aside).getByRole('button', { name: 'Layout' }))
    await settle()
    expect(row('Layout').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('complementary', { name: '<Layout> details' })).toBeTruthy()
  })

  it('reveals a child from the inspector', async () => {
    render(Components)
    await settle()
    await userEvent.click(row('Page'))
    await userEvent.click(screen.getAllByRole('button', { name: /^Row\s*#5$/ })[0]!)
    await settle()
    expect(row('Row', 1).getAttribute('aria-selected')).toBe('true')
  })

  it('"Show reactivity" scopes the Reactivity panel to the instance and navigates there', async () => {
    render(Components)
    await settle()
    await userEvent.click(row('Row'))
    await userEvent.click(screen.getByRole('button', { name: 'Show reactivity' }))
    expect(reactiveScope.current).toEqual({
      componentId: 4,
      epoch: 'e1',
      label: '<Row>',
      file: 'src/lib/Row.svelte',
    })
    expect(router.current).toBe('reactive')
    expect(location.hash).toBe('#/reactive')
    router.go('components')
  })

  it('waits for a consistent snapshot when the page load changed mid-read', async () => {
    vi.mocked(rpc.getLiveComponentsMeta)
      .mockResolvedValueOnce(meta({ epoch: 'e1' }))
      .mockResolvedValueOnce(meta({ epoch: 'e2' }))
      // The refetch that follows sees a settled page load.
      .mockResolvedValue(meta({ epoch: 'e2' }))
    render(Components)
    await settle()
    // The flipped snapshot is refetched right away.
    expect(vi.mocked(rpc.getLiveComponents).mock.calls.length).toBeGreaterThanOrEqual(2)
    await userEvent.click(row('Row'))
    expect(screen.getByRole('button', { name: 'Show reactivity' })).toBeTruthy()
  })

  it('keeps the selection on the same instance when a sibling unmounts', async () => {
    render(Components)
    await settle()
    await userEvent.click(row('Row', 1)) // #5
    expect(screen.getByRole('complementary', { name: '<Row> details' }).textContent).toContain('#5')
    // #4 goes away: #5 becomes the first <Row>, its path key shifts.
    vi.mocked(rpc.getLiveComponents).mockResolvedValue(instances.filter(i => i.id !== 4))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(labels()).toEqual(['<App>', '<Layout>', '<Page>', '<Row>'])
    expect(row('Row').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('complementary', { name: '<Row> details' }).textContent).toContain('#5')
  })

  it('Enter opens the selected instance in the editor', async () => {
    render(Components)
    await settle()
    tree().focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/App.svelte')
  })

  it('"N mounted instances" jumps to the file in Files mode', async () => {
    render(Components)
    await settle()
    await userEvent.click(row('Row'))
    await settle()
    await userEvent.click(screen.getByRole('button', { name: '2 mounted instances' }))
    await settle()
    expect(screen.getByRole('radio', { name: 'Files' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('complementary', { name: 'Row details' })).toBeTruthy()
  })

  it('shows unmounted instances and detached subtrees', async () => {
    vi.mocked(rpc.getLiveComponents).mockResolvedValue([
      c(1, 'App', null, 'src/App.svelte', false),
      c(7, 'Orphan', 99),
    ])
    vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue(
      meta({ total: 10, kept: 2, truncated: true }),
    )
    render(Components)
    await settle()
    expect(row('App').querySelector('.tag.dim')).toBeTruthy()
    expect(within(row('Orphan')).getByText('detached')).toBeTruthy()
    const notice = String(
      screen.getAllByRole('status').find(s => s.textContent?.includes('Showing'))?.textContent,
    )
    expect(notice).toMatch(/Showing\s+parents first\s+2\s+of\s+10/)
    expect(notice).toContain('detached')
    await userEvent.click(row('App'))
    const aside = screen.getByRole('complementary', { name: '<App> details' })
    expect(within(aside).getByText('unmounted')).toBeTruthy()
    // Only mounted instances can scope Reactivity.
    expect(within(aside).queryByRole('button', { name: /Show reactivity/ })).toBeNull()
    expect(within(aside).getByRole('button', { name: '1 mounted instance' })).toBeTruthy()
  })

  it('shows an empty state with a way to the files view', async () => {
    vi.mocked(rpc.getLiveComponents).mockResolvedValue([])
    render(Components)
    await settle()
    expect(screen.getByText('No mounted components')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Browse component files instead' }))
    await settle()
    expect(screen.getByRole('listbox', { name: 'Component files' })).toBeTruthy()
  })

  it('shows a read error', async () => {
    vi.mocked(rpc.getLiveComponents).mockRejectedValue(new Error('app gone'))
    render(Components)
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('app gone')
  })

  it('pauses live updates', async () => {
    render(Components)
    await settle()
    await userEvent.click(screen.getByRole('button', { name: /Live/ }))
    expect(screen.getByRole('button', { name: /Paused/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })
})

async function files() {
  render(Components)
  await settle()
  await userEvent.click(screen.getByRole('radio', { name: 'Files' }))
  await settle()
}
const table = () => screen.getByRole('listbox', { name: 'Component files' })
const names = () =>
  within(table())
    .queryAllByRole('option')
    .map(o => o.querySelector('.cname')?.textContent)

describe('Components: files', () => {
  it('lists component files sorted by name, with import / user / mounted counts', async () => {
    await files()
    expect(names()).toEqual(['App', 'Page', 'Row'])
    const rowEl = within(table()).getAllByRole('option')[2]!
    const cells = [...rowEl.querySelectorAll('.end')].map(e => e.textContent)
    // Row: no imports, used by Page, 2 mounted.
    expect(cells).toEqual(['', '1', '2'])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('3')
    // Persisted across reloads.
    expect(localStorage.getItem('svelte-devtools:components:mode')).toBe('"files"')
  })

  it('sorts by a column', async () => {
    await files()
    const imports = screen.getByRole('columnheader', { name: 'Imports' })
    await userEvent.click(within(imports).getByRole('button'))
    expect(imports.getAttribute('aria-sort')).toBe('descending')
    expect(names()).toEqual(['Page', 'App', 'Row'])
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: 'Used by' })).getByRole('button'),
    )
    expect(names()[2]).toBe('App')
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: 'Mounted' })).getByRole('button'),
    )
    expect(names()[0]).toBe('Row')
  })

  it('filters files', async () => {
    await files()
    const search = screen.getByRole('searchbox', { name: 'Filter' })
    expect(search.getAttribute('placeholder')).toBe('Filter components…')
    await userEvent.type(search, 'routes')
    expect(names()).toEqual(['Page'])
    await userEvent.type(search, 'zzz')
    expect(screen.getByText('No components match “routeszzz”')).toBeTruthy()
  })

  it('inspects a file: imports, users, navigation, editor and "Show in tree"', async () => {
    await files()
    await userEvent.click(within(table()).getAllByRole('option')[1]!) // Page
    let aside = screen.getByRole('complementary', { name: 'Page details' })
    expect(within(aside).getByText('Imports')).toBeTruthy()
    // Icon is not an analysed component: open it in the editor.
    await userEvent.click(within(aside).getByRole('button', { name: /^Icon/ }))
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/lib/Icon.svelte')
    // Used by App → select App.
    await userEvent.click(within(aside).getByRole('button', { name: /^App/ }))
    aside = screen.getByRole('complementary', { name: 'App details' })
    expect(within(aside).getByText('Not imported by any component (route or entry).')).toBeTruthy()
    // An import that is a component selects it.
    await userEvent.click(within(aside).getByRole('button', { name: /^\+page/ }))
    await userEvent.click(
      within(screen.getByRole('complementary', { name: 'Page details' })).getByRole('button', {
        name: /^Row/,
      }),
    )
    aside = screen.getByRole('complementary', { name: 'Row details' })
    expect(within(aside).getByText('Imports no other components.')).toBeTruthy()
    await userEvent.click(within(aside).getByRole('button', { name: 'Open in editor' }))
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/lib/Row.svelte')

    await userEvent.click(within(aside).getByRole('button', { name: 'Show in tree' }))
    await settle()
    expect(screen.getByRole('radio', { name: 'Live tree' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(row('Row').getAttribute('aria-selected')).toBe('true')
  })

  it('Enter opens the selected file; close clears the selection', async () => {
    await files()
    table().focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/App.svelte')
    await userEvent.click(screen.getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('re-analyzes on demand', async () => {
    await files()
    const before = vi.mocked(rpc.getComponentRelations).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }))
    await settle()
    expect(vi.mocked(rpc.getComponentRelations).mock.calls.length).toBe(before + 1)
  })

  it('shows analysis errors and the no-files state', async () => {
    vi.mocked(rpc.getComponentRelations).mockRejectedValueOnce(new Error('parse failed'))
    await files()
    expect(screen.getByRole('alert').textContent).toContain('parse failed')
    vi.mocked(rpc.getComponentRelations).mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }))
    await settle()
    expect(screen.getByText('No .svelte files found')).toBeTruthy()
  })
})
