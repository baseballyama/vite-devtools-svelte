import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet, type ComponentProps } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import type { TreeRow } from '../lib/tree.js'
import { layout, nextTask } from '../test/dom.js'
import TreeView from './TreeView.svelte'

interface Node {
  id: string
  children: Node[]
}

const n = (id: string, ...children: Node[]): Node => ({ id, children })

// app ─┬─ nav ── link
//      ├─ main
//      └─ footer
// other
const roots = [n('app', n('nav', n('link')), n('main'), n('footer')), n('other')]

const row = createRawSnippet<[Node, TreeRow<Node>]>(node => ({
  render: () => `<span>${node().id}</span>`,
}))

type Props = ComponentProps<typeof TreeView<Node>>

function setup(props: Partial<Props> = {}) {
  layout(el =>
    el.classList.contains('viewport') ? { width: 300, height: 260 } : { width: 0, height: 0 },
  )
  const onselect = vi.fn()
  const onactivate = vi.fn()
  const result = render(TreeView<Node>, {
    roots,
    getKey: (x: Node) => x.id,
    getChildren: (x: Node) => x.children,
    label: 'Components',
    row,
    onselect,
    onactivate,
    ...props,
  })
  const tree = screen.getByRole('tree', { name: 'Components' })
  return { ...result, tree, onselect, onactivate }
}

const item = (name: string) => screen.getByRole('treeitem', { name })
const names = () => screen.queryAllByRole('treeitem').map(r => r.textContent.trim())
const selectedName = () =>
  screen
    .getAllByRole('treeitem')
    .find(r => r.getAttribute('aria-selected') === 'true')
    ?.textContent.trim()

describe('TreeView', () => {
  it('renders collapsed roots with level, position and expanded state', () => {
    setup()
    expect(names()).toEqual(['app', 'other'])
    const app = item('app')
    expect(app.getAttribute('aria-level')).toBe('1')
    expect(app.getAttribute('aria-posinset')).toBe('1')
    expect(app.getAttribute('aria-setsize')).toBe('2')
    expect(app.getAttribute('aria-expanded')).toBe('false')
    // Leaves are not expandable.
    expect(item('other').hasAttribute('aria-expanded')).toBe(false)
  })

  it('expands and collapses with → / ← and walks to children and parents', async () => {
    const { tree, onselect } = setup({ selected: 'app' })
    await fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(names()).toEqual(['app', 'nav', 'main', 'footer', 'other'])
    expect(item('app').getAttribute('aria-expanded')).toBe('true')
    const nav = item('nav')
    expect(nav.getAttribute('aria-level')).toBe('2')
    expect(nav.getAttribute('aria-posinset')).toBe('1')
    expect(nav.getAttribute('aria-setsize')).toBe('3')

    // → on an expanded node moves to its first child.
    await fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(selectedName()).toBe('nav')
    expect(onselect).toHaveBeenLastCalledWith(roots[0]!.children[0])

    // ← on a collapsed child moves to the parent; ← again collapses it.
    await fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(selectedName()).toBe('app')
    await fireEvent.keyDown(tree, { key: 'h' })
    expect(names()).toEqual(['app', 'other'])
    // ← on a collapsed root does nothing.
    await fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(selectedName()).toBe('app')
    // `l` expands like →.
    await fireEvent.keyDown(tree, { key: 'l' })
    expect(names()).toHaveLength(5)
  })

  it('moves with ↑ ↓ Home End and activates with Enter', async () => {
    const { tree, onactivate } = setup({ expanded: new Set(['app']) })
    await fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(selectedName()).toBe('app')
    await fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(selectedName()).toBe('nav')
    await fireEvent.keyDown(tree, { key: 'End' })
    expect(selectedName()).toBe('other')
    await fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(selectedName()).toBe('footer')
    await fireEvent.keyDown(tree, { key: 'Home' })
    expect(selectedName()).toBe('app')
    await fireEvent.keyDown(tree, { key: 'Enter' })
    expect(onactivate).toHaveBeenCalledWith(roots[0])
  })

  it('toggles a branch with Space and with its twisty', async () => {
    const { tree, container } = setup({ selected: 'app' })
    await fireEvent.keyDown(tree, { key: ' ' })
    expect(names()).toHaveLength(5)
    await fireEvent.keyDown(tree, { key: ' ' })
    expect(names()).toHaveLength(2)
    // Space on a leaf is left to the list (no-op).
    await fireEvent.keyDown(tree, { key: 'End' })
    await fireEvent.keyDown(tree, { key: ' ' })
    expect(names()).toHaveLength(2)

    const twisty = container.querySelector<HTMLButtonElement>('.twisty')!
    expect(twisty.getAttribute('type')).toBe('button')
    await fireEvent.click(twisty)
    expect(names()).toHaveLength(5)
    // The twisty does not select the row.
    expect(selectedName()).toBe('other')
  })

  it('shows matching branches expanded while filtering, without collapsing them', async () => {
    const { tree, container } = setup({ filter: (x: Node) => x.id === 'link', selected: 'app' })
    expect(names()).toEqual(['app', 'nav', 'link'])
    // ← on an expanded node while filtering moves to the parent instead of collapsing.
    await fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(names()).toEqual(['app', 'nav', 'link'])
    await fireEvent.click(container.querySelector('.twisty')!)
    expect(names()).toEqual(['app', 'nav', 'link'])
  })

  it('reveals a nested node: expands its ancestors and selects it', async () => {
    const { component } = setup()
    component.reveal('link', ['app', 'nav'])
    await nextTask()
    expect(names()).toEqual(['app', 'nav', 'link', 'main', 'footer', 'other'])
    expect(selectedName()).toBe('link')
    // A root needs no ancestors.
    component.reveal('other', [])
    await nextTask()
    expect(selectedName()).toBe('other')
  })

  it('focuses the tree', () => {
    const { component, tree } = setup()
    component.focus()
    expect(document.activeElement).toBe(tree)
  })

  it('renders the empty snippet', () => {
    const empty = createRawSnippet(() => ({ render: () => '<p>No components</p>' }))
    setup({ roots: [], empty })
    expect(screen.getByText('No components')).toBeTruthy()
  })
})
