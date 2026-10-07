import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet, flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import type { IconName } from '../lib/icons.js'
import { fakeResource } from '../test/fake-resource.svelte.js'
import Badge from './Badge.svelte'
import Button from './Button.svelte'
import CaptureNotice from './CaptureNotice.svelte'
import EmptyState from './EmptyState.svelte'
import Highlight from './Highlight.svelte'
import Icon from './Icon.svelte'
import Inspector from './Inspector.svelte'
import LiveControls from './LiveControls.svelte'
import Panel from './Panel.svelte'

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }))

/** Markup a malicious source or value could carry; must only ever show up as text. */
const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>'

describe('Button', () => {
  it('defaults to type="button" and names icon-only buttons by their label', async () => {
    const onclick = vi.fn()
    render(Button, { icon: 'refresh', label: 'Refresh', onclick })
    const button = screen.getByRole('button', { name: 'Refresh' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.title).toBe('Refresh')
    expect(button.hasAttribute('aria-pressed')).toBe(false)
    await fireEvent.click(button)
    expect(onclick).toHaveBeenCalledOnce()
  })

  it('uses its text as the name, keeps an explicit type, title and pressed state', () => {
    render(Button, {
      children: html('<span>Save</span>'),
      type: 'submit',
      title: 'Save changes',
      label: 'ignored',
      pressed: true,
      variant: 'primary',
    })
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('type')).toBe('submit')
    expect(button.title).toBe('Save changes')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.hasAttribute('aria-label')).toBe(false)
    expect(button.querySelector('svg')).toBeNull()
  })

  it('does not fire when disabled', async () => {
    const onclick = vi.fn()
    render(Button, { icon: 'trash', label: 'Clear', disabled: true, onclick })
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onclick).not.toHaveBeenCalled()
  })
})

describe('Badge', () => {
  it('renders its content with a tone and title', () => {
    render(Badge, { tone: 'red', title: 'Errors', children: html('<span>3</span>') })
    const badge = screen.getByTitle('Errors')
    expect(badge.textContent).toBe('3')
    expect(badge.classList.contains('red')).toBe(true)
  })

  it('defaults to the neutral tone', () => {
    render(Badge, { children: html('<span>n</span>') })
    expect(screen.getByText('n').parentElement!.classList.contains('neutral')).toBe(true)
  })
})

describe('Icon', () => {
  it('renders a decorative svg of the given size', () => {
    const { container } = render(Icon, { name: 'search', size: 20, class: 'extra' })
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.classList.contains('extra')).toBe(true)
    expect(svg.children.length).toBeGreaterThan(0)
  })

  it('renders an empty svg for an unknown name instead of crashing', () => {
    const { container } = render(Icon, { name: 'no-such-icon' as IconName })
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.children).toHaveLength(0)
  })
})

describe('EmptyState', () => {
  it('is a status message with optional body', () => {
    render(EmptyState, { icon: 'routes', title: 'No routes', children: html('<p>Add one</p>') })
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('No routes')
    expect(status.textContent).toContain('Add one')
    expect(status.querySelector('svg')).not.toBeNull()
  })

  it('with an error it is an alert showing the message, with the error icon', () => {
    render(EmptyState, { title: 'Failed', error: 'ENOENT', children: html('<p>Retry</p>') })
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('.mono')!.textContent).toBe('ENOENT')
    expect(alert.textContent).toContain('Retry')
    expect(alert.querySelector('svg')).not.toBeNull()
  })

  it('an empty error is still an alert, without a message line', () => {
    render(EmptyState, { title: 'Failed', error: '' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent.trim()).toBe('Failed')
    expect(alert.querySelector('.mono')).toBeNull()
  })
})

describe('Panel', () => {
  it('is a labelled region with a heading, count, toolbar and actions', () => {
    render(Panel, {
      title: 'Routes',
      count: 12,
      toolbar: html('<input aria-label="Filter routes">'),
      actions: html('<button type="button">Refresh</button>'),
      children: html('<p>Body</p>'),
    })
    const region = screen.getByRole('region', { name: 'Routes' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Routes')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('12')
    expect(region.contains(screen.getByRole('textbox', { name: 'Filter routes' }))).toBe(true)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    expect(screen.getByText('Body').closest('.body')!.classList.contains('scroll')).toBe(false)
  })

  it('omits the count, toolbar and actions when not given', () => {
    const { container } = render(Panel, {
      title: 'Empty',
      scroll: true,
      children: html('<p>Body</p>'),
    })
    expect(container.querySelector('.count')).toBeNull()
    expect(container.querySelector('.toolbar')).toBeNull()
    expect(container.querySelector('.actions')).toBeNull()
    expect(screen.getByText('Body').closest('.body')!.classList.contains('scroll')).toBe(true)
  })
})

describe('Inspector', () => {
  it('is a labelled complementary region; Escape and the close button close it', async () => {
    const onclose = vi.fn()
    render(Inspector, {
      title: 'Counter',
      subtitle: 'src/Counter.svelte',
      badges: html('<span>live</span>'),
      actions: html('<button type="button">Open</button>'),
      onclose,
      children: html('<p>Details</p>'),
    })
    const aside = screen.getByRole('complementary', { name: 'Counter details' })
    expect(screen.getByRole('heading', { level: 2, name: 'Counter' })).toBeTruthy()
    expect(screen.getByText('src/Counter.svelte')).toBeTruthy()
    expect(screen.getByText('live')).toBeTruthy()
    await fireEvent.keyDown(aside, { key: 'Enter' })
    expect(onclose).not.toHaveBeenCalled()
    await fireEvent.keyDown(screen.getByText('Details'), { key: 'Escape' })
    expect(onclose).toHaveBeenCalledOnce()
    await fireEvent.click(screen.getByRole('button', { name: 'Close details (Esc)' }))
    expect(onclose).toHaveBeenCalledTimes(2)
  })

  it('has no close button or bar without handlers and snippets', () => {
    const { container } = render(Inspector, { title: 'Plain', children: html('<p>x</p>') })
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.bar')).toBeNull()
    expect(container.querySelector('.subtitle')).toBeNull()
    // Escape without a handler is left alone.
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const outer = vi.fn<() => void>()
    document.body.addEventListener('keydown', outer)
    screen.getByRole('complementary').dispatchEvent(event)
    document.body.removeEventListener('keydown', outer)
    expect(outer).toHaveBeenCalledOnce()
  })

  it('shows only the badges or only the actions', () => {
    const { container, unmount } = render(Inspector, {
      title: 'A',
      badges: html('<span>b</span>'),
      children: html('<p>x</p>'),
    })
    expect(container.querySelector('.badges')).not.toBeNull()
    expect(container.querySelector('.acts')).toBeNull()
    unmount()
    render(Inspector, {
      title: 'B',
      actions: html('<span>a</span>'),
      children: html('<p>x</p>'),
    })
    expect(document.querySelector('.acts')).not.toBeNull()
    expect(document.querySelector('.badges')).toBeNull()
  })
})

describe('Highlight', () => {
  it('marks every match of the query', () => {
    const { container } = render(Highlight, { text: 'Counter count', query: 'count' })
    expect([...container.querySelectorAll('mark')].map(m => m.textContent)).toEqual([
      'Count',
      'count',
    ])
    expect(container.textContent).toBe('Counter count')
  })

  it('renders plain text without a query', () => {
    const { container } = render(Highlight, { text: 'Counter' })
    expect(container.querySelector('mark')).toBeNull()
    expect(container.textContent).toBe('Counter')
  })

  it('renders markup in the text as text, also around matches', () => {
    const { container } = render(Highlight, { text: XSS, query: 'img' })
    expect(container.querySelector('img, script')).toBeNull()
    expect(container.textContent).toBe(XSS)
    expect(container.querySelector('mark')!.textContent).toBe('img')
  })
})

describe('CaptureNotice', () => {
  it('stays hidden when nothing was cut', () => {
    const { container } = render(CaptureNotice, {
      info: { captured: 10, total: 10, truncated: false },
    })
    expect(container.querySelector('[role=status]')).toBeNull()
    render(CaptureNotice, {})
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('stays hidden when "truncated" is reported but nothing is missing', () => {
    render(CaptureNotice, { info: { captured: 10, total: 10, truncated: true } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says how many of how many are shown, with the reasons in the title', () => {
    render(CaptureNotice, {
      noun: 'changes',
      info: {
        captured: 1000,
        total: 5000,
        truncated: true,
        policy: 'tail',
        dropped: [
          { reason: 'runtime-count', count: 3 },
          { reason: 'server-bytes', count: 0 },
        ],
        valueTooLarge: 2,
      },
    })
    const notice = screen.getByRole('status')
    expect(notice.textContent.replaceAll(/\s+/g, ' ').trim()).toBe(
      'Showing tail 1,000 of 5,000 · 3 dropped',
    )
    expect(notice.title).toContain('The dev server keeps 1,000 changes; 4,000 more exist')
    expect(notice.title).toContain('Policy: tail.')
    expect(notice.title).toContain('3 dropped: the app buffer was full before they were sent.')
    expect(notice.title).not.toContain('0 dropped')
    expect(notice.title).toContain('2 values were too large to snapshot')
  })

  it('handles an unknown total, unknown drop reasons, detached nodes and staleness', () => {
    render(CaptureNotice, {
      info: {
        captured: 50,
        total: null,
        truncated: true,
        dropped: [{ reason: 'other' as 'server-count', count: 1 }],
      },
      detached: 4,
      stale: 'timeout',
    })
    const notice = screen.getByRole('status')
    expect(notice.textContent.replaceAll(/\s+/g, ' ').trim()).toBe(
      'Showing 50 of ? · 1 dropped · 4 detached · stale',
    )
    expect(notice.title).toContain('more exist in the app (total not reported)')
    expect(notice.title).toContain('1 dropped: other.')
    expect(notice.title).toContain('4 items are shown as roots')
    expect(notice.title).toContain('Stale: timeout.')
  })

  it.each([
    [{ detached: 2 }, '2 detached'],
    [{ stale: 'no-runtime' }, 'stale'],
    [
      {
        info: {
          captured: 1,
          total: 1,
          truncated: false,
          dropped: [{ reason: 'server-count' as const, count: 2 }],
        },
      },
      '2 dropped',
    ],
  ])('shows a lone symptom without separators (%o)', (props, text) => {
    render(CaptureNotice, props)
    expect(screen.getByRole('status').textContent.replaceAll(/\s+/g, ' ').trim()).toBe(text)
  })
})

describe('LiveControls', () => {
  it('toggles live updates and refreshes on demand', async () => {
    const res = fakeResource([], { updatedAt: Date.now() })
    render(LiveControls, { res })
    const live = screen.getByRole('button', { name: 'Live' })
    expect(live.getAttribute('type')).toBe('button')
    expect(live.getAttribute('aria-pressed')).toBe('true')
    await fireEvent.click(live)
    expect(res.live).toBe(false)
    expect(live.textContent.trim()).toBe('Paused')
    expect(live.getAttribute('aria-pressed')).toBe('false')
    await fireEvent.click(live)
    expect(res.live).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: /^Refresh \(updated / }))
    expect(res.refresh).toHaveBeenCalledOnce()
    // Nothing to clear without a handler.
    expect(screen.queryByRole('button', { name: 'Clear recorded data' })).toBeNull()
  })

  it('disables refresh while busy and offers clearing', async () => {
    const res = fakeResource([], { busy: true })
    const onclear = vi.fn()
    render(LiveControls, { res, onclear })
    const refresh = screen.getByRole('button', { name: /^Refresh/ })
    expect(refresh.hasAttribute('disabled')).toBe(true)
    res.busy = false
    flushSync()
    expect(refresh.hasAttribute('disabled')).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    expect(onclear).toHaveBeenCalledOnce()
  })

  it('ages the "updated" label over time', () => {
    vi.useFakeTimers()
    try {
      const res = fakeResource([], { updatedAt: Date.now() })
      render(LiveControls, { res })
      const before = screen.getByRole('button', { name: /^Refresh/ }).getAttribute('aria-label')
      vi.advanceTimersByTime(120_000)
      flushSync()
      const after = screen.getByRole('button', { name: /^Refresh/ }).getAttribute('aria-label')
      expect(after).not.toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
