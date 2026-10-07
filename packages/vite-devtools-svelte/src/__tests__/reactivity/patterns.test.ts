import { describe, it, expect, afterEach } from 'vitest'
import { flushSync, tick } from 'svelte'
import Shop from './fixtures/Shop.svelte'
import Blocks from './fixtures/Blocks.svelte'
import Legacy from './fixtures/Legacy.svelte'
import {
  render,
  instance,
  instances,
  graph,
  node,
  incoming,
  dt,
  poll,
  timeline,
} from './harness.js'

let cleanup: Array<() => void> = []
afterEach(() => {
  for (const c of cleanup) c()
  cleanup = []
})
function mountIt(C: any, props?: any) {
  const r = render(C, props)
  cleanup.push(() => r.destroy())
  return r
}
const tree = () => dt().getTree() as Array<{ id: number; name: string; parentId: number | null }>

describe('props', () => {
  it('a child derived from a prop depends on the parent signal', () => {
    mountIt(Shop)
    const shop = instance('Shop')
    const price = instance('Price')
    expect(price.parentId).toBe(shop.id)
    const g = graph(price.id)
    expect(incoming(g, node(g, price.id, 'withTax').id)).toEqual([`${shop.id}:sum`])
  })
})

describe('blocks', () => {
  it('{#key}, dynamic component, {#await}, <svelte:element> + snippet: tree stays consistent', async () => {
    const r = mountIt(Blocks)
    await tick()
    flushSync()
    const blocks = instance('Blocks')
    const check = () => {
      const t = tree()
      const ids = new Set(t.map(c => c.id))
      expect(t.filter(c => c.parentId !== null && !ids.has(c.parentId))).toEqual([])
      for (const c of t.filter(c => c.name === 'Child' || c.name === 'Price'))
        expect(c.parentId).toBe(blocks.id)
      expect(dt()._stack).toEqual([])
    }
    check()
    const before = instances('Child').length
    for (const op of ['rekey', 'swap', 'swap', 'reload', 'retag', 'store']) {
      ;(r.app as any).api[op]()
      flushSync()
      await tick()
      await Promise.resolve()
      flushSync()
      check()
    }
    expect(instances('Child').length).toBe(before)
  })
})

describe('legacy mode', () => {
  it('a non-runes component is tracked without errors', () => {
    const r = mountIt(Legacy)
    const c = instance('Legacy')
    ;(r.app as any).inc()
    flushSync()
    expect(() => graph(c.id)).not.toThrow()
    expect(() => poll()).not.toThrow()
  })
})

describe('module-level state (.svelte.js)', () => {
  it('shared state is in the graph and its changes are in the timeline', () => {
    dt()._active = true
    const r = mountIt(Shop)
    const shop = instance('Shop')
    poll()
    const n = timeline().length
    ;(r.app as any).api.add()
    flushSync()
    poll()
    const changed = timeline()
      .slice(n)
      .map(e => e.name)
      .sort()
    expect(changed).toEqual(['cart', 'total'])
    const g = graph(shop.id)
    const count = node(g, shop.id, 'count')
    const cart = g.nodes.find(x => x.name === 'cart')!
    expect(cart.componentFile).toMatch(/shared\.svelte\.ts$/)
    expect(incoming(g, count.id)).toEqual([cart.id])
  })
})

describe('untracked dependencies', () => {
  it('an effect reading only a signal created outside components is not isolated', async () => {
    mountIt((await import('./fixtures/ReadsExternal.svelte')).default)
    const c = instance('ReadsExternal')
    const g = graph(c.id)
    const effect = g.nodes.find(n => n.type === 'effect')!
    expect(effect.untrackedDeps).toBe(1)
    const { summarizeReactiveProblems } = await import('../../mcp/issues.js')
    expect(summarizeReactiveProblems(g as any).isolatedNodes).toEqual([])
  })
})
