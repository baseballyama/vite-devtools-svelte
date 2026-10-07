import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildLiveTree, type LiveNode } from './live-tree.js'
import type { ComponentInstance } from './types.js'

const c = (id: number, name: string, parentId: number | null): ComponentInstance => ({
  id,
  name,
  parentId,
  file: `src/${name}.svelte`,
  mounted: true,
})

const keys = (nodes: LiveNode[]): string[] => nodes.flatMap(n => [n.key, ...keys(n.children)])

/**
 * Random snapshots: parents are earlier instances (the runtime registers
 * parents first) or instances outside the capture (ids ≥ 1000).
 */
const instances = fc
  .array(fc.tuple(fc.constantFrom('A', 'B', 'C'), fc.option(fc.nat(40), { nil: null })), {
    maxLength: 40,
  })
  .map(specs => specs.map(([name, p], i) => c(i, name, parentFor(p, i))))

function parentFor(p: number | null, i: number): number | null {
  if (p === null) return null
  return p % (i + 1) === i ? 1000 + p : p % (i + 1)
}

/** Has a parent that is not in the snapshot. */
const outsideCapture = (x: ComponentInstance, ids: Set<number>) =>
  x.parentId !== null && !ids.has(x.parentId)

/** A root of the tree: top-level, or detached from an uncaptured parent. */
const belongsAtTop = (x: ComponentInstance, ids: Set<number>) =>
  x.parentId === null || outsideCapture(x, ids)

describe('buildLiveTree', () => {
  it('is empty for no instances and keeps the epoch', () => {
    const t = buildLiveTree([], 'e1')
    expect(t).toMatchObject({ roots: [], epoch: 'e1' })
    expect([t.byId.size, t.byKey.size, t.detached.size]).toEqual([0, 0, 0])
  })

  it('nests children under parents and keys them by path + ordinal among same-name siblings', () => {
    const t = buildLiveTree(
      [c(1, 'App', null), c(2, 'Row', 1), c(3, 'Nav', 1), c(4, 'Row', 1), c(5, 'Cell', 4)],
      null,
    )
    expect(keys(t.roots)).toEqual([
      'App#0',
      'App#0/Row#0',
      'App#0/Nav#0',
      'App#0/Row#1',
      'App#0/Row#1/Cell#0',
    ])
    expect(t.byKey.get('App#0/Row#1')!.c.id).toBe(4)
    expect(t.byId.get(5)!.key).toBe('App#0/Row#1/Cell#0')
    expect(t.detached.size).toBe(0)
  })

  it('numbers several top-level roots by name', () => {
    const t = buildLiveTree([c(1, 'App', null), c(2, 'App', null), c(3, 'Toast', null)], null)
    expect(keys(t.roots)).toEqual(['App#0', 'App#1', 'Toast#0'])
  })

  it('keeps registration order, not id order', () => {
    const t = buildLiveTree([c(1, 'App', null), c(9, 'Row', 1), c(2, 'Row', 1)], null)
    expect(t.roots[0]!.children.map(n => n.c.id)).toEqual([9, 2])
    expect(t.byId.get(2)!.key).toBe('App#0/Row#1')
  })

  it('surfaces a subtree whose parent was not captured as a detached root (~)', () => {
    const t = buildLiveTree([c(1, 'App', null), c(7, 'Row', 99), c(8, 'Cell', 7)], null)
    expect(keys(t.roots)).toEqual(['App#0', '~Row#0', '~Row#0/Cell#0'])
    expect([...t.detached]).toEqual(['~Row#0'])
  })

  it('a child registered before its parent still nests under it', () => {
    const t = buildLiveTree([c(2, 'Row', 1), c(1, 'App', null)], null)
    expect(keys(t.roots)).toEqual(['App#0', 'App#0/Row#0'])
  })

  it('property: every instance is indexed once by id and by a unique key; detached ⇔ missing parent', () => {
    fc.assert(
      fc.property(instances, l => {
        const t = buildLiveTree(l, 'e')
        const ids = new Set(l.map(x => x.id))
        expect(t.byId.size).toBe(l.length)
        expect(t.byKey.size).toBe(l.length)
        expect(keys(t.roots)).toHaveLength(l.length)
        for (const node of t.byKey.values()) expect(t.byId.get(node.c.id)).toBe(node)
        const wantDetached = l.filter(x => outsideCapture(x, ids)).map(x => t.byId.get(x.id)!.key)
        expect([...t.detached].toSorted()).toEqual(wantDetached.toSorted())
        expect(t.roots.filter(r => !belongsAtTop(r.c, ids))).toEqual([])
      }),
    )
  })
})
