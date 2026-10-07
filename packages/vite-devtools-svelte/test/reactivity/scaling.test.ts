import { describe, it, expect } from 'vitest'

import { countVisits } from '../perf/visits.js'
import BigList from './fixtures/BigList.svelte'
import { render, instances, graph, type Graph } from './harness.js'

// Every row holds a proxy with the same name ('local') and reads its parent's
// 'rows' (same values in every row): resolving each read must not scan all
// same-named nodes (that was O(rows^2) for a global graph). Work is counted
// as visited elements (deterministic), not wall-clock time.
function build(n: number) {
  const r = render(BigList, { n })
  let g: Graph = { nodes: [], edges: [] }
  const visits = countVisits(() => {
    g = graph(null)
  })
  const rowsOk = instances('BigRow').every(row =>
    g.edges.some(e => e.from === `${row.id}:local` && e.to === `${row.id}:(template)`),
  )
  r.destroy()
  return { visits, rowsOk }
}

describe('graph build scaling', () => {
  it('same-named proxies in many rows resolve to their own row, linearly', () => {
    const small = build(250)
    const large = build(1000)
    expect([small.rowsOk, large.rowsOk]).toEqual([true, true])
    // 4x the rows: linear ~4x, quadratic ~16x
    expect(large.visits / small.visits).toBeLessThan(6)
  })
})
