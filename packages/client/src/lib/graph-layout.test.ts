import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  layoutGraph,
  NODE_H,
  NODE_W,
  propagate,
  shortFile,
  type GraphLayout,
} from './graph-layout.js'
import type { ReactiveEdge, ReactiveNode } from './types.js'

const TYPES = ['state', 'derived', 'effect', 'template'] as const

const node = (
  id: string,
  file = 'src/A.svelte',
  type: ReactiveNode['type'] = 'state',
): ReactiveNode => ({
  id,
  type,
  name: id,
  componentId: 1,
  componentFile: file,
})
const edge = (from: string, to: string): ReactiveEdge => ({ from, to })

/** Random graphs: up to 25 nodes over 4 files, edges between existing ids (cycles allowed). */
const graph = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.constantFrom(...TYPES)), {
    minLength: 1,
    maxLength: 25,
  })
  .chain(specs => {
    const nodes = specs.map(([f, t], i) =>
      node(`n${i}`, `src/${f % 2 ? 'a' : 'b'}/C${f}.svelte`, t),
    )
    const idx = fc.integer({ min: 0, max: nodes.length - 1 })
    return fc
      .array(fc.tuple(idx, idx), { maxLength: 40 })
      .map(pairs => ({ nodes, edges: pairs.map(([a, b]) => edge(nodes[a]!.id, nodes[b]!.id)) }))
  })

type Box = GraphLayout['componentBoxes'][number]

/** Node tops per column (layer), sorted. */
function columns(points: Iterable<{ x: number; y: number }>): number[][] {
  const byX = new Map<number, number[]>()
  for (const p of points) byX.set(p.x, [...(byX.get(p.x) ?? []), p.y])
  return [...byX.values()].map(ys => ys.toSorted((a, b) => a - b))
}

/** The box of `file` in the column at `x`. */
function boxAround(boxes: Box[], file: string, x: number): Box | undefined {
  return boxes.find(b => b.componentFile === file && b.x < x && x < b.x + b.w)
}

/** Pairs of boxes in one column that overlap vertically. */
function overlappingBoxes(boxes: Box[]): [Box, Box][] {
  return boxes.flatMap((a, i) =>
    boxes
      .slice(i + 1)
      .filter(b => a.x === b.x && a.y + a.h > b.y && b.y + b.h > a.y)
      .map(b => [a, b] as [Box, Box]),
  )
}

/** Reference for `propagate`: Bellman-Ford relaxation from the changed nodes. */
function shortestDistances(changed: Set<string>, edges: ReactiveEdge[], rounds: number) {
  const dist = new Map<string, number>([...changed].map(id => [id, 0]))
  for (let round = 0; round < rounds; round++)
    for (const e of edges) {
      const d = dist.get(e.from)
      if (d !== undefined && (dist.get(e.to) ?? Infinity) > d + 1) dist.set(e.to, d + 1)
    }
  return dist
}

/** `from→to` keys of the edges between reached nodes. */
function edgesWithin(edges: ReactiveEdge[], reached: Map<string, number>): Set<string> {
  return new Set(
    edges.filter(e => reached.has(e.from) && reached.has(e.to)).map(e => `${e.from}→${e.to}`),
  )
}

describe('shortFile', () => {
  it.each([
    ['src/lib/Counter.svelte', 'Counter'],
    ['Counter.svelte', 'Counter'],
    ['C:\\app\\src\\Row.svelte', 'Row'],
    // Module state: only a trailing `.svelte` is the component extension.
    ['src/lib/store.svelte.ts', 'store.svelte.ts'],
    ['src/lib/a.svelte.svelte', 'a.svelte'],
    ['', ''],
  ])('shortFile(%j) → %j', (file, expected) => {
    expect(shortFile(file)).toBe(expected)
  })
})

describe('layoutGraph', () => {
  it('is empty for no nodes', () => {
    expect(layoutGraph([], [])).toEqual({
      positions: new Map(),
      width: 0,
      height: 0,
      componentBoxes: [],
    })
  })

  it('places a chain left to right, one layer per step', () => {
    const l = layoutGraph(
      [node('a'), node('b', 'src/A.svelte', 'derived'), node('c', 'src/A.svelte', 'effect')],
      [edge('a', 'b'), edge('b', 'c')],
    )
    const xs = ['a', 'b', 'c'].map(id => l.positions.get(id)!.x)
    expect(xs[0]).toBeLessThan(xs[1]!)
    expect(xs[1]).toBeLessThan(xs[2]!)
    expect(l.width).toBeGreaterThan(xs[2]! + NODE_W)
  })

  it('orders state before derived before effect within a component layer', () => {
    const l = layoutGraph(
      [node('e', 'f', 'effect'), node('d', 'f', 'derived'), node('s', 'f', 'state')],
      [],
    )
    const y = (id: string) => l.positions.get(id)!.y
    expect(y('s')).toBeLessThan(y('d'))
    expect(y('d')).toBeLessThan(y('e'))
  })

  it('sorts a node type it does not know (newer runtime) after the known ones', () => {
    const l = layoutGraph(
      [
        node('x', 'f', 'future' as ReactiveNode['type']),
        node('e', 'f', 'effect'),
        node('s', 'f', 'state'),
      ],
      [],
    )
    const y = (id: string) => l.positions.get(id)!.y
    expect(y('s')).toBeLessThan(y('e'))
    expect(y('e')).toBeLessThan(y('x'))
  })

  it('puts cycle members (and what they feed) in a trailing layer instead of dropping them', () => {
    const l = layoutGraph(
      [node('root'), node('x'), node('y'), node('z')],
      [edge('root', 'x'), edge('x', 'y'), edge('y', 'x'), edge('y', 'z')],
    )
    expect([...l.positions.keys()].toSorted()).toEqual(['root', 'x', 'y', 'z'])
    expect(l.positions.get('x')!.x).toBeGreaterThan(l.positions.get('root')!.x)
  })

  it('ignores edges to nodes it was not given (used to crash)', () => {
    const l = layoutGraph(
      [node('a'), node('b')],
      [edge('a', 'ghost'), edge('ghost', 'b'), edge('a', 'b')],
    )
    expect([...l.positions.keys()].toSorted()).toEqual(['a', 'b'])
    expect(l.positions.get('b')!.x).toBeGreaterThan(l.positions.get('a')!.x)
  })

  it('gives same-named components in different folders separate boxes', () => {
    const nodes = [
      node('a1', 'src/a/Row.svelte'),
      node('m', 'src/a/Z.svelte'),
      node('b1', 'src/b/Row.svelte'),
    ]
    const l = layoutGraph(nodes, [])
    expect(l.componentBoxes.map(b => [b.file, b.componentFile])).toEqual([
      ['Row', 'src/a/Row.svelte'],
      ['Z', 'src/a/Z.svelte'],
      ['Row', 'src/b/Row.svelte'],
    ])
  })

  describe('invariants (property)', () => {
    it('every node gets exactly one finite position; nothing else is placed', () => {
      fc.assert(
        fc.property(graph, ({ nodes, edges }) => {
          const l = layoutGraph(nodes, edges)
          expect([...l.positions.keys()].toSorted()).toEqual(nodes.map(n => n.id).toSorted())
          for (const p of l.positions.values()) {
            expect(Number.isFinite(p.x)).toBe(true)
            expect(Number.isFinite(p.y)).toBe(true)
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeGreaterThanOrEqual(0)
            expect(p.x + NODE_W).toBeLessThanOrEqual(l.width)
            expect(p.y + NODE_H).toBeLessThanOrEqual(l.height)
          }
        }),
      )
    })

    it('nodes in one layer never overlap', () => {
      fc.assert(
        fc.property(graph, ({ nodes, edges }) => {
          for (const ys of columns(layoutGraph(nodes, edges).positions.values()))
            for (let i = 1; i < ys.length; i++)
              expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(NODE_H)
        }),
      )
    })

    it('an acyclic edge always points to a later layer', () => {
      fc.assert(
        fc.property(graph, ({ nodes, edges }) => {
          // Keep only forward edges (by index) so the graph is a DAG.
          const order = new Map(nodes.map((n, i) => [n.id, i]))
          const dag = edges.filter(e => order.get(e.from)! < order.get(e.to)!)
          const l = layoutGraph(nodes, dag)
          for (const e of dag)
            expect(l.positions.get(e.to)!.x).toBeGreaterThan(l.positions.get(e.from)!.x)
        }),
      )
    })

    it('component boxes contain their nodes and do not overlap within a layer', () => {
      fc.assert(
        fc.property(graph, ({ nodes, edges }) => {
          const l = layoutGraph(nodes, edges)
          for (const n of nodes) {
            const p = l.positions.get(n.id)!
            const box = boxAround(l.componentBoxes, n.componentFile, p.x)
            expect(box).toBeDefined()
            expect(box!.y).toBeLessThan(p.y)
            expect(p.y + NODE_H).toBeLessThan(box!.y + box!.h)
            expect(box!.file).toBe(shortFile(n.componentFile))
          }
          expect(overlappingBoxes(l.componentBoxes)).toEqual([])
        }),
      )
    })

    it('is deterministic and independent of input mutation', () => {
      fc.assert(
        fc.property(graph, ({ nodes, edges }) => {
          const snapshot = JSON.stringify({ nodes, edges })
          const a = layoutGraph(nodes, edges)
          const b = layoutGraph(nodes, edges)
          expect(b).toEqual(a)
          expect(JSON.stringify({ nodes, edges })).toBe(snapshot)
        }),
      )
    })
  })
})

describe('propagate', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => node(id))
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c'), edge('d', 'e'), edge('c', 'a')]

  it('is empty without changes', () => {
    const p = propagate(nodes, edges, new Set())
    expect([p.affected.size, p.edgeKeys.size, p.depths.size]).toEqual([0, 0, 0])
  })

  it('reaches every downstream node with its shortest distance (cycles terminate)', () => {
    const p = propagate(nodes, edges, new Set(['a']))
    expect([...p.affected].toSorted()).toEqual(['a', 'b', 'c'])
    expect(Object.fromEntries(p.depths)).toEqual({ a: 0, b: 1, c: 1 })
    expect([...p.edgeKeys].toSorted()).toEqual(['a→b', 'a→c', 'b→c', 'c→a'])
  })

  it('takes the nearest of several changed nodes', () => {
    const p = propagate(nodes, edges, new Set(['b', 'd']))
    expect(Object.fromEntries(p.depths)).toEqual({ b: 0, d: 0, c: 1, e: 1, a: 2 })
  })

  it('keeps a changed id that is not in the graph (nothing downstream)', () => {
    const p = propagate(nodes, edges, new Set(['ghost']))
    expect([...p.affected]).toEqual(['ghost'])
    expect(p.edgeKeys.size).toBe(0)
  })

  it('property: depths equal BFS shortest paths; edges are exactly those inside the affected set', () => {
    fc.assert(
      fc.property(
        graph,
        fc.array(fc.nat(30), { maxLength: 3 }),
        ({ nodes: ns, edges: es }, picks) => {
          const changed = new Set(picks.filter(i => i < ns.length).map(i => ns[i]!.id))
          const p = propagate(ns, es, changed)
          const dist = shortestDistances(changed, es, ns.length)
          expect(Object.fromEntries(p.depths)).toEqual(Object.fromEntries(dist))
          expect(p.edgeKeys).toEqual(edgesWithin(es, dist))
        },
      ),
    )
  })
})
