import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { ModuleGraphData, ModuleNode } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import ModuleGraph from './ModuleGraph.svelte'

function mod(id: string, type: ModuleNode['type'], extra: Partial<ModuleNode> = {}): ModuleNode {
  return { id, file: `/abs${id}`, type, imports: [], importedBy: [], ...extra }
}

const graph: ModuleGraphData = {
  modules: [
    mod('/src/main.ts', 'ts', { imports: ['/src/App.svelte', '/node_modules/x.js'], size: 300 }),
    mod('/src/App.svelte', 'svelte', {
      imports: ['/src/a.js'],
      importedBy: ['/src/main.ts'],
      size: 4096,
    }),
    mod('/src/a.js', 'js', {
      imports: ['/src/b.js'],
      importedBy: ['/src/App.svelte', '/src/b.js'],
      isCyclic: true,
      size: 100,
    }),
    mod('/src/b.js', 'js', { imports: ['/src/a.js'], importedBy: ['/src/a.js'], isCyclic: true }),
    mod('/src/app.css', 'css', { size: 50 }),
  ],
  cycles: [['/src/a.js', '/src/b.js', '/src/a.js']],
}

const list = () => screen.getByRole('listbox', { name: 'Modules' })
function ids(): string[] {
  return within(list())
    .queryAllByRole('option')
    .map(o => o.querySelector('.id')!.textContent)
}

let width = 1000
beforeEach(() => {
  width = 1000
  layout(() => ({ width, height: 600 }))
})

describe('ModuleGraph', () => {
  it('shows a loading state, then the empty state', async () => {
    let answer!: (v: ModuleGraphData) => void
    vi.mocked(rpc.getModuleGraph).mockReturnValue(
      new Promise(r => {
        answer = r
      }),
    )
    render(ModuleGraph)
    await settle()
    expect(screen.getByRole('status').textContent).toContain('Reading module graph')
    answer({ modules: [], cycles: [] })
    await settle()
    expect(screen.getByRole('status').textContent).toContain('No modules transformed yet')
    expect(screen.queryByRole('button', { name: /circular/ })).toBeNull()
  })

  it('reports a failed read as an error', async () => {
    vi.mocked(rpc.getModuleGraph).mockRejectedValue(new Error('RPC get-module-graph failed: boom'))
    render(ModuleGraph)
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not read module graph')
    expect(alert.textContent).toContain('boom')
  })

  it('lists modules by size with type counts', async () => {
    vi.mocked(rpc.getModuleGraph).mockResolvedValue(graph)
    render(ModuleGraph)
    await settle()
    expect(ids()).toEqual([
      '/src/App.svelte',
      '/src/main.ts',
      '/src/a.js',
      '/src/app.css',
      '/src/b.js',
    ])
    const types = screen.getByRole('radiogroup', { name: 'Module type' })
    expect(
      within(types)
        .getAllByRole('radio')
        .map(r => r.textContent.replaceAll(/\s+/g, ' ').trim()),
    ).toEqual(['All 5', 'Svelte 1', 'TS 1', 'JS 2', 'CSS 1'])
    const app = within(list()).getAllByRole('option')[0]!
    expect(app.textContent).toContain('4.0 KB')
    // b.js has no size.
    expect(within(list()).getAllByRole('option')[4]!.textContent).toContain('—')
    expect(
      within(list())
        .getAllByRole('option')[2]!
        .querySelector('[title="Part of a circular import"]'),
    ).not.toBeNull()
  })

  it('filters by type, circular imports and text', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getModuleGraph).mockResolvedValue(graph)
    render(ModuleGraph)
    await settle()
    await user.click(screen.getByRole('radio', { name: /^JS/ }))
    expect(ids()).toEqual(['/src/a.js', '/src/b.js'])
    await user.click(screen.getByRole('radio', { name: /^All/ }))

    const circular = screen.getByRole('button', { name: '1 circular' })
    await user.click(circular)
    expect(circular.getAttribute('aria-pressed')).toBe('true')
    expect(ids()).toEqual(['/src/a.js', '/src/b.js'])
    await user.click(circular)

    await user.type(screen.getByRole('searchbox'), 'main')
    expect(ids()).toEqual(['/src/main.ts'])
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByRole('status').textContent).toContain('No modules match')
  })

  it('sorts by every column', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getModuleGraph).mockResolvedValue(graph)
    render(ModuleGraph)
    await settle()
    const sortBy = (name: string) =>
      user.click(within(screen.getByRole('columnheader', { name })).getByRole('button'))
    await sortBy('Module')
    expect(ids()).toEqual(
      ['/src/a.js', '/src/app.css', '/src/App.svelte', '/src/b.js', '/src/main.ts'].toSorted(
        (a, b) => a.localeCompare(b),
      ),
    )
    await sortBy('Imports')
    expect(ids()[0]).toBe('/src/main.ts')
    await sortBy('Importers')
    expect(ids()[0]).toBe('/src/a.js')
  })

  it('hides the imports column when narrow', async () => {
    width = 500
    vi.mocked(rpc.getModuleGraph).mockResolvedValue(graph)
    render(ModuleGraph)
    await settle()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Module',
      'Importers',
      'Size',
    ])
  })

  it('shows details with cycles and navigates through dependencies', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getModuleGraph).mockResolvedValue(graph)
    render(ModuleGraph)
    await settle()
    // Filter so the next navigation target is hidden: selecting it resets filters.
    await user.click(screen.getByRole('radio', { name: /^JS/ }))
    await user.click(within(list()).getAllByRole('option')[0]!)
    let details = screen.getByRole('complementary', { name: 'a.js details' })
    expect(details.textContent).toContain('circular')
    expect(details.textContent).toContain('Cycle 1')
    const cycle = details.querySelector('ol.cycle')!
    expect([...cycle.querySelectorAll('button')].map(b => b.textContent)).toEqual([
      'a.js',
      'b.js',
      'a.js',
    ])

    // Navigate to an importer outside the current type filter.
    await user.click(within(details).getByRole('button', { name: /App\.svelte/ }))
    details = screen.getByRole('complementary', { name: 'App.svelte details' })
    expect(screen.getByRole('radio', { name: /^All/ }).getAttribute('aria-checked')).toBe('true')
    expect(details.textContent).toContain('Imported by 1')

    // Imports to modules outside the graph are listed but disabled.
    await user.click(within(details).getByRole('button', { name: /main\.ts/ }))
    details = screen.getByRole('complementary', { name: 'main.ts details' })
    const external = within(details).getByRole('button', { name: /x\.js/ })
    expect((external as HTMLButtonElement).disabled).toBe(true)
    expect(details.textContent).toContain('None')

    // Back through the imports to the cycle, then follow the cycle to b.js.
    await user.click(within(details).getByRole('button', { name: /App\.svelte/ }))
    details = screen.getByRole('complementary', { name: 'App.svelte details' })
    await user.click(within(details).getByRole('button', { name: /a\.js/ }))
    details = screen.getByRole('complementary', { name: 'a.js details' })
    const links = details.querySelectorAll<HTMLButtonElement>('ol.cycle button')
    expect(links[0]!.classList.contains('me')).toBe(true)
    await user.click(links[1]!)
    expect(screen.getByRole('complementary', { name: 'b.js details' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('/abs/src/b.js')
    await user.click(screen.getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('caps long dependency lists', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 502 }, (_, i) => `/dep/${i}.js`)
    vi.mocked(rpc.getModuleGraph).mockResolvedValue({
      modules: [mod('/hub.js', 'js', { imports: many })],
      cycles: [],
    })
    render(ModuleGraph)
    await settle()
    await user.click(within(list()).getAllByRole('option')[0]!)
    const details = screen.getByRole('complementary', { name: 'hub.js details' })
    expect(details.textContent).toContain('+2 more')
    expect(details.querySelectorAll('.link-list li')).toHaveLength(500)
  })

  it('opens a module on activation and refreshes on request', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getModuleGraph).mockResolvedValue(graph)
    render(ModuleGraph)
    await settle()
    await user.dblClick(within(list()).getAllByRole('option')[1]!)
    expect(rpc.openInEditor).toHaveBeenCalledWith('/abs/src/main.ts')
    expect(rpc.getModuleGraph).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Refresh module graph' }))
    await settle()
    expect(rpc.getModuleGraph).toHaveBeenCalledTimes(2)
  })
})
