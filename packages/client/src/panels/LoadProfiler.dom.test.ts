import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { LoadProfile } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import LoadProfiler from './LoadProfiler.svelte'

const loads: LoadProfile[] = [
  {
    route: '/blog/[slug]',
    file: 'src/routes/blog/[slug]/+page.server.ts',
    type: 'server',
    duration: 250,
    dataSize: 2048,
    timestamp: 1_000,
  },
  {
    route: '/about',
    file: 'src/routes/about/+page.ts',
    type: 'universal',
    duration: 12,
    dataSize: 100,
    timestamp: 3_000,
  },
  {
    route: '/',
    file: 'src/routes/+page.server.ts',
    type: 'server',
    duration: 40,
    dataSize: 512,
    timestamp: 2_000,
  },
]

/** Route cells of the rendered rows, top to bottom. */
function routes(): string[] {
  const list = screen.getByRole('listbox', { name: 'Load function calls' })
  return within(list)
    .queryAllByRole('option')
    .map(o => o.querySelector('.route')!.textContent)
}

function stat(label: string): string {
  const dt = [...document.querySelectorAll('.stats dt')].find(d => d.textContent === label)
  return dt!.nextElementSibling!.textContent
}

let width = 1000
beforeEach(() => {
  width = 1000
  layout(() => ({ width, height: 600 }))
})

describe('LoadProfiler', () => {
  it('shows the empty state when no load calls were recorded', async () => {
    render(LoadProfiler)
    await settle()
    expect(screen.getByRole('status').textContent).toContain('No load calls recorded yet')
    expect(document.querySelector('.stats')).toBeNull()
  })

  it('shows a failed load as an error, not as an empty list', async () => {
    vi.mocked(rpc.getLoadProfiles).mockRejectedValue(new Error('RPC down'))
    render(LoadProfiler)
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('RPC down')
    expect(screen.queryByText('No load calls recorded yet')).toBeNull()
  })

  it('keeps the selected call selected when the server drops older ones', async () => {
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    const list = screen.getByRole('listbox', { name: 'Load function calls' })
    await userEvent.click(within(list).getByRole('option', { name: /about/ }))
    // The server buffer is bounded: the oldest call falls off the front.
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads.slice(1))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    const selected = within(list).getByRole('option', { selected: true })
    expect(selected.querySelector('.route')!.textContent).toBe('/about')
  })

  it('lists load calls newest first with stats', async () => {
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('3')
    expect(routes()).toEqual(['/about', '/', '/blog/[slug]'])
    expect(stat('Calls')).toBe('3')
    expect(stat('Max')).toBe('250 ms')
    expect(stat('> 100 ms')).toBe('1')
    expect(screen.getByRole('button', { name: /Slow \(1\)/ })).toBeTruthy()
    // Wide enough for the optional Data and At columns.
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Route',
      'Type',
      'Duration',
      'Data',
      'At',
    ])
    expect(screen.getByText('2.0 KB')).toBeTruthy()
  })

  it('hides the optional columns in a narrow layout', async () => {
    width = 500
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Route',
      'Type',
      'Duration',
    ])
    expect(screen.queryByText('2.0 KB')).toBeNull()
  })

  it('sorts by a column, toggling the direction', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    const header = screen.getByRole('columnheader', { name: 'Duration' })
    await user.click(within(header).getByRole('button'))
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(routes()).toEqual(['/blog/[slug]', '/', '/about'])
    await user.click(within(header).getByRole('button'))
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(routes()).toEqual(['/about', '/', '/blog/[slug]'])
  })

  it('sorts by route, type and data size', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    const sortBy = (name: string) =>
      user.click(within(screen.getByRole('columnheader', { name })).getByRole('button'))
    await sortBy('Route')
    expect(routes()).toEqual(['/', '/about', '/blog/[slug]'])
    await sortBy('Type')
    expect(routes().at(-1)).toBe('/about')
    await sortBy('Data')
    expect(screen.getByRole('columnheader', { name: 'Data' }).getAttribute('aria-sort')).toBe(
      'descending',
    )
    expect(routes()).toEqual(['/blog/[slug]', '/', '/about'])
  })

  it('filters by type, slowness and route text', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()

    await user.click(screen.getByRole('radio', { name: 'Universal' }))
    expect(routes()).toEqual(['/about'])
    await user.click(screen.getByRole('radio', { name: 'Server' }))
    expect(routes()).toEqual(['/', '/blog/[slug]'])
    await user.click(screen.getByRole('radio', { name: 'All' }))

    const slow = screen.getByRole('button', { name: /Slow/ })
    await user.click(slow)
    expect(slow.getAttribute('aria-pressed')).toBe('true')
    expect(routes()).toEqual(['/blog/[slug]'])
    await user.click(slow)

    await user.type(screen.getByRole('searchbox'), 'blog')
    expect(routes()).toEqual(['/blog/[slug]'])
    expect(document.querySelector('.route mark')!.textContent).toBe('blog')
    expect(stat('Calls')).toBe('1')

    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(routes()).toEqual([])
    expect(screen.getByRole('status').textContent).toContain('No loads match')
    expect(document.querySelector('.stats')).toBeNull()
  })

  it('opens the load file in the editor on activation', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    const list = screen.getByRole('listbox', { name: 'Load function calls' })
    await user.dblClick(within(list).getAllByRole('option')[0]!)
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/routes/about/+page.ts')
    // Keyboard: select with ↓ and open with Enter.
    await user.keyboard('{ArrowDown}{Enter}')
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/routes/+page.server.ts')
  })

  it('clears load calls on the server and locally', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    render(LoadProfiler)
    await settle()
    vi.mocked(rpc.clearLoadProfiles).mockRejectedValue(new Error('offline'))
    await user.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    await settle()
    expect(rpc.clearLoadProfiles).toHaveBeenCalledOnce()
    expect(routes()).toEqual([])
    expect(screen.getByRole('status').textContent).toContain('No load calls recorded yet')
  })

  it('shows a capture notice when the server cut load calls', async () => {
    vi.mocked(rpc.getLoadProfiles).mockResolvedValue(loads)
    vi.mocked(rpc.getCaptureInfo).mockResolvedValue({
      loadProfiles: { captured: 3, total: 10, truncated: true },
    })
    render(LoadProfiler)
    await settle()
    const notice = screen.getAllByRole('status').find(s => s.textContent.includes('Showing'))!
    expect(notice.textContent.replaceAll(/\s+/g, ' ')).toContain('Showing 3 of 10')
    expect(notice.title).toContain('7 more exist in the app')
  })
})
