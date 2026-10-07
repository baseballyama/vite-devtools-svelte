// Work-count scaling tests. They monkey-patch Map/Set/Array iteration to count
// visited elements, which permanently disables V8 fast paths (protectors) for
// the worker — so they live in their own file, isolated from timing tests.
import { describe, it, expect } from 'vitest'

import { countVisits, createRuntime, unmountVisits } from './harness.js'

/** Visits of a whole-app graph build over `len` untracked intermediate deriveds. */
function chainVisits(len: number): number {
  const h = createRuntime()
  const id = h.dt.register('/app/src/lib/Chain.svelte')
  const head = { v: 0, deps: null }
  h.dt.trackState(head, 'head', id)
  let dep: any = head
  // untracked intermediate deriveds, as created by template expressions
  for (let k = 0; k < len; k++) dep = { v: k, deps: [dep] }
  const tail = { v: 1, deps: [dep] }
  h.dt.trackDerived(tail, 'tail', id)
  h.dt.registered(id)
  let graph: any
  const visits = countVisits(() => {
    graph = h.dt.getReactiveGraph()
  })
  expect(graph.edges).toEqual([{ from: id + ':head', to: id + ':tail' }])
  return visits
}

describe('runtime work scaling (deterministic)', () => {
  // P1: unmounting N rows must be ~linear in work. Linear → visit ratio ≈ 4
  // for 4× rows, quadratic → ≈ 16.
  it('P1: unmount cost grows ~linearly with the number of components', () => {
    const small = unmountVisits(500)
    const large = unmountVisits(2000)
    expect(large / small).toBeLessThan(8)
  }, 60_000)

  // P5: dependency BFS over untracked intermediates must be linear.
  it('P5: reactive graph BFS is linear in the dependency chain length', () => {
    const small = chainVisits(2000)
    const large = chainVisits(8000)
    expect(large / small).toBeLessThan(6)
  })
})
