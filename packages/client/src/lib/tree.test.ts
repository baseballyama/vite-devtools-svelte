import { describe, expect, it } from 'vitest'

import {
  defaultExpansion,
  remapAcross,
  remapKeys,
  resolveAnchor,
  type AnchorIndex,
  type EpochIndex,
} from './tree.js'

// Mirrors Components.svelte keying: `parentPath/Name#ordinal`, ordinal among
// same-name siblings in snapshot (registration) order.
interface Inst {
  id: number
  name: string
  parentId: number | null
}
interface Node {
  c: Inst
  key: string
}

function snapshot(list: Inst[]): AnchorIndex<Node> {
  const byId = new Map<number, Node>()
  const kids = new Map<number | null, Node[]>()
  for (const c of list) {
    const n = { c, key: '' }
    byId.set(c.id, n)
    ;(kids.get(c.parentId) ?? kids.set(c.parentId, []).get(c.parentId)!).push(n)
  }
  const byKey = new Map<string, Node>()
  const assign = (parent: number | null, prefix: string) => {
    const seen = new Map<string, number>()
    for (const n of kids.get(parent) ?? []) {
      const ord = seen.get(n.c.name) ?? 0
      seen.set(n.c.name, ord + 1)
      n.key = `${prefix}${n.c.name}#${ord}`
      byKey.set(n.key, n)
      assign(n.c.id, n.key + '/')
    }
  }
  assign(null, '')
  return { byId, byKey }
}

const idOf = (n: Node) => n.c.id
const keyOf = (n: Node) => n.key
const app = (rowIds: number[], extra: Inst[] = []): Inst[] => [
  { id: 1, name: 'App', parentId: null },
  ...rowIds.map(id => ({ id, name: 'Row', parentId: 1 })),
  ...extra,
]
const remap1 = (key: string, prev: AnchorIndex<Node>, next: AnchorIndex<Node>) =>
  remapKeys([key], prev, next, idOf, keyOf)[0] ?? null
/** Rows with a `Cell` child under 11, 13 (unless `removedChild`) and 14. */
const withKids = (rowIds: number[], removedChild = false) =>
  app(rowIds, [
    { id: 111, name: 'Cell', parentId: 11 },
    ...(removedChild ? [] : [{ id: 131, name: 'Cell', parentId: 13 }]),
    { id: 141, name: 'Cell', parentId: 14 },
  ])
const at = (epoch: string | null, list: Inst[]): EpochIndex<Node> => ({
  ...snapshot(list),
  epoch,
})
const across = (key: string, prev: EpochIndex<Node>, next: EpochIndex<Node>) =>
  remapAcross([key], prev, next, idOf, keyOf)[0] ?? null

describe('tree anchors (review U4b)', () => {
  const rows = [10, 11, 12, 13, 14]
  const prev = snapshot(app(rows))
  const selected = 'App#0/Row#3' // id 13

  it('removing an earlier same-name sibling keeps the same instance', () => {
    const next = snapshot(app([11, 12, 13, 14]))
    const key = remap1(selected, prev, next)
    expect(key).toBe('App#0/Row#2')
    expect(next.byKey.get(key!)!.c.id).toBe(13)
  })

  it('unshift (a new instance before it) keeps the same instance', () => {
    const next = snapshot(app([99, ...rows]))
    const key = remap1(selected, prev, next)
    expect(next.byKey.get(key!)!.c.id).toBe(13)
    expect(key).toBe('App#0/Row#4')
  })

  it('keyed reverse keeps the same instance', () => {
    const next = snapshot(app(rows.toReversed()))
    const key = remap1(selected, prev, next)
    expect(next.byKey.get(key!)!.c.id).toBe(13)
    expect(key).toBe('App#0/Row#1')
  })

  it('HMR remount (all ids fresh, same order) falls back to the same path', () => {
    const next = snapshot([
      { id: 2, name: 'App', parentId: null },
      ...[20, 21, 22, 23, 24].map(id => ({ id, name: 'Row', parentId: 2 })),
    ])
    const key = remap1(selected, prev, next)
    expect(key).toBe(selected)
    expect(next.byKey.get(key!)!.c.id).toBe(23)
  })

  it('selected instance removed while a sibling shifts into its path → cleared, not moved', () => {
    const next = snapshot(app([10, 11, 12, 14]))
    expect(next.byKey.get(selected)!.c.id).toBe(14) // the trap: path now points at the neighbour
    expect(remap1(selected, prev, next)).toBeNull()
    expect(resolveAnchor({ id: 13, path: selected }, prev.byId, next, idOf)).toBeNull()
  })

  it('expanded set follows the same rules', () => {
    const p = snapshot(withKids(rows))
    const expanded = ['App#0', 'App#0/Row#1', 'App#0/Row#3'] // ids 1, 11, 13

    // earlier sibling removed → same instances, shifted paths
    const shifted = snapshot(withKids([11, 12, 13, 14]))
    expect(remapKeys(expanded, p, shifted, idOf, keyOf)).toEqual([
      'App#0',
      'App#0/Row#0',
      'App#0/Row#2',
    ])

    // expanded instance 13 removed → dropped; 14 (shifted into Row#3) stays collapsed
    const removed = snapshot(withKids([10, 11, 12, 14], true))
    expect(remapKeys(expanded, p, removed, idOf, keyOf)).toEqual(['App#0', 'App#0/Row#1'])

    // HMR: fresh ids, same structure → same paths
    const hmr = snapshot([
      { id: 2, name: 'App', parentId: null },
      ...[20, 21, 22, 23, 24].map(id => ({ id, name: 'Row', parentId: 2 })),
      { id: 211, name: 'Cell', parentId: 21 },
      { id: 231, name: 'Cell', parentId: 23 },
    ])
    expect(remapKeys(expanded, p, hmr, idOf, keyOf)).toEqual(expanded)
  })
})

describe('tree anchors across app page loads (review U4b epoch)', () => {
  const selected = 'App#0/Row#3' // id 13 in epoch A

  it('reload: ids reused by the new page load → resolve by path, not by id', () => {
    const a = at('A', app([10, 11, 12, 13, 14]))
    const b = at('B', app([13, 20, 21, 22, 23])) // id 13 now an unrelated first row
    expect(remapKeys([selected], a, b, idOf, keyOf)).toEqual(['App#0/Row#0']) // id-based would jump
    const key = across(selected, a, b)
    expect(key).toBe(selected)
    expect(b.byKey.get(key!)!.c.id).toBe(22)
    // same epoch still uses ids
    expect(across(selected, a, at('A', app([11, 12, 13, 14])))).toBe('App#0/Row#2')
  })

  it('A→B→A tab flip with coincident ids never lands on the coincident id', () => {
    const a = at('A', app([10, 11, 12, 13, 14]))
    const b = at('B', app([12, 13, 30, 31, 32])) // id 13 at Row#1 in the other tab
    const inB = across(selected, a, b)
    expect(inB).toBe(selected)
    expect(b.byKey.get(inB!)!.c.id).toBe(31)
    const backInA = across(inB!, b, at('A', app([10, 11, 12, 13, 14])))
    expect(backInA).toBe(selected)
    // an epoch read that flipped mid-fetch (null) is never comparable either
    expect(across(selected, a, at(null, app([13, 20, 21, 22, 23])))).toBe(selected)
  })
})

describe('defaultExpansion', () => {
  type T = { key: string; children: T[] }
  const t = (key: string, ...children: T[]): T => ({ key, children })
  const keys = (roots: T[]) =>
    defaultExpansion(
      roots,
      n => n.children,
      n => n.key,
    )

  it('is empty while only childless roots have arrived (applied once children do)', () => {
    expect(keys([t('root')])).toEqual([])
    expect(keys([t('root', t('page', t('list', t('item', t('leaf')))))])).toEqual([
      'root',
      'page',
      'list',
    ])
  })
})
