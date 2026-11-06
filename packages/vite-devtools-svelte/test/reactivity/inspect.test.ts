import { flushSync, hydrate, unmount } from 'svelte'
import { describe, it, expect, afterEach } from 'vitest'

import Child from './fixtures/Child.svelte'
import Todos from './fixtures/Todos.svelte'
import TwoRoots from './fixtures/TwoRoots.svelte'
import { dt, render } from './harness.js'

// Element inspection behind the prompt toolbar: a picked DOM node resolved to
// where it is written, the instances that rendered it, and the template frames
// around it. This project runs the wrapper with `promptToolbar: true`.
interface Inspected {
  epoch: string
  page: { url: string; title: string; viewport: string }
  element: { tag: string; id: string; classes: string[] } | null
  source: { file: string; line: number; column: number; enclosing: boolean } | null
  template: Array<{ type: string; file: string | null; componentTag: string | null }>
  components: Array<{ id: number; name: string; file: string }>
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

// The DOM surface the tests touch (the package type-checks against Node's lib).
interface TestNode {
  nodeType: number
  firstChild: TestNode | null
  innerHTML: string
  querySelector(selector: string): TestNode | null
  querySelectorAll(selector: string): TestNode[]
}

const element = (root: unknown, selector: string): TestNode => {
  const node = (root as TestNode).querySelector(selector)
  if (!node) throw new Error(`no ${selector}`)
  return node
}

const names = (payload: Inspected) => payload.components.map(c => c.name)

describe('inspectElement', () => {
  it('resolves a node to its location, its instance chain and the live-state handle', () => {
    const r = mountIt(Todos)
    // Two rows, so the pick is not trivially the first one.
    ;(r.app as any).api.add()
    flushSync()
    const items = (r.target as unknown as TestNode).querySelectorAll('li')
    expect(items).toHaveLength(2)
    const payload = inspect(items[1])

    expect(payload.error).toBeUndefined()
    expect(payload.element).toEqual({ tag: 'li', id: '', classes: [] })
    expect(payload.source).toMatchObject({ line: 7, column: 0, enclosing: false })
    expect(payload.source!.file.endsWith('/TodoItem.svelte')).toBe(true)
    // Innermost first: the row, then the component that renders the rows.
    expect(names(payload)).toEqual(['TodoItem', 'Todos'])
    // Each row is its own instance: the id the MCP tools take.
    expect(inspect(items[0]).components[0]!.id).not.toBe(payload.components[0]!.id)
    expect(payload.epoch).toBe(dt()._epoch)
    expect(payload.template[0]).toMatchObject({ type: 'component', componentTag: 'TodoItem' })
    // No values are copied: the prompt points at the MCP tools instead.
    expect(payload.components[0]).toEqual({
      id: expect.any(Number),
      name: 'TodoItem',
      file: expect.stringMatching(/\/TodoItem\.svelte$/),
    })
  })

  it('walks up from a text node to its element', () => {
    const r = mountIt(Todos)
    const text = element(r.target, 'li').firstChild!
    expect(text.nodeType).toBe(3)
    const payload = inspect(text)
    expect(payload.element?.tag).toBe('li')
    expect(names(payload)).toEqual(['TodoItem', 'Todos'])
  })

  it('attributes every root of a multi-root template, a child component in between', () => {
    const r = mountIt(TwoRoots)
    for (const [selector, line] of [
      ['.first', 7],
      ['p.third', 9],
    ] as const) {
      const payload = inspect(element(r.target, selector))
      expect(names(payload)).toEqual(['TwoRoots'])
      expect(payload.source!.file.endsWith('/TwoRoots.svelte')).toBe(true)
      expect(payload.source!.line).toBe(line)
    }
    const child = inspect(element(r.target, 'span'))
    expect(names(child)).toEqual(['Child', 'TwoRoots'])
    expect(child.source!.file.endsWith('/Child.svelte')).toBe(true)
  })

  it('repairs the locations hydration leaves behind a child component', () => {
    // The server markup of TwoRoots. Svelte locates hydrated elements by
    // position and the child's markup is not delimited, so on its own the
    // `<p>` after `<Child />` is left without its location.
    const document = (globalThis as any).document
    const target = document.createElement('div')
    target.innerHTML =
      '<!--[--><div class="first">1</div> <span>second-root0</span> <!----><!----> <p class="third">tail</p><!--]-->'
    document.body.append(target)
    const third = element(target, 'p.third')
    const app = hydrate(TwoRoots, { target })
    flushSync()
    cleanups.push(() => {
      void unmount(app)
      target.remove()
    })
    // Hydrated, not re-rendered: the server's node is the one in the page.
    expect(element(target, 'p.third')).toBe(third)

    const payload = inspect(third)
    expect(payload.source).toMatchObject({ line: 9, column: 0, enclosing: false })
    expect(payload.source!.file.endsWith('/TwoRoots.svelte')).toBe(true)
    expect(names(payload)).toEqual(['TwoRoots'])

    const span = inspect(element(target, 'span'))
    expect(span.source).toMatchObject({ line: 6, column: 0, enclosing: false })
    expect(span.source!.file.endsWith('/Child.svelte')).toBe(true)
    expect(names(span)).toEqual(['Child', 'TwoRoots'])

    const first = inspect(element(target, '.first'))
    expect(first.source).toMatchObject({ line: 7, column: 0 })
    expect(names(first)).toEqual(['TwoRoots'])
  })

  it('reports the page it was inspected on', () => {
    const r = mountIt(Child)
    const payload = inspect(element(r.target, 'span'))
    expect(payload.page.url).toMatch(/^http/)
    expect(payload.page.viewport).toContain('×')
  })

  it('locateElement is the cheap lookup behind the hover tooltip', () => {
    const r = mountIt(Todos)
    const located = dt().locateElement(element(r.target, 'li'))
    expect(located.source.file.endsWith('/TodoItem.svelte')).toBe(true)
    expect(located.component.name).toBe('TodoItem')
    expect(dt().locateElement(null)).toEqual({ source: null, component: null })
  })

  it('drops instances that were destroyed', () => {
    const r = mountIt(Todos)
    const li = element(r.target, 'li')
    r.destroy()
    cleanups = []
    expect(inspect(li).components).toEqual([])
  })

  it('never throws on input that is not an element', () => {
    const payload = inspect(null)
    expect(payload.error).toBeUndefined()
    expect(payload.element).toBeNull()
    expect(payload.source).toBeNull()
    expect(payload.components).toEqual([])
  })
})
