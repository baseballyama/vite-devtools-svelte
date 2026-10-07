import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { StateTimelineDelta, StateTimelineEntry } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import StateTimeline from './StateTimeline.svelte'

function entry(seq: number, over: Partial<StateTimelineEntry> = {}): StateTimelineEntry {
  return {
    seq,
    id: `s${seq}`,
    name: `count${seq}`,
    componentFile: 'src/lib/Counter.svelte',
    oldValue: seq,
    newValue: seq + 1,
    timestamp: Date.UTC(2026, 0, 1, 12, 0, seq),
    ...over,
  }
}

function delta(changes: StateTimelineEntry[], over: Partial<StateTimelineDelta> = {}) {
  return { cursor: changes.at(-1)?.seq ?? 0, reset: true, changes, ...over }
}

const list = () => screen.getByRole('listbox', { name: 'State changes, newest first' })
const rows = () => within(list()).queryAllByRole('option')

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }))
})

describe('StateTimeline', () => {
  it('shows the empty state before anything changed', async () => {
    render(StateTimeline)
    await settle()
    expect(screen.getByText('No state changes yet')).toBeTruthy()
    expect(screen.getByText('0 signals')).toBeTruthy()
  })

  it('shows a failing RPC as an error, not as an empty timeline', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockRejectedValue(new Error('RPC down'))
    render(StateTimeline)
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('RPC down')
    expect(screen.queryByText('No state changes yet')).toBeNull()
  })

  it('lists changes newest first, with init entries badged', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue(
      delta([entry(1, { oldValue: null, newValue: 'hello' }), entry(2), entry(3, { id: 's1' })]),
    )
    render(StateTimeline)
    await settle()
    const names = rows().map(r => r.querySelector('.name')?.textContent)
    expect(names).toEqual(['count3', 'count2', 'count1'])
    expect(within(rows()[2]!).getByText('init')).toBeTruthy()
    expect(rows()[0]!.querySelector('.old')?.textContent).toBe('3')
    expect(rows()[0]!.querySelector('.new')?.textContent).toBe('4')
    // Two distinct signal ids (s1 twice).
    expect(screen.getByText('2 signals')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('3')
  })

  it('filters by signal, component or value, with a no-match state', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue(
      delta([
        entry(1, { name: 'alpha' }),
        entry(2, { name: 'beta', componentFile: 'src/Other.svelte' }),
      ]),
    )
    render(StateTimeline)
    await settle()
    const search = screen.getByRole('searchbox', { name: 'Filter' })
    await userEvent.type(search, 'Other')
    expect(rows().map(r => r.querySelector('.name')?.textContent)).toEqual(['beta'])
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('No changes match')).toBeTruthy()
  })

  it('opens the inspector on select, goes to definition, and closes', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue(
      delta([entry(1, { name: 'items', oldValue: [1], newValue: [1, 2] })]),
    )
    render(StateTimeline)
    await settle()
    await userEvent.click(rows()[0]!)
    const aside = screen.getByRole('complementary', { name: 'items details' })
    expect(within(aside).getByText('update')).toBeTruthy()
    expect(within(aside).getByText('Before')).toBeTruthy()
    expect(aside.textContent).toContain('src/lib/Counter.svelte')
    await userEvent.click(within(aside).getByRole('button', { name: 'Go to definition' }))
    expect(rpc.openReactiveInEditor).toHaveBeenCalledWith(
      'src/lib/Counter.svelte',
      'items',
      'state',
    )
    await userEvent.click(within(aside).getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('Enter on the selected change opens it in the editor', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue(delta([entry(1), entry(2)]))
    render(StateTimeline)
    await settle()
    list().focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(rpc.openReactiveInEditor).toHaveBeenCalledWith(
      'src/lib/Counter.svelte',
      'count2',
      'state',
    )
  })

  it('clear empties the list and the server buffer', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue(delta([entry(1)]))
    render(StateTimeline)
    await settle()
    expect(rows()).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    await settle()
    expect(rpc.clearStateTimeline).toHaveBeenCalledOnce()
    expect(screen.getByText('No state changes yet')).toBeTruthy()
  })

  it('appends deltas after the cursor and refetches the buffer on a stale cursor', async () => {
    const pulls = vi.mocked(rpc.getStateTimelineDelta)
    pulls.mockResolvedValueOnce(delta([entry(1), entry(2)]))
    render(StateTimeline)
    await settle()
    expect(pulls.mock.lastCall?.[0]).toBeUndefined()

    // Append: only entries after the cursor arrive.
    pulls.mockResolvedValueOnce(delta([entry(3)], { reset: false }))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(pulls).toHaveBeenLastCalledWith(2)
    expect(rows()).toHaveLength(3)

    // Nothing new: the list is kept.
    pulls.mockResolvedValueOnce(delta([], { reset: false, cursor: 3 }))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(rows()).toHaveLength(3)

    // A cursor moving backwards (dev server restarted): refetch everything.
    pulls.mockResolvedValueOnce(delta([entry(1)], { reset: false, cursor: 1 }))
    pulls.mockResolvedValueOnce(delta([entry(1, { name: 'fresh' })]))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(pulls.mock.lastCall?.[0]).toBeUndefined()
    expect(rows().map(r => r.querySelector('.name')?.textContent)).toEqual(['fresh'])

    // A changed server identity also means another timeline.
    pulls.mockResolvedValueOnce({
      ...delta([entry(2)], { reset: true }),
      serverId: 'a',
    } as StateTimelineDelta)
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    pulls.mockResolvedValueOnce({
      ...delta([entry(9)], { reset: false }),
      serverId: 'b',
    } as StateTimelineDelta)
    pulls.mockResolvedValueOnce(delta([entry(4, { name: 'other-server' })]))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(rows().map(r => r.querySelector('.name')?.textContent)).toEqual(['other-server'])
  })

  it('pauses and resumes live updates', async () => {
    render(StateTimeline)
    await settle()
    const live = screen.getByRole('button', { name: /Live/ })
    expect(live.getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(live)
    expect(screen.getByRole('button', { name: /Paused/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('discloses capture limits and an incomplete baseline', async () => {
    vi.mocked(rpc.getCaptureInfo).mockResolvedValue({
      stateTimeline: {
        captured: 500,
        total: 900,
        truncated: true,
        baseline: { complete: false, pendingNodes: 3 },
      },
    })
    render(StateTimeline)
    await settle()
    const statuses = screen.getAllByRole('status').map(s => s.textContent)
    expect(statuses.some(t => t.includes('Sampling baseline: 3 states pending'))).toBe(true)
    expect(statuses.some(t => /Showing\s+500\s+of\s+900/.test(t))).toBe(true)
  })
})
