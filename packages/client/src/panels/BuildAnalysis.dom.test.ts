import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { BuildAnalysis as Build, BuildChunk } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import BuildAnalysis from './BuildAnalysis.svelte'

function chunk(file: string, size: number, modules: string[], isEntry = false): BuildChunk {
  return { name: file.split('/').pop()!.split('.')[0]!, file, size, modules, isEntry }
}

const build: Build = {
  chunks: [
    chunk('assets/index.js', 300_000, ['src/main.ts', 'src/App.svelte'], true),
    chunk('assets/vendor.mjs', 100_000, ['node_modules/svelte/index.js']),
    chunk('assets/index.css', 50_000, ['src/app.css']),
    chunk('assets/logo.svg', 2_000, []),
  ],
  totalSize: 452_000,
  timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
}

const list = () => screen.getByRole('listbox', { name: 'Build chunks' })
function files(): string[] {
  return within(list())
    .queryAllByRole('option')
    .map(o => o.querySelector('.file')!.textContent)
}

let width = 1000
beforeEach(() => {
  width = 1000
  layout(() => ({ width, height: 600 }))
})

describe('BuildAnalysis', () => {
  it('shows the empty state with a refresh action when there is no build', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue({ chunks: [], totalSize: 0, timestamp: 0 })
    render(BuildAnalysis)
    await settle()
    const empty = screen.getByRole('status')
    expect(empty.textContent).toContain('No build output found')
    expect(screen.queryByText(/^built /)).toBeNull()

    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    await user.click(within(empty).getByRole('button', { name: 'Refresh' }))
    await settle()
    expect(files()).toHaveLength(4)
  })

  it('shows a reading state while the first answer is pending', async () => {
    vi.mocked(rpc.getBuildAnalysis).mockReturnValue(new Promise(() => {}))
    render(BuildAnalysis)
    await settle()
    expect(screen.getByRole('status').textContent).toContain('Reading build output')
  })

  it('lists chunks by size with the bundle composition', async () => {
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    render(BuildAnalysis)
    await settle()
    expect(files()).toEqual([
      'assets/index.js',
      'assets/vendor.mjs',
      'assets/index.css',
      'assets/logo.svg',
    ])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('4')
    const composition = screen.getByRole('group', { name: 'Bundle composition' })
    expect(composition.textContent).toContain('441.4 KB')
    expect(within(composition).getByRole('img').getAttribute('aria-label')).toBe(
      'JS 390.6 KB, CSS 48.8 KB, other 2.0 KB',
    )
    expect(screen.getByText(/^built /)).toBeTruthy()
    const first = within(list()).getAllByRole('option')[0]!
    expect(first.textContent).toContain('entry')
    expect(first.textContent).toContain('66.4%')
    expect(first.querySelector('.big')).not.toBeNull()
    const types = screen.getByRole('radiogroup', { name: 'Chunk type' })
    expect(
      within(types)
        .getAllByRole('radio')
        .map(r => r.textContent.replaceAll(/\s+/g, ' ').trim()),
    ).toEqual(['All', 'JS 2', 'CSS 1', 'Other 1'])
  })

  it('filters by chunk type and by file or module name', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    render(BuildAnalysis)
    await settle()
    await user.click(screen.getByRole('radio', { name: /^CSS/ }))
    expect(files()).toEqual(['assets/index.css'])
    await user.click(screen.getByRole('radio', { name: /^Other/ }))
    expect(files()).toEqual(['assets/logo.svg'])
    await user.click(screen.getByRole('radio', { name: /^JS/ }))
    expect(files()).toEqual(['assets/index.js', 'assets/vendor.mjs'])
    await user.click(screen.getByRole('radio', { name: /^All/ }))

    // Matches a module inside the chunk, not just the file name.
    await user.type(screen.getByRole('searchbox'), 'App.svelte')
    expect(files()).toEqual(['assets/index.js'])
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByRole('status').textContent).toContain('No chunks match')
  })

  it('sorts by every column', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    render(BuildAnalysis)
    await settle()
    const sortBy = (name: string) =>
      user.click(within(screen.getByRole('columnheader', { name })).getByRole('button'))
    await sortBy('Chunk')
    expect(files()[0]).toBe('assets/index.css')
    await sortBy('Modules')
    expect(files()[0]).toBe('assets/index.js')
    await sortBy('Share')
    expect(screen.getByRole('columnheader', { name: 'Share' }).getAttribute('aria-sort')).toBe(
      'descending',
    )
    await sortBy('Share')
    expect(files()[0]).toBe('assets/logo.svg')
  })

  it('hides the optional columns in a narrow layout', async () => {
    width = 500
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    render(BuildAnalysis)
    await settle()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Chunk',
      'Size',
    ])
  })

  it('shows the modules of the selected chunk and closes the details', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    render(BuildAnalysis)
    await settle()
    await user.type(screen.getByRole('searchbox'), 'main')
    await user.click(within(list()).getAllByRole('option')[0]!)
    const details = screen.getByRole('complementary', { name: 'index.js details' })
    expect(details.textContent).toContain('Modules 2')
    expect(details.textContent).toContain('entry')
    expect([...details.querySelectorAll('.mods li')].map(li => li.textContent)).toEqual([
      'src/main.ts',
      'src/App.svelte',
    ])
    expect(details.querySelector('.mods mark')!.textContent).toBe('main')
    await user.click(within(details).getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()

    await user.clear(screen.getByRole('searchbox'))
    await user.click(within(list()).getAllByRole('option')[3]!)
    const svg = screen.getByRole('complementary', { name: 'logo.svg details' })
    expect(svg.textContent).not.toContain('entry')
  })

  it('re-reads the build output on request', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getBuildAnalysis).mockResolvedValue(build)
    render(BuildAnalysis)
    await settle()
    await user.click(screen.getByRole('button', { name: 'Re-read build output' }))
    await settle()
    expect(rpc.getBuildAnalysis).toHaveBeenCalledTimes(2)
  })
})
