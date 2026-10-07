import { describe, it, expect } from 'vitest'

import { summarizeReactiveProblems, listPerformanceIssues } from '../../src/mcp/issues.js'
import DerivedConsumers from './fixtures/DerivedConsumers.svelte'
import { render, instance, graph, node, outgoing } from './harness.js'

describe('derived consumers', () => {
  it('reads from the markup are edges to the component (template) node', () => {
    const r = render(DerivedConsumers)
    const c = instance('DerivedConsumers')
    expect(c.file).toMatch(/fixtures\/DerivedConsumers\.svelte$/)
    for (const g of [graph(c.id), graph(null)]) {
      const template = `${c.id}:(template)`
      expect(g.nodes.find(n => n.id === template)).toMatchObject({
        type: 'template',
        componentId: c.id,
      })
      for (const name of ['inIf', 'inHead', 'inText', 'inEach', 'inAttr']) {
        expect({ name, readers: outgoing(g, node(g, c.id, name).id) }).toEqual({
          name,
          readers: [template],
        })
      }
      expect(outgoing(g, node(g, c.id, 'inEffect').id)).toEqual([`${c.id}:effect_1`])
      // read only by an event handler / never read: no reactive reader
      expect(outgoing(g, node(g, c.id, 'inHandler').id)).toEqual([])
      expect(outgoing(g, node(g, c.id, 'neverRead').id)).toEqual([])
    }
    r.destroy()
  })

  it('problems: markup readers are not reported; never-evaluated deriveds are', () => {
    const r = render(DerivedConsumers)
    const c = instance('DerivedConsumers')
    // not evaluated yet: the handler has not run
    expect(
      summarizeReactiveProblems(graph(null) as any)
        .orphanDeriveds.map(d => d.name)
        .toSorted(),
    ).toEqual(['inHandler', 'neverRead'])
    const log = console.log
    console.log = () => {}
    r.target.querySelector('button')!.click()
    console.log = log
    const g = graph(null) as any
    const problems = summarizeReactiveProblems(g)
    // read by the handler: used, even without a reactive reader
    expect(problems.orphanDeriveds.map(d => d.name)).toEqual(['neverRead'])
    // no node of the markup readers is "isolated"
    expect(problems.isolatedNodes.map(n => n.name)).not.toContain('inIf')
    const issues = listPerformanceIssues({
      renderProfiles: [],
      reactiveGraph: g,
      loadProfiles: [],
      fpsSamples: [],
    })
    // a handful of signals read by markup and one effect: nothing to report
    expect(issues).toEqual([])
    expect(problems.orphanDeriveds.map(d => d.id)).toEqual([`${c.id}:neverRead`])
    r.destroy()
  })
})
