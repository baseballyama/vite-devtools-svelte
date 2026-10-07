import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { FpsSample } from '../lib/types.js'
import { settle } from '../test/dom.js'
import FpsMonitor from './FpsMonitor.svelte'

/** One sample per 500 ms ending at `end`, with the given frame rates. */
function samples(fps: number[], end = 100_000): FpsSample[] {
  return fps.map((f, i) => ({ timestamp: end - (fps.length - 1 - i) * 500, fps: f }))
}

/** The `<dd>` values of a stats list, by their `<dt>` label. */
function stats(root: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const dt of root.querySelectorAll('dt'))
    out[dt.textContent.trim()] = dt.nextElementSibling!.textContent.trim()
  return out
}

afterEach(() => {
  vi.useRealTimers()
})

describe('FpsMonitor', () => {
  it('shows a waiting state, then the empty state when no samples arrive', async () => {
    let answer!: (v: FpsSample[]) => void
    vi.mocked(rpc.getFps).mockReturnValue(
      new Promise(r => {
        answer = r
      }),
    )
    render(FpsMonitor)
    expect(screen.getByRole('status').textContent).toContain('Waiting for frames')
    answer([])
    await settle()
    expect(screen.getByRole('status').textContent).toContain('No frame samples yet')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows a failed load as an error, not as "No frame samples yet"', async () => {
    vi.mocked(rpc.getFps).mockRejectedValue(new Error('RPC down'))
    render(FpsMonitor)
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('RPC down')
    expect(screen.queryByText('No frame samples yet')).toBeNull()
  })

  it('draws drops reported in the same millisecond by two tabs', async () => {
    vi.mocked(rpc.getFps).mockResolvedValue([
      { timestamp: 100_000, fps: 20 },
      { timestamp: 100_000, fps: 25 },
    ])
    const { container } = render(FpsMonitor)
    await settle()
    expect(container.querySelectorAll('line.drop')).toHaveLength(2)
  })

  it('renders the current rate, window stats and the chart', async () => {
    vi.mocked(rpc.getFps).mockResolvedValue(samples([60, 58, 20, 40, 59]))
    const { container } = render(FpsMonitor)
    await settle()
    expect(container.querySelector('.big')!.textContent).toBe('59')
    expect(container.querySelector('.big')!.classList.contains('green')).toBe(true)
    expect(stats(container.querySelector('.top')!)).toEqual({
      Min: '20',
      '1% low': '20',
      Avg: '47',
      Max: '60',
      'Drops <30': '1',
    })
    const chart = screen.getByRole('img', { name: 'Frame rate over the last 30 seconds' })
    expect(chart.querySelector('path.line')).not.toBeNull()
    expect(chart.querySelector('path.area')).not.toBeNull()
    // One drop marker per sample under 30 fps.
    expect(chart.querySelectorAll('line.drop')).toHaveLength(1)
  })

  it('colours the current rate by tone and draws no line for a single sample', async () => {
    vi.mocked(rpc.getFps).mockResolvedValue(samples([35]))
    const { container } = render(FpsMonitor)
    await settle()
    expect(container.querySelector('.big')!.classList.contains('yellow')).toBe(true)
    expect(container.querySelector('path.line')).toBeNull()
    expect(container.querySelector('path.area')).toBeNull()
  })

  it('narrows the stats to the chosen time window', async () => {
    const user = userEvent.setup()
    // The last 15 s (31 samples, both ends included) run at 60 fps; older ones at 10.
    const data = samples([
      ...Array.from({ length: 31 }, () => 10),
      ...Array.from({ length: 31 }, () => 60),
    ])
    vi.mocked(rpc.getFps).mockResolvedValue(data)
    const { container } = render(FpsMonitor)
    await settle()
    expect(stats(container.querySelector('.top')!).Min).toBe('10')

    const windows = screen.getByRole('radiogroup', { name: 'Time window' })
    await user.click(within(windows).getByRole('radio', { name: '15 s' }))
    expect(within(windows).getByRole('radio', { name: '15 s' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(stats(container.querySelector('.top')!).Min).toBe('60')
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Frame rate over the last 15 seconds',
    )
    expect(container.querySelector('.red')).toBeNull()
  })

  it('records a window and summarises it after stopping', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getFps).mockResolvedValue(samples([60, 60], 100_000))
    const { container } = render(FpsMonitor)
    await settle()

    await user.click(screen.getByRole('button', { name: 'Record' }))
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy()
    expect(container.textContent).toContain('● REC')
    // The recording region spans from the start to the right edge while recording.
    expect(container.querySelector('rect.region')).toBeNull()

    vi.mocked(rpc.getFps).mockResolvedValue([
      ...samples([60, 60], 100_000),
      ...samples([50, 20, 45], 101_500),
    ])
    await user.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(container.querySelector('rect.region')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Recording result' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    const result = screen.getByRole('region', { name: 'Recording result' })
    expect(result.textContent).toContain('Recording · 1.5 s · 4 samples')
    expect(stats(result)).toEqual({
      Min: '20',
      '1% low': '20',
      Avg: '44',
      Max: '60',
      'Drops <30': '1',
    })
    expect(container.textContent).not.toContain('● REC')
  })

  it('clears samples on the server and locally', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getFps).mockResolvedValue(samples([60, 61]))
    render(FpsMonitor)
    await settle()
    await user.click(screen.getByRole('button', { name: 'Record' }))
    vi.mocked(rpc.getFps).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    await settle()
    expect(rpc.clearFps).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toContain('No frame samples yet')
    // Recording state is reset too.
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
  })

  it('still clears locally when the server clear fails', async () => {
    const user = userEvent.setup()
    vi.mocked(rpc.getFps).mockResolvedValue(samples([60]))
    vi.mocked(rpc.clearFps).mockRejectedValue(new Error('down'))
    render(FpsMonitor)
    await settle()
    await user.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    await settle()
    expect(screen.getByRole('status').textContent).toContain('No frame samples yet')
  })

  it('polls twice a second while live and stops when paused', async () => {
    vi.useFakeTimers()
    let version = 0
    vi.mocked(rpc.getVersions).mockImplementation(() =>
      Promise.resolve({
        components: 0,
        renderProfiles: 0,
        loadProfiles: 0,
        stateTimeline: 0,
        reactiveGraph: 0,
        errors: 0,
        fps: ++version,
      }),
    )
    vi.mocked(rpc.getFps).mockResolvedValue(samples([60]))
    render(FpsMonitor)
    await vi.advanceTimersByTimeAsync(0)
    const calls = vi.mocked(rpc.getFps).mock.calls.length
    await vi.advanceTimersByTimeAsync(1100)
    expect(vi.mocked(rpc.getFps).mock.calls.length).toBeGreaterThan(calls)

    const live = screen.getByRole('button', { name: 'Live' })
    expect(live.getAttribute('aria-pressed')).toBe('true')
    live.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByRole('button', { name: 'Paused' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    const paused = vi.mocked(rpc.getFps).mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(rpc.getFps).mock.calls.length).toBe(paused)
  })
})
