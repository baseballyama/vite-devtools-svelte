import { flushSync } from 'svelte'
import { describe, it, expect, afterEach } from 'vitest'

import BigState from './fixtures/BigState.svelte'
import Child from './fixtures/Child.svelte'
import Todos from './fixtures/Todos.svelte'
import TwoRoots from './fixtures/TwoRoots.svelte'
import { dt, render } from './harness.js'

// Element inspection is what the prompt toolbar copies: a clicked DOM node
// resolved to Svelte source locations, the component instance chain (with
// props and $state), and the template frames the element sits in.
interface Inspected {
  page: { url: string; path: string; title: string; viewport: string }
  element: {
    tag: string
    id: string
    classes: string[]
    attrs: Record<string, string>
    markup: string
    size: string
    selector: string
  }
  source: { file: string; line: number; column: number } | null
  template: Array<{
    type: string
    file: string | null
    line: number | null
    column: number | null
    componentTag: string | null
  }>
  components: Array<{
    id: number
    name: string
    file: string
    usage: { file: string; line: number; column: number; componentTag: string | null } | null
    props: string | null
    state: Array<{ name: string; type: string; value: string }>
    renders: number
  }>
  error?: string
}

const inspect = (node: unknown): Inspected => dt().inspectElement(node)

let cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
})

function mountIt(C: any, props?: any) {
  const r = render(C, props)
  cleanups.push(() => r.destroy())
  return r
}

const element = (r: { target: unknown }, selector: string): unknown => {
  const node = (r.target as { querySelector(s: string): unknown }).querySelector(selector)
  if (!node) throw new Error(`no ${selector}`)
  return node
}

const stateOf = (payload: Inspected, componentIndex: number) =>
  Object.fromEntries(payload.components[componentIndex]!.state.map(n => [n.name, n.value]))

describe('inspectElement', () => {
  it('resolves a DOM node to its element location, instance chain and state', () => {
    const r = mountIt(Todos)
    // Two rows, so the pick is not trivially the first sibling.
    ;(r.app as any).api.add()
    flushSync()
    const items = (
      r.target as unknown as { querySelectorAll(s: string): unknown[] }
    ).querySelectorAll('li')
    expect(items).toHaveLength(2)
    const payload = inspect(items[1])

    expect(payload.error).toBeUndefined()
    expect(payload.element.tag).toBe('li')
    // The element is identified by its own markup: no rendered copy, and no
    // Svelte scoping hashes.
    expect(payload.element.markup).toContain('</li>')
    expect(payload.element.markup).not.toContain('B false')
    expect(payload.element.markup).not.toContain('svelte-')
    expect(payload.element.classes.every(name => !name.startsWith('svelte-'))).toBe(true)
    expect(payload.element).not.toHaveProperty('text')
    expect(payload.element).not.toHaveProperty('outerHTML')
    expect(payload.element.selector).toBe('div > li:nth-of-type(2)')

    // The element is declared in the child component's markup, and Svelte
    // recorded the element itself (not an ancestor).
    expect(payload.source?.file.endsWith('/TodoItem.svelte')).toBe(true)
    expect(payload.source?.line).toBe(7)
    expect(payload.source?.column).toBe(0)
    expect((payload.source as { enclosing?: boolean } | null)?.enclosing).toBe(false)

    // Component chain, innermost first: the row, then the page component.
    expect(payload.components.map(c => c.name)).toEqual(['TodoItem', 'Todos'])
    const [row, page] = payload.components
    expect(row!.file.endsWith('/TodoItem.svelte')).toBe(true)
    expect(row!.usage?.file.endsWith('/Todos.svelte')).toBe(true)
    expect(row!.usage?.componentTag).toBe('TodoItem')
    expect(row!.usage?.line).toBe(14)
    expect(page!.usage).toBeNull()

    // Props (what the compiler passed) and live $state / $derived values.
    expect(JSON.parse(row!.props!)).toEqual({ todo: { text: 'b', done: false } })
    expect(stateOf(payload, 0)).toMatchObject({
      local: '{"editing":false}',
      label: '"B"',
    })
    const pageState = stateOf(payload, 1)
    expect(JSON.parse(pageState.todos!)).toEqual([
      { text: 'a', done: false },
      { text: 'b', done: false },
    ])
    expect(pageState.open).toBe('2')

    // Each row is rendered inside the {#each} of the page component.
    expect(payload.template[0]?.type).toBe('component')
    expect(payload.template[0]?.componentTag).toBe('TodoItem')
  })

  it('reports the page it was inspected on', () => {
    const r = mountIt(Child)
    const payload = inspect(element(r, 'span'))
    expect(payload.page.path).toMatch(/^\//)
    expect(payload.page.viewport).toContain('×')
    expect(payload.components.map(c => c.name)).toEqual(['Child'])
  })

  it('walks up from a nested node to the nearest located element', () => {
    const r = mountIt(Todos)
    const text = (element(r, 'li') as any).firstChild as {
      nodeType: number
      parentElement: unknown
    }
    expect(text.nodeType).toBe(3)
    const payload = inspect(text)
    expect(payload.source?.file.endsWith('/TodoItem.svelte')).toBe(true)
    expect(payload.components[0]?.name).toBe('TodoItem')
  })

  it('stamps every root of a multi-root template, not just the first', () => {
    // A template with several top-level nodes (a typical `+page.svelte`), with
    // a component between them: the sibling walk must reach the last root.
    const r = mountIt(TwoRoots)
    for (const selector of ['.first', 'p.third']) {
      const payload = inspect(element(r, selector))
      expect(payload.components.map(c => c.name)).toEqual(['TwoRoots'])
      expect(payload.source?.file.endsWith('/TwoRoots.svelte')).toBe(true)
    }
    // and the child component keeps its own attribution
    const child = inspect(element(r, 'span'))
    expect(child.components.map(c => c.name)).toEqual(['Child', 'TwoRoots'])
  })

  it('bounds a huge state value with parseable JSON, not a sliced string', () => {
    const r = mountIt(BigState)
    const payload = inspect(element(r, 'p.big'))
    const state = payload.components[0]!.state.find(node => node.name === 'blob')
    expect(state).toBeDefined()
    // Valid JSON (the toolbar summarises from it), inside the inspection budget.
    const parsed = JSON.parse(state!.value) as { text: string; list: unknown[] }
    expect(parsed.text.length).toBeLessThanOrEqual(321)
    expect(Array.isArray(parsed.list)).toBe(true)
    expect(state!.value.length).toBeLessThan(6000)
  })

  it('locateElement is the cheap lookup behind the hover tooltip', () => {
    const r = mountIt(Todos)
    const located = dt().locateElement(element(r, 'li'))
    expect(located.source.file.endsWith('/TodoItem.svelte')).toBe(true)
    expect(located.component.name).toBe('TodoItem')
  })

  it('never throws on input that is not an element', () => {
    const payload = inspect(null)
    expect(payload.error).toBeUndefined()
    expect(payload.element).toBeNull()
    expect(payload.components).toEqual([])
  })
})
