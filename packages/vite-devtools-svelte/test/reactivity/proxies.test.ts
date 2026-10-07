import { describe, it, expect, afterEach } from 'vitest'
import { flushSync } from 'svelte'
import Todos from './fixtures/Todos.svelte'
import Shop from './fixtures/Shop.svelte'
import TwoLists from './fixtures/TwoLists.svelte'
import { render, instance, instances, graph, node, incoming, outgoing } from './harness.js'
import { summarizeReactiveProblems } from '../../src/mcp/issues.js'

let cleanup: Array<() => void> = []
afterEach(() => {
  for (const c of cleanup) c()
  cleanup = []
})
function mountIt(C: any) {
  const r = render(C)
  cleanup.push(() => r.destroy())
  return r
}

describe('object / array $state (proxies)', () => {
  it('reads of proxied properties are edges from the proxy node', () => {
    const r = mountIt(Todos)
    ;(r.app as any).api.add()
    flushSync()
    const c = instance('Todos')
    for (const g of [graph(c.id), graph(null)]) {
      const todos = node(g, c.id, 'todos').id
      const filter = node(g, c.id, 'filter').id
      expect(incoming(g, node(g, c.id, 'open').id)).toEqual([todos])
      // {#each todos} and {#if filter.onlyOpen} read from the markup
      expect(outgoing(g, todos)).toContain(`${c.id}:(template)`)
      expect(outgoing(g, filter)).toEqual([`${c.id}:(template)`])
    }
  })

  it('a child reading a parent proxy through a prop depends on the parent node', () => {
    const r = mountIt(Todos)
    ;(r.app as any).api.add()
    flushSync()
    const parent = instance('Todos')
    const items = instances('TodoItem')
    expect(items).toHaveLength(2)
    for (const item of items) {
      const g = graph(item.id)
      expect(incoming(g, node(g, item.id, 'label').id)).toEqual([`${parent.id}:todos`])
      // the child's own proxy, read by its markup (class:editing)
      expect(outgoing(g, node(g, item.id, 'local').id)).toEqual([`${item.id}:(template)`])
    }
    // nothing of the todo list is isolated: every node has a reader or a
    // dependency (module state of other tests may have no reader now)
    const isolated = summarizeReactiveProblems(graph(null) as any).isolatedNodes
    expect(isolated.filter(n => /Todo(s|Item)\.svelte$/.test(n.file))).toEqual([])
  })

  it('same proxy name and equal values in two instances: each child reads its own parent', () => {
    mountIt(TwoLists)
    const lists = instances('Todos')
    expect(lists).toHaveLength(2)
    for (const item of instances('TodoItem')) {
      const g = graph(item.id)
      // 'todos[0].text' is 'a' in both lists: resolved by ancestry
      expect(incoming(g, node(g, item.id, 'label').id)).toEqual([`${item.parentId}:todos`])
    }
    for (const list of lists) {
      const g = graph(list.id)
      expect(incoming(g, node(g, list.id, 'open').id)).toEqual([`${list.id}:todos`])
    }
  })

  it('module-level shared state: edges into components', () => {
    mountIt(Shop)
    const shop = instance('Shop')
    const g = graph(shop.id)
    const cart = g.nodes.find(x => x.name === 'cart')!
    expect(cart.componentFile).toMatch(/shared\.svelte\.ts$/)
    expect(incoming(g, node(g, shop.id, 'count').id)).toEqual([cart.id])
  })
})

describe('proxies held by $state signals (class fields, reassigned objects)', () => {
  it('element reads resolve to the signal node, nothing untracked', async () => {
    const r = mountIt((await import('./fixtures/Inventory.svelte')).default)
    const c = instance('Inventory')
    const g = graph(null)
    const items = g.nodes.find(n => n.name === 'Inventory.items')!
    const total = g.nodes.find(n => n.name === 'Inventory.total')!
    expect(items.componentFile).toMatch(/stock\.svelte\.ts$/)
    expect(incoming(g, total.id)).toEqual([items.id])
    expect(outgoing(g, items.id).sort()).toEqual([total.id, `${c.id}:(template)`].sort())
    expect(g.nodes.filter(n => n.untrackedDeps)).toEqual([])
    ;(r.app as any).api.replace()
    flushSync()
    const g2 = graph(c.id)
    expect(incoming(g2, node(g2, c.id, 'n').id)).toEqual([`${c.id}:obj`])
    expect(g2.nodes.filter(n => n.untrackedDeps)).toEqual([])
  })
})

describe('same proxy name in parent and child', () => {
  it('a child reading the parent proxy through a prop is not resolved to its own', async () => {
    mountIt((await import('./fixtures/Shadow.svelte')).default)
    const parent = instance('Shadow')
    const child = instance('ShadowChild')
    const g = graph(child.id)
    expect(incoming(g, node(g, child.id, 'fromParent').id)).toEqual([`${parent.id}:items`])
    expect(incoming(g, node(g, child.id, 'own').id)).toEqual([`${child.id}:items`])
  })
})
