import { describe, it, expect } from 'vitest'
import BigList from './fixtures/BigList.svelte'
import { render, instances, graph } from './harness.js'

// Every row holds a proxy with the same name ('local') and reads its parent's
// 'rows' (same values in every row): resolving each read must not scan all
// same-named nodes (that was O(rows^2) for a global graph).
function build(n: number) {
  const r = render(BigList, { n })
  const t0 = performance.now()
  const g = graph(null)
  const ms = performance.now() - t0
  const rowsOk = instances('BigRow').every(row =>
    g.edges.some(e => e.from === `${row.id}:local` && e.to === `${row.id}:(template)`),
  )
  r.destroy()
  return { ms, rowsOk, edges: g.edges.length }
}

describe('graph build scaling', () => {
  it('same-named proxies in many rows resolve to their own row, near-linearly', () => {
    build(50) // warm up
    const small = build(250)
    const large = build(1000)
    expect(small.rowsOk && large.rowsOk).toBe(true)
    // 4x the rows: linear ~4x, quadratic ~16x
    expect(large.ms / Math.max(small.ms, 1)).toBeLessThan(10)
  })
})
