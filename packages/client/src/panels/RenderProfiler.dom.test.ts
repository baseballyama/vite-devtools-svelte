import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { RenderProfile } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import RenderProfiler from './RenderProfiler.svelte'

function profile(p: Partial<RenderProfile> & Pick<RenderProfile, 'componentId'>): RenderProfile {
  return {
    file: 'src/lib/Row.svelte',
    name: 'Row',
    initTime: 1,
    renderCount: 1,
    totalRenderTime: 1,
    lastRenderTime: 1,
    lastRenderAt: 0,
    ...p,
  }
}

const profiles: RenderProfile[] = [
  profile({
    componentId: 1,
    file: 'src/App.svelte',
    name: 'App',
    initTime: 5,
    renderCount: 2,
    totalRenderTime: 40,
    lastRenderTime: 30,
    lastRenderAt: 5_000,
  }),
  profile({
    componentId: 2,
    initTime: 2,
    renderCount: 10,
    totalRenderTime: 50,
    lastRenderTime: 4,
    lastRenderAt: 1_000,
  }),
  profile({
    componentId: 3,
    initTime: 3,
    renderCount: 5,
    totalRenderTime: 10,
    lastRenderTime: 6,
    lastRenderAt: 2_000,
  }),
  profile({
    componentId: 4,
    file: 'src/lib/Icon.svelte',
    name: 'Icon',
    renderCount: 0,
    totalRenderTime: 0,
  }),
]

const list = () => screen.getByRole('listbox', { name: 'Render profiles' })
function names(): string[] {
  return within(list())
    .queryAllByRole('option')
    .map(o => o.querySelector('.cname')!.textContent)
}

let width = 1000
beforeEach(() => {
  width = 1000
  layout(() => ({ width, height: 600 }))
})

describe('RenderProfiler', () => {
  it('shows a waiting state, then the empty state', async () => {
    let answer!: (v: RenderProfile[]) => void
    vi.mocked(rpc.getRenderProfiles).mockReturnValue(
      new Promise(r => {
        answer = r
      }),
    )
    render(RenderProfiler)
    await settle()
    expect(screen.getByRole('status').textContent).toContain('Waiting for render data')
    answer([])
    await settle()
    expect(screen.getByRole('status').textContent).toContain('No renders recorded yet')
  })

  it('folds instances by component file, heaviest total first', async () => {
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    expect(names()).toEqual(['Row', 'App', 'Icon'])
    expect(document.querySelector('.summary')!.textContent).toBe('17 renders · 100 ms')
    const row = within(list()).getAllByRole('option')[0]!
    // Instances, init (sum), renders, avg, total.
    expect([...row.querySelectorAll('.end.num')].map(c => c.textContent)).toEqual([
      '2',
      '5.00 ms',
      '15',
      '4.00 ms',
    ])
    expect(row.querySelector('.total .num')!.textContent).toBe('60.0 ms')
  })

  it('lists every instance when grouped by instance', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    await user.click(screen.getByRole('radio', { name: 'By instance' }))
    expect(names()).toEqual(['Row', 'App', 'Row', 'Icon'])
  })

  it('hides optional columns when narrow and sorts by a column', async () => {
    const user = userEvent.setup()
    width = 500
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Component',
      'Renders',
      'Total',
    ])
    const header = screen.getByRole('columnheader', { name: 'Component' })
    await user.click(within(header).getByRole('button'))
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(names()).toEqual(['App', 'Icon', 'Row'])
    await user.click(
      within(screen.getByRole('columnheader', { name: 'Renders' })).getByRole('button'),
    )
    expect(names()).toEqual(['Row', 'App', 'Icon'])
  })

  it('sorts by the optional columns when wide', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    const sortBy = (name: string) =>
      user.click(within(screen.getByRole('columnheader', { name })).getByRole('button'))
    await sortBy('Inst.')
    expect(names()[0]).toBe('Row')
    await sortBy('Init')
    expect(names()).toEqual(['App', 'Row', 'Icon'])
    await sortBy('Avg')
    expect(names()).toEqual(['App', 'Row', 'Icon'])
    await sortBy('Total')
    expect(screen.getByRole('columnheader', { name: 'Total' }).getAttribute('aria-sort')).toBe(
      'descending',
    )
  })

  it('filters by name or path and reports no match', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    await user.type(screen.getByRole('searchbox'), 'app')
    expect(names()).toEqual(['App'])
    expect(document.querySelector('.cname mark')!.textContent).toBe('App')
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByRole('status').textContent).toContain('No components match')
  })

  it('shows details for the selected row and closes them', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    await user.click(within(list()).getAllByRole('option')[1]!)
    const details = screen.getByRole('complementary', { name: 'App details' })
    expect(details.textContent).toContain('src/App.svelte')
    expect(details.textContent).toContain('1 instance')
    expect(details.textContent).toContain('over frame budget')
    expect(details.textContent).toContain('Share of all render time: 40.0%')
    expect(screen.getByRole('separator', { name: 'Resize panel' })).toBeTruthy()

    await user.click(within(details).getByRole('button', { name: 'Open in editor' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/App.svelte')

    // Row: 2 instances, 4 ms average → "slow".
    await user.click(within(list()).getAllByRole('option')[0]!)
    const row = screen.getByRole('complementary', { name: 'Row details' })
    expect(row.textContent).toContain('2 instances')
    expect(row.textContent).toContain('slow')
    expect(row.textContent).toContain('Init (sum)')

    await user.click(within(row).getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows instance details without a budget badge and with no last render', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    render(RenderProfiler)
    await settle()
    await user.click(screen.getByRole('radio', { name: 'By instance' }))
    await user.click(within(list()).getAllByRole('option')[3]!)
    const details = screen.getByRole('complementary', { name: 'Icon details' })
    expect(details.textContent).not.toContain('instance')
    expect(details.textContent).not.toContain('slow')
    expect(details.textContent).toContain('—')
    // Escape inside the inspector closes it.
    await user.click(within(details).getByRole('button', { name: 'Open in editor' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens the component file on activation', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getRenderProfiles).mockResolvedValue(profiles)
    vi.mocked(rpc.openInEditor).mockRejectedValue(new Error('no editor'))
    render(RenderProfiler)
    await settle()
    await user.dblClick(within(list()).getAllByRole('option')[2]!)
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/lib/Icon.svelte')
  })
})
