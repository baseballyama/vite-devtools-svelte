import { fireEvent, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { layoutGraph } from '../lib/graph-layout.js'
import type { ReactiveEdge, ReactiveNode } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import GraphView from './GraphView.svelte'

function node(
  id: string,
  type: ReactiveNode['type'],
  name: string,
  componentFile: string,
  value?: unknown,
): ReactiveNode {
  return { id, type, name, componentId: 1, componentFile, value }
}

const count = node('1:count', 'state', 'count', 'src/lib/Counter.svelte', 1)
const doubled = node('1:doubled', 'derived', 'doubled', 'src/lib/Counter.svelte', 2)
const log = node('1:log', 'effect', 'log', 'src/lib/Counter.svelte', 'ignored')
const markup = node('1:(template)', 'template', '(template)', 'src/lib/Counter.svelte')
const nodes = [count, doubled, log, markup]
const edges: ReactiveEdge[] = [
  { from: count.id, to: doubled.id },
  { from: doubled.id, to: log.id },
  { from: doubled.id, to: markup.id },
  // An edge to a node that is not in the graph is not drawn.
  { from: count.id, to: 'gone' },
]

const nodeButton = (name: string) =>
  screen.getByRole('button', { name: n => n.endsWith(` ${name}`) })
const viewBox = (c: HTMLElement) => c.querySelector('svg:not(.icon)')!.getAttribute('viewBox')!
/** happy-dom's WheelEvent is not a MouseEvent: it has no pointer position of its own. */
function wheel(deltaY: number, clientX: number, clientY: number): WheelEvent {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
  Object.defineProperties(e, { clientX: { value: clientX }, clientY: { value: clientY } })
  return e
}
const zoomLabel = () => screen.getByRole('button', { name: /^Fit to view/ })

describe('GraphView', () => {
  it('says so when there is nothing to draw', () => {
    render(GraphView, { nodes: [], edges: [] })
    expect(screen.getByText('No reactive signals tracked yet.')).toBeTruthy()
  })

  it('draws one labelled node per signal and one edge per known pair', () => {
    const { container } = render(GraphView, { nodes, edges })
    expect(container.querySelectorAll('.node')).toHaveLength(4)
    expect(container.querySelectorAll('path.edge')).toHaveLength(3)
    expect(container.querySelectorAll('polygon.arrow')).toHaveLength(3)
    for (const n of nodes) expect(nodeButton(n.name)).toBeTruthy()
    const text = nodeButton('count').textContent
    expect(text).toContain('count')
    expect(text).toContain('state')
    expect(text).toContain('Counter')
    expect(text).toContain('= 1')
    // Effects never show a value; nodes without one neither.
    expect(nodeButton('log').textContent).not.toContain('=')
    expect(nodeButton('(template)').textContent).not.toContain('=')
  })

  it('shortens long names and values', () => {
    const long = node('2:x', 'state', 'aVeryLongSignalName', 'A.svelte', 'a long string value')
    render(GraphView, { nodes: [long], edges: [] })
    const text = nodeButton('aVeryLongSignalName').textContent
    expect(text).toContain('aVeryLongSign…')
    expect(text).toContain('= a long string…')
  })

  it('draws one component box per file, even for same-named files in different folders', () => {
    const a = node('1:a', 'state', 'a', 'src/routes/Row.svelte')
    const b = node('2:b', 'state', 'b', 'src/lib/Row.svelte')
    const c = node('3:c', 'state', 'c', 'src/lib/Row.svelte')
    const { container } = render(GraphView, { nodes: [a, b, c], edges: [] })
    const boxes = container.querySelectorAll('rect.component-box')
    expect(boxes).toHaveLength(2)
    const labels = [...container.querySelectorAll('text.component-label')].map(t => t.textContent)
    expect(labels).toEqual(['Row', 'Row'])
    // The boxes do not overlap: each wraps only its own nodes.
    const ys = [...boxes].map(r => Number(r.getAttribute('y')))
    expect(new Set(ys).size).toBe(2)
  })

  it('selects a node by click or keyboard, highlights its edges and toggles off', async () => {
    const onSelectNode = vi.fn()
    const { container } = render(GraphView, { nodes, edges, onSelectNode })
    const button = nodeButton('doubled')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(button)
    expect(onSelectNode).toHaveBeenLastCalledWith(doubled)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    // Edges in and out of the selection are highlighted (count→doubled, doubled→log, doubled→template).
    expect(container.querySelectorAll('path.edge.highlighted')).toHaveLength(3)

    await userEvent.click(button)
    expect(onSelectNode).toHaveBeenLastCalledWith(null)
    expect(container.querySelectorAll('path.edge.highlighted')).toHaveLength(0)

    nodeButton('count').focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelectNode).toHaveBeenLastCalledWith(count)
    await userEvent.keyboard(' ')
    expect(onSelectNode).toHaveBeenLastCalledWith(null)
    await userEvent.keyboard('a')
    expect(onSelectNode).toHaveBeenCalledTimes(4)
  })

  it('shows non-string values as JSON, not `[object Object]`', () => {
    const obj = node('3:o', 'state', 'o', 'A.svelte', { a: 1 })
    const list = node('3:l', 'state', 'l', 'A.svelte', [[1], 2])
    render(GraphView, { nodes: [obj, list], edges: [] })
    expect(nodeButton('o').textContent).toContain('= {"a":1}')
    expect(nodeButton('l').textContent).toContain('= [[1],2]')
  })

  it('follows a selection set from outside', async () => {
    const view = render(GraphView, { nodes, edges, selectedNodeId: log.id })
    expect(nodeButton('log').getAttribute('aria-pressed')).toBe('true')
    await view.rerender({ selectedNodeId: null })
    expect(nodeButton('log').getAttribute('aria-pressed')).toBe('false')
  })

  it('pulses changed nodes and the edges downstream of them', async () => {
    const { container } = render(GraphView, {
      nodes,
      edges,
      changedNodeIds: new Set([count.id]),
    })
    await settle()
    // count and everything it reaches glow; each reached edge sweeps.
    expect(container.querySelectorAll('.glow-ring')).toHaveLength(4)
    expect(container.querySelectorAll('.edge-sweep')).toHaveLength(3)
    const delays = [...container.querySelectorAll<SVGElement>('.glow-ring')].map(r =>
      r.style.getPropertyValue('--node-delay'),
    )
    expect(delays).toEqual(['0ms', '700ms', '1400ms', '1400ms'])
    // Each kind glows in its own colour: the markup node is not an effect.
    const filters = [...container.querySelectorAll('.glow-ring')].map(r => r.getAttribute('filter'))
    expect(filters).toEqual([
      'url(#glow-state)',
      'url(#glow-derived)',
      'url(#glow-effect)',
      'url(#glow-template)',
    ])
    for (const f of filters) expect(container.querySelector(f!.slice(4, -1))).not.toBeNull()
  })

  it('zooms with the buttons and resets to fit', async () => {
    layout(() => ({ width: 800, height: 400 }))
    const { container } = render(GraphView, { nodes, edges })
    await settle()
    expect(zoomLabel().textContent).toBe('100%')
    const fitted = viewBox(container)

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(zoomLabel().textContent).toBe('120%')
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(zoomLabel().textContent).toBe('83%')

    await userEvent.click(zoomLabel())
    expect(zoomLabel().textContent).toBe('100%')
    expect(viewBox(container)).toBe(fitted)
  })

  it('zooms around the cursor with the wheel and pans by dragging the background', async () => {
    layout(() => ({ width: 800, height: 400 }))
    const { container } = render(GraphView, { nodes, edges })
    await settle()
    const surface = container.querySelector<HTMLElement>('.graph-container')!

    await fireEvent(surface, wheel(-100, 400, 200))
    expect(zoomLabel().textContent).toBe('120%')
    await fireEvent(surface, wheel(100, 400, 200))
    expect(zoomLabel().textContent).toBe('100%')

    surface.setPointerCapture = () => {}
    const [x0, y0] = viewBox(container).split(' ').map(Number) as [number, number]
    await fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(surface.classList.contains('dragging')).toBe(true)
    await fireEvent.pointerMove(surface, { clientX: 140, clientY: 120, pointerId: 1 })
    await fireEvent.pointerUp(surface, { pointerId: 1 })
    expect(surface.classList.contains('dragging')).toBe(false)
    const [x1, y1] = viewBox(container).split(' ').map(Number) as [number, number]
    expect(x1).toBeLessThan(x0)
    expect(y1).toBeLessThan(y0)

    // Moving without a drag, or starting on a node, does not pan.
    await fireEvent.pointerMove(surface, { clientX: 400, clientY: 400 })
    await fireEvent.pointerDown(nodeButton('count'), { clientX: 0, clientY: 0 })
    expect(surface.classList.contains('dragging')).toBe(false)
    expect(viewBox(container).split(' ').map(Number).slice(0, 2)).toEqual([x1, y1])
  })

  it('fits the graph centred in the view', async () => {
    layout(() => ({ width: 800, height: 400 }))
    const { container } = render(GraphView, { nodes, edges })
    await settle()
    const { width, height } = layoutGraph(nodes, edges)
    const [x, y, w, h] = viewBox(container).split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ]
    expect(x + w / 2).toBeCloseTo(width / 2)
    expect(y + h / 2).toBeCloseTo(height / 2)
  })

  it('waits for the container to have a size before fitting', async () => {
    let size = 0
    layout(() => ({ width: size, height: size / 2 }))
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const { container } = render(GraphView, { nodes, edges })
    await settle()
    expect(viewBox(container)).toBe('0 0 800 400')
    const retries = raf.mock.calls.length
    expect(retries).toBeGreaterThan(0)
    size = 800
    await new Promise(resolve => {
      setTimeout(resolve, 50)
    })
    await settle()
    expect(viewBox(container)).not.toBe('0 0 800 400')
  })

  it('caps the zoom-out so a huge graph stays legible', async () => {
    layout(() => ({ width: 200, height: 100 }))
    const many = Array.from({ length: 30 }, (_, i) =>
      node(`n${i}`, 'state', `s${i}`, `F${i}.svelte`),
    )
    const chain = many.slice(1).map((n, i) => ({ from: many[i]!.id, to: n.id }))
    const { container } = render(GraphView, { nodes: many, edges: chain })
    await settle()
    const [, , w] = viewBox(container).split(' ').map(Number) as [number, number, number]
    // ≤ 200 px / 110 px per node × 160 units per node.
    expect(w).toBeLessThanOrEqual((200 / 110) * 160 + 0.001)
  })
})
