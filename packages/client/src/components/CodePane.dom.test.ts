import { fireEvent, render, screen } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import { highlightJS, highlightSvelte } from '../lib/highlight.js'
import { layout } from '../test/dom.js'
import CodePane from './CodePane.svelte'

/** 180px viewport = 10 lines of 18px. */
function setup(props: Partial<ComponentProps<typeof CodePane>> = {}) {
  layout(el =>
    el.classList.contains('viewport') ? { width: 600, height: 180 } : { width: 0, height: 0 },
  )
  const onlineclick = vi.fn()
  const source = Array.from({ length: 200 }, (_, i) => `const v${i + 1} = ${i + 1}`)
  const result = render(CodePane, {
    html: highlightJS(source),
    title: 'Compiled',
    highlighted: new Set<number>(),
    onlineclick,
    ...props,
  })
  const region = screen.getByRole('region', { name: `${props.title ?? 'Compiled'} code` })
  return { ...result, region, onlineclick }
}

/** happy-dom does not scroll; record the calls instead. */
function stubScrollTo(el: HTMLElement) {
  return vi.spyOn(el, 'scrollTo').mockImplementation(() => {})
}

const lineNumbers = (container: HTMLElement) =>
  [...container.querySelectorAll('.line .ln')].map(l => Number(l.textContent))

describe('CodePane', () => {
  it('renders a focusable code region with only the lines in view (+ overscan)', () => {
    const { container, region } = setup()
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(screen.getByText('200 lines')).toBeTruthy()
    // 10 visible + 20 overscan below.
    expect(lineNumbers(container)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    expect(container.querySelector('.line .src')!.textContent).toBe('const v1 = 1')
  })

  it('follows the scroll position', async () => {
    const { container, region } = setup()
    region.scrollTop = 100 * 18
    await fireEvent.scroll(region)
    const shown = lineNumbers(container)
    expect(shown[0]).toBe(81)
    expect(shown.at(-1)).toBe(130)
  })

  it('reports clicked lines and marks highlighted ones', async () => {
    const { container, onlineclick } = setup({ highlighted: new Set([3]), origin: true })
    const line3 = container.querySelectorAll('.line')[2]!
    expect(line3.classList.contains('hl')).toBe(true)
    expect(line3.classList.contains('origin')).toBe(true)
    await fireEvent.click(container.querySelectorAll('.line')[4]!)
    expect(onlineclick).toHaveBeenCalledWith(5)
  })

  it('walks the highlighted line with the arrow keys and scrolls it into view', async () => {
    const { region, onlineclick, rerender } = setup({ highlighted: new Set([3, 9]), origin: true })
    const scrollTo = stubScrollTo(region)
    await fireEvent.keyDown(region, { key: 'ArrowDown' })
    expect(onlineclick).toHaveBeenLastCalledWith(4)
    await fireEvent.keyDown(region, { key: 'ArrowUp' })
    expect(onlineclick).toHaveBeenLastCalledWith(2)
    expect(scrollTo).not.toHaveBeenCalled()
    await fireEvent.keyDown(region, { key: 'PageDown' })
    expect(onlineclick).toHaveBeenCalledTimes(2)

    await rerender({ highlighted: new Set([150]) })
    await fireEvent.keyDown(region, { key: 'ArrowDown' })
    expect(onlineclick).toHaveBeenLastCalledWith(151)
    expect(scrollTo).toHaveBeenCalledWith({ top: 150 * 18 - 60, behavior: 'smooth' })
  })

  it('starts at line 1 without an origin highlight and clamps at the ends', async () => {
    const { region, onlineclick } = setup({ highlighted: new Set([50]) })
    stubScrollTo(region)
    await fireEvent.keyDown(region, { key: 'ArrowUp' })
    expect(onlineclick).toHaveBeenLastCalledWith(1)
    await fireEvent.keyDown(region, { key: 'ArrowDown' })
    expect(onlineclick).toHaveBeenLastCalledWith(1)
  })

  it('scrolls to a line only when it is out of view', () => {
    const { component, region } = setup()
    const scrollTo = stubScrollTo(region)
    component.scrollToLine(5)
    expect(scrollTo).not.toHaveBeenCalled()
    component.scrollToLine(100)
    expect(scrollTo).toHaveBeenCalledWith({ top: 99 * 18 - 60, behavior: 'smooth' })
    region.scrollTop = 2000
    component.scrollToLine(2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('works without a click handler and renders blank lines', async () => {
    const { container, region } = setup({ html: ['', 'x'], onlineclick: undefined })
    await fireEvent.click(container.querySelector('.line')!)
    await fireEvent.keyDown(region, { key: 'ArrowDown' })
    expect(container.querySelector('.line .src')!.textContent).toBe(' ')
  })

  it('renders markup in the source as text (no element is created)', () => {
    const source = [
      '<script>',
      "  const s = '<img src=x onerror=alert(1)>'",
      '</script>',
      '<img src=x onerror="alert(1)">',
      '<script>alert(1)</script>',
      '<p>{@html "<b>x</b>"}</p>',
    ]
    const { container } = setup({ html: highlightSvelte(source), title: 'Source' })
    const code = container.querySelector('.spacer')!
    expect(code.querySelector('img, script, b, p')).toBeNull()
    expect([...code.querySelectorAll('.src')].map(s => s.textContent)).toEqual(source)

    const compiled = render(CodePane, {
      html: highlightJS([
        'const x = "<img src=x onerror=alert(1)>"',
        '// <script>alert(1)</script>',
      ]),
      title: 'JS',
      highlighted: new Set<number>(),
    })
    expect(compiled.container.querySelector('img, script')).toBeNull()
  })
})
