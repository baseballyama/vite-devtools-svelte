import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { flushSync } from 'svelte'
import StateKinds from './fixtures/StateKinds.svelte'
import { render, instance, instances, dt, poll, timeline } from './harness.js'

beforeAll(() => {
  // what the server's subscription message does when a client watches
  dt()._active = true
})

let r: ReturnType<typeof render>
afterEach(() => r?.destroy())

function step(fn: () => void) {
  fn()
  flushSync()
  poll()
}
const since = (n: number) =>
  timeline()
    .slice(n)
    .map(e => ({ name: e.name, oldValue: e.oldValue, newValue: e.newValue }))

describe('state timeline', () => {
  it('records each kind of $state change once, on the right node', () => {
    r = render(StateKinds)
    const api = (r.app as any).api
    poll() // seed
    let n = timeline().length
    step(api.num)
    expect(since(n)).toEqual([{ name: 'num', oldValue: 0, newValue: 1 }])
    n = timeline().length
    step(api.push)
    expect(since(n)).toEqual([{ name: 'list', oldValue: [1, 2], newValue: [1, 2, 3] }])
    n = timeline().length
    step(api.deep)
    expect(since(n)).toEqual([{ name: 'obj', oldValue: { a: 1 }, newValue: { a: 2 } }])
    n = timeline().length
    step(api.reassign)
    expect(since(n)).toEqual([{ name: 'obj', oldValue: { a: 2 }, newValue: { a: 100 } }])
    n = timeline().length
    step(api.raw)
    expect(since(n)).toEqual([{ name: 'raw', oldValue: { r: 1 }, newValue: { r: 2 } }])
    n = timeline().length
    step(api.date)
    expect(since(n)).toEqual([
      { name: 'date', oldValue: '1970-01-01T00:00:00.000Z', newValue: '1970-01-01T00:00:01.000Z' },
    ])
  })

  it('two instances of a $state class: only the written one changes', () => {
    r = render(StateKinds)
    const api = (r.app as any).api
    poll()
    const n = timeline().length
    step(api.second)
    const entries = timeline().slice(n)
    expect(entries.map(e => e.name)).toEqual(['Counter.count'])
    expect(entries[0].id).toMatch(/#2$/)
  })
})

describe('render profiling', () => {
  it('attributes re-renders to the component whose markup updated', () => {
    r = render(StateKinds)
    const api = (r.app as any).api
    step(api.addRow)
    const owner = instance('StateKinds')
    const rows = instances('Child').filter(c => c.parentId === owner.id)
    expect(rows).toHaveLength(2)
    const renders = (id: number) => dt()._profiles.get(id)?.renderCount ?? 0
    const before = { owner: renders(owner.id), rows: rows.map(c => renders(c.id)) }
    step(api.num)
    return Promise.resolve().then(() => {
      // pooled per microtask
      expect(renders(owner.id)).toBe(before.owner + 1)
      // each row's label depends on num: the row (the later-added one too) re-renders
      expect(rows.map(c => renders(c.id))).toEqual(before.rows.map(x => x + 1))
    })
  })
})
