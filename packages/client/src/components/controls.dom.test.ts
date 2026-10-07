import { fireEvent, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { createRawSnippet, flushSync } from 'svelte'
import { describe, expect, it } from 'vitest'

import { layout, nextTask } from '../test/dom.js'
import SearchField from './SearchField.svelte'
import Segmented from './Segmented.svelte'
import SplitView from './SplitView.svelte'

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }))

const options = [
  { value: 'all', label: 'All', count: 12 },
  { value: 'svelte', label: 'Svelte' },
  { value: 'js', label: 'JS' },
] as const

const radio = (name: RegExp) => screen.getByRole('radio', { name })

function setupSplit(width: number, props: Record<string, unknown> = {}) {
  layout(el => (el.classList.contains('split') ? { width, height: 600 } : { width: 0, height: 0 }))
  return render(SplitView, {
    id: 'test',
    children: html('<p>Main</p>'),
    aside: html('<p>Side</p>'),
    ...props,
  })
}
const handle = () => screen.getByRole('separator', { name: 'Resize panel' })
const size = () => Number(handle().getAttribute('aria-valuenow'))

describe('SearchField', () => {
  it('is a labelled search box with a "/" hint while empty', () => {
    const { container } = render(SearchField, { label: 'Filter routes', placeholder: 'Routes…' })
    const input = screen.getByRole('searchbox', { name: 'Filter routes' })
    expect(input.getAttribute('placeholder')).toBe('Routes…')
    expect(input.dataset.panelSearch).toBe('')
    expect(container.querySelector('kbd')!.textContent).toBe('/')
  })

  it('shows the hit count while filtering and clears on Escape', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(SearchField, { count: 3 })
    const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Filter' })
    await user.type(input, 'abc')
    expect(container.querySelector('.hits')!.textContent).toBe('3')
    // The count does not leak into the field's name.
    expect(screen.getByRole('searchbox', { name: 'Filter' })).toBe(input)
    expect(container.querySelector('kbd')).toBeNull()
    await rerender({ count: null })
    expect(container.querySelector('.hits')).toBeNull()

    // Escape clears the text and stops there (a surrounding dialog stays open).
    let escaped = false
    document.body.addEventListener(
      'keydown',
      () => {
        escaped = true
      },
      { once: true },
    )
    await user.keyboard('{Escape}')
    expect(input.value).toBe('')
    expect(escaped).toBe(false)
    // A second Escape on the empty field propagates.
    await user.keyboard('{Escape}')
    expect(escaped).toBe(true)
  })

  it('hands focus to the panel list on ArrowDown', async () => {
    const section = document.createElement('section')
    const list = document.createElement('div')
    list.setAttribute('role', 'tree')
    list.tabIndex = 0
    section.append(list)
    document.body.append(section)
    try {
      render(SearchField, { target: section, props: {} })
      const input = screen.getByRole('searchbox')
      input.focus()
      await fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(list)
    } finally {
      section.remove()
    }
  })

  it('keeps focus on ArrowDown when the panel has no list', async () => {
    render(SearchField, {})
    const input = screen.getByRole('searchbox')
    input.focus()
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
  })
})

describe('Segmented', () => {
  it('is a labelled radio group with one checked, focusable option', () => {
    render(Segmented, { options, value: 'all', label: 'File type' })
    expect(screen.getByRole('radiogroup', { name: 'File type' })).toBeTruthy()
    expect(radio(/^All/).getAttribute('aria-checked')).toBe('true')
    expect(radio(/^All/).getAttribute('tabindex')).toBe('0')
    expect(radio(/^Svelte/).getAttribute('aria-checked')).toBe('false')
    expect(radio(/^Svelte/).getAttribute('tabindex')).toBe('-1')
    expect(radio(/^All/).textContent).toContain('12')
    for (const r of screen.getAllByRole('radio')) expect(r.getAttribute('type')).toBe('button')
  })

  it('selects on click', async () => {
    render(Segmented, { options, value: 'all', label: 'File type' })
    await fireEvent.click(radio(/^JS/))
    expect(radio(/^JS/).getAttribute('aria-checked')).toBe('true')
    expect(radio(/^All/).getAttribute('aria-checked')).toBe('false')
  })

  it('moves the selection and focus with the arrow keys, wrapping around', async () => {
    render(Segmented, { options, value: 'all', label: 'File type' })
    const group = screen.getByRole('radiogroup')
    await fireEvent.keyDown(group, { key: 'ArrowRight' })
    await nextTask()
    expect(radio(/^Svelte/).getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio(/^Svelte/))
    await fireEvent.keyDown(group, { key: 'ArrowDown' })
    await fireEvent.keyDown(group, { key: 'ArrowDown' })
    expect(radio(/^All/).getAttribute('aria-checked')).toBe('true')
    await fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(radio(/^JS/).getAttribute('aria-checked')).toBe('true')
    await fireEvent.keyDown(group, { key: 'ArrowUp' })
    expect(radio(/^Svelte/).getAttribute('aria-checked')).toBe('true')
    await fireEvent.keyDown(group, { key: 'Enter' })
    expect(radio(/^Svelte/).getAttribute('aria-checked')).toBe('true')
  })

  it('ignores arrow keys without options', () => {
    render(Segmented, { options: [], value: 'x', label: 'Empty' })
    const group = screen.getByRole('radiogroup', { name: 'Empty' })
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    group.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('SplitView', () => {
  it('shows both panes side by side with a vertical, focusable separator', () => {
    const { container } = setupSplit(1200)
    expect(screen.getByText('Main')).toBeTruthy()
    expect(screen.getByText('Side')).toBeTruthy()
    expect(handle().getAttribute('aria-orientation')).toBe('vertical')
    expect(handle().getAttribute('tabindex')).toBe('0')
    expect(handle().getAttribute('aria-valuemin')).toBe('220')
    expect(size()).toBe(360)
    expect(container.querySelector('.split')!.classList.contains('stacked')).toBe(false)
  })

  it('hides the side pane and the separator when closed', () => {
    setupSplit(1200, { open: false })
    expect(screen.queryByText('Side')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('resizes with the arrow keys (Shift for bigger steps) and remembers the size', async () => {
    setupSplit(1200)
    await fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(size()).toBe(376)
    await fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true })
    expect(size()).toBe(312)
    await fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(size()).toBe(312)
    expect(localStorage.getItem('svelte-devtools:split:test')).toBe('312')
  })

  it('clamps to the minimum and to the container', async () => {
    setupSplit(1200, { initial: 230 })
    await fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true })
    expect(size()).toBe(220)
    localStorage.setItem('svelte-devtools:split:wide', '5000')
    setupSplit(1200, { id: 'wide' })
    expect(Number(screen.getAllByRole('separator')[1]!.getAttribute('aria-valuenow'))).toBe(980)
  })

  it('mirrors the keys for a start-side pane', async () => {
    setupSplit(1200, { side: 'start' })
    await fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(size()).toBe(376)
    await fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect(size()).toBe(360)
  })

  it('stacks in narrow containers and resizes vertically', async () => {
    const { container } = setupSplit(500)
    expect(container.querySelector('.split')!.classList.contains('stacked')).toBe(true)
    expect(handle().getAttribute('aria-orientation')).toBe('horizontal')
    await fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect(size()).toBe(376)
    await fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(size()).toBe(360)
  })

  it('resizes by dragging the separator', async () => {
    setupSplit(1200)
    const el = handle()
    await fireEvent.pointerDown(el, { pointerId: 1, clientX: 800 })
    expect(el.closest('.split')!.classList.contains('dragging')).toBe(true)
    await fireEvent.pointerMove(el, { pointerId: 1, clientX: 700 })
    expect(size()).toBe(460)
    await fireEvent.pointerUp(el, { pointerId: 1, clientX: 700 })
    flushSync()
    expect(el.closest('.split')!.classList.contains('dragging')).toBe(false)
    expect(localStorage.getItem('svelte-devtools:split:test')).toBe('460')
    // Listeners are gone after the drag ends.
    await fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 })
    expect(size()).toBe(460)
  })

  it('drags a start-side pane the other way and vertically when stacked', async () => {
    setupSplit(1200, { side: 'start', id: 'start' })
    await fireEvent.pointerDown(handle(), { pointerId: 1, clientX: 300 })
    await fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 350 })
    await fireEvent.pointerCancel(handle(), { pointerId: 1 })
    expect(size()).toBe(410)
  })

  it('drags vertically when stacked', async () => {
    setupSplit(500, { id: 'stacked' })
    await fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 300 })
    await fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 290 })
    expect(size()).toBe(370)
    // Clamped so the main pane keeps its minimum (600 - 220).
    await fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 0 })
    await fireEvent.pointerUp(handle(), { pointerId: 1 })
    expect(size()).toBe(380)
  })
})
