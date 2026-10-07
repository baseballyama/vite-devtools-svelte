import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet, flushSync, type ComponentProps } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import { layout } from '../test/dom.js'
import type { RowState } from './types.js'
import VirtualList from './VirtualList.svelte'

interface Item {
  id: string
  label: string
}

const items: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: `k${i}`, label: `Item ${i}` }))

// Raw snippets render once; selection is asserted through `aria-selected`.
const row = createRawSnippet<[Item, RowState]>(item => ({
  render: () => `<span>${item().label}</span>`,
}))

/** Viewport 280px tall = 10 rows of 28px. */
function setup(props: Partial<ComponentProps<typeof VirtualList<Item>>> = {}) {
  layout(el =>
    el.classList.contains('viewport') ? { width: 400, height: 280 } : { width: 0, height: 0 },
  )
  const onselect = vi.fn()
  const onactivate = vi.fn()
  const result = render(VirtualList<Item>, {
    items,
    getKey: (x: Item) => x.id,
    label: 'Things',
    row,
    onselect,
    onactivate,
    ...props,
  })
  const list = screen.getByRole(props.role ?? 'listbox', { name: 'Things' })
  return { ...result, list, onselect, onactivate }
}

const options = () => screen.getAllByRole('option')
const selectedOption = () =>
  screen.getAllByRole('option').find(o => o.getAttribute('aria-selected') === 'true')

describe('VirtualList', () => {
  it('renders only the visible window plus overscan, with positions out of the full set', () => {
    setup()
    // 10 visible + 8 overscan below; none above at the top.
    expect(options()).toHaveLength(18)
    expect(options()[0]!.textContent).toBe('Item 0')
    expect(options()[0]!.getAttribute('aria-posinset')).toBe('1')
    expect(options()[0]!.getAttribute('aria-setsize')).toBe('1000')
    expect(screen.queryByText('Item 500')).toBeNull()
  })

  it('moves the window when scrolled', async () => {
    const { list } = setup()
    list.scrollTop = 28 * 500
    await fireEvent.scroll(list)
    expect(screen.getByText('Item 500')).toBeTruthy()
    expect(screen.queryByText('Item 0')).toBeNull()
    expect(options().length).toBeLessThanOrEqual(26)
  })

  it('navigates with the keyboard and keeps the selection in view', async () => {
    const { list, onselect } = setup()
    expect(list.getAttribute('tabindex')).toBe('0')
    await fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(selectedOption()?.textContent).toBe('Item 0')
    expect(onselect).toHaveBeenLastCalledWith(items[0], 0)
    expect(list.getAttribute('aria-activedescendant')).toBe(selectedOption()!.id)

    await fireEvent.keyDown(list, { key: 'ArrowDown' })
    await fireEvent.keyDown(list, { key: 'j' })
    expect(onselect).toHaveBeenLastCalledWith(items[2], 2)
    await fireEvent.keyDown(list, { key: 'ArrowUp' })
    await fireEvent.keyDown(list, { key: 'k' })
    expect(onselect).toHaveBeenLastCalledWith(items[0], 0)
    // Clamped at the top.
    await fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(onselect).toHaveBeenLastCalledWith(items[0], 0)

    await fireEvent.keyDown(list, { key: 'End' })
    expect(onselect).toHaveBeenLastCalledWith(items[999], 999)
    expect(list.scrollTop).toBe(1000 * 28 - 280)
    expect(selectedOption()?.textContent).toBe('Item 999')

    await fireEvent.keyDown(list, { key: 'Home' })
    expect(onselect).toHaveBeenLastCalledWith(items[0], 0)
    expect(list.scrollTop).toBe(0)

    // A page is the rows in view minus one.
    await fireEvent.keyDown(list, { key: 'PageDown' })
    expect(onselect).toHaveBeenLastCalledWith(items[9], 9)
    await fireEvent.keyDown(list, { key: 'PageUp' })
    expect(onselect).toHaveBeenLastCalledWith(items[0], 0)
  })

  it('starts from the first row on Up/PageDown/PageUp without a selection', async () => {
    const { list, onselect } = setup()
    await fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(onselect).toHaveBeenLastCalledWith(items[0], 0)
  })

  it.each([
    ['PageDown', 9],
    ['PageUp', 0],
  ] as const)('%s without a selection pages from the top', async (key, index) => {
    const { list, onselect } = setup()
    await fireEvent.keyDown(list, { key })
    expect(onselect).toHaveBeenLastCalledWith(items[index], index)
  })

  it('ignores modified keys and unrelated keys', async () => {
    const { list, onselect } = setup()
    await fireEvent.keyDown(list, { key: 'ArrowDown', altKey: true })
    await fireEvent.keyDown(list, { key: 'ArrowDown', metaKey: true })
    await fireEvent.keyDown(list, { key: 'ArrowDown', ctrlKey: true })
    await fireEvent.keyDown(list, { key: 'x' })
    expect(onselect).not.toHaveBeenCalled()
  })

  it('activates the selection with Enter and on double click', async () => {
    const { list, onactivate } = setup({ selected: 'k3' })
    await fireEvent.keyDown(list, { key: 'Enter' })
    expect(onactivate).toHaveBeenLastCalledWith(items[3], 3)
    await fireEvent.dblClick(screen.getByText('Item 5'))
    expect(onactivate).toHaveBeenLastCalledWith(items[5], 5)
  })

  it('does nothing on Enter without a selection', async () => {
    const { list, onactivate } = setup()
    await fireEvent.keyDown(list, { key: 'Enter' })
    expect(onactivate).not.toHaveBeenCalled()
  })

  it('selects a clicked row and focuses the list', async () => {
    const { list, onselect } = setup()
    await fireEvent.click(screen.getByText('Item 4'))
    expect(onselect).toHaveBeenLastCalledWith(items[4], 4)
    expect(document.activeElement).toBe(list)
  })

  it('scrolls a selection set from outside into view', async () => {
    const { list, rerender } = setup()
    await rerender({ selected: 'k400' })
    expect(list.scrollTop).toBe(401 * 28 - 280)
    expect(selectedOption()?.textContent).toBe('Item 400')
    // Selecting above the window scrolls up to it.
    await rerender({ selected: 'k10' })
    expect(list.scrollTop).toBe(280)
    // An unknown key selects nothing and does not scroll.
    await rerender({ selected: 'missing' })
    expect(list.scrollTop).toBe(280)
    expect(selectedOption()).toBeUndefined()
    expect(list.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('lets a row key handler take over', async () => {
    const onrowkeydown = vi.fn((e: KeyboardEvent) => e.key === 'ArrowDown')
    const { list, onselect } = setup({ selected: 'k1', onrowkeydown })
    await fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(onrowkeydown).toHaveBeenCalledWith(expect.any(KeyboardEvent), items[1], 1)
    expect(onselect).not.toHaveBeenCalled()
    await fireEvent.keyDown(list, { key: 'End' })
    expect(onselect).toHaveBeenLastCalledWith(items[999], 999)
  })

  it('spreads per-row attributes and supports the tree role', () => {
    setup({ role: 'tree', rowAttrs: (_: Item, i: number) => ({ 'aria-level': i + 1 }) })
    const rows = screen.getAllByRole('treeitem')
    expect(rows[2]!.getAttribute('aria-level')).toBe('3')
  })

  it('renders the empty snippet without items', () => {
    const empty = createRawSnippet(() => ({ render: () => '<p>Nothing here</p>' }))
    setup({ items: [], empty })
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('renders nothing for an empty list without an empty snippet', async () => {
    const { list, onselect } = setup({ items: [] })
    expect(list.children).toHaveLength(0)
    await fireEvent.keyDown(list, { key: 'End' })
    expect(onselect).not.toHaveBeenCalled()
  })

  it('clamps the scroll position when the list shrinks', async () => {
    const { list, rerender } = setup()
    list.scrollTop = 28 * 900
    await fireEvent.scroll(list)
    await rerender({ items: items.slice(0, 20) })
    flushSync()
    expect(list.scrollTop).toBe(20 * 28 - 280)
  })

  it('exposes scrollToIndex / focus / select', () => {
    const { component, list, onselect } = setup()
    component.scrollToIndex(500, 'center')
    expect(list.scrollTop).toBe(500 * 28 - 140 + 14)
    component.scrollToIndex(-1)
    expect(list.scrollTop).toBe(500 * 28 - 140 + 14)
    component.select(5000)
    flushSync()
    expect(onselect).toHaveBeenLastCalledWith(items[999], 999)
    component.focus()
    expect(document.activeElement).toBe(list)
  })
})
