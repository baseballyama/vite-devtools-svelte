import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildLiveTree, type LiveNode } from './live-tree.js'
import {
  branchKeys,
  defaultExpansion,
  flattenTree,
  remapAcross,
  remapKeys,
  resolveAnchor,
  type AnchorIndex,
  type EpochIndex,
} from './tree.js'

// Snapshots are built by the real Components tree builder (`buildLiveTree`):
// keys are `parentPath/Name#ordinal`, ordinal among same-name siblings.
interface Inst {
  id: number
  name: string
  parentId: number | null
}
type Node = LiveNode

function snapshot(list: Inst[]): AnchorIndex<Node> {
  return buildLiveTree(
    list.map(c => ({ ...c, file: `src/${c.name}.svelte`, mounted: true })),
    null,
  )
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
const at = (epoch: string | null, list: Inst[]): EpochIndex<Node> => {
  const { byId, byKey } = snapshot(list)
  return { byId, byKey, epoch }
}
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

  it('stops at `depth` levels and skips leaves', () => {
    const tree = [t('a', t('b', t('c', t('d', t('e'))))), t('leaf'), t('x', t('y'))]
    expect(
      defaultExpansion(
        tree,
        n => n.children,
        n => n.key,
        1,
      ),
    ).toEqual(['a', 'x'])
    expect(
      defaultExpansion(
        tree,
        n => n.children,
        n => n.key,
        0,
      ),
    ).toEqual([])
    expect(
      defaultExpansion(
        tree,
        n => n.children,
        n => n.key,
        10,
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'x'])
  })

  it('is empty while only childless roots have arrived (applied once children do)', () => {
    expect(keys([t('root')])).toEqual([])
    expect(keys([t('root', t('page', t('list', t('item', t('leaf')))))])).toEqual([
      'root',
      'page',
      'list',
    ])
  })
})

describe('tree anchors: edge cases', () => {
  const a = at('A', app([10, 11]))

  it('without a previous snapshot, keys resolve by path (all ids count as fresh)', () => {
    expect(remapKeys(['App#0/Row#1', 'App#0/Row#9'], null, a, idOf, keyOf)).toEqual(['App#0/Row#1'])
    expect(remapAcross(['App#0/Row#1'], null, a, idOf, keyOf)).toEqual(['App#0/Row#1'])
  })

  it("servers without epochs ('' on both sides) compare ids", () => {
    const prev = at('', app([10, 11, 12]))
    const next = at('', app([11, 12]))
    expect(remapAcross(['App#0/Row#2'], prev, next, idOf, keyOf)).toEqual(['App#0/Row#1'])
  })

  it('an unknown previous epoch (null) is never comparable', () => {
    const prev = at(null, app([10, 11, 12]))
    const next = at(null, app([11, 12, 30]))
    expect(remapAcross(['App#0/Row#2'], prev, next, idOf, keyOf)).toEqual(['App#0/Row#2'])
  })

  it('resolveAnchor without an id uses the path only when its id is fresh', () => {
    const next = snapshot(app([10, 11]))
    expect(
      resolveAnchor({ id: undefined, path: 'App#0/Row#0' }, new Set([1]), next, idOf)?.c.id,
    ).toBe(10)
    expect(
      resolveAnchor({ id: undefined, path: 'App#0/Row#0' }, new Set([10]), next, idOf),
    ).toBeNull()
    expect(resolveAnchor({ id: undefined, path: 'nope' }, new Set(), next, idOf)).toBeNull()
  })
})

// ---- flattenTree / branchKeys --------------------------------------------

interface TNode {
  key: string
  children: TNode[]
}
const access = { key: (n: TNode) => n.key, children: (n: TNode) => n.children }
const n = (key: string, ...children: TNode[]): TNode => ({ key, children })
const rows = (r: ReturnType<typeof flattenTree<TNode>>) =>
  r.map(x => `${'  '.repeat(x.depth)}${x.key}`)

/** Random forest with unique keys: node i hangs under an earlier node or is a root. */
const forest = fc.array(fc.nat(), { maxLength: 30 }).map(parents => {
  const nodes: TNode[] = []
  const roots: TNode[] = []
  for (const [i, p] of parents.entries()) {
    const t: TNode = { key: `k${i}`, children: [] }
    // About a third of the nodes are roots.
    const parent = p % 3 === 0 || i === 0 ? null : nodes[p % i]!
    if (parent) parent.children.push(t)
    else roots.push(t)
    nodes.push(t)
  }
  return roots
})

/** A row is expanded iff it has children and its key is in the set. */
const isOpen = (x: { hasChildren: boolean; key: string }, expanded: Set<string>) =>
  x.hasChildren && expanded.has(x.key)

/** Reference for filtering: keys of matching nodes and their ancestors, in pre-order. */
function matchesWithAncestors(roots: TNode[], match: (n: TNode) => boolean): string[] {
  const out: string[] = []
  const visit = (t: TNode): boolean => {
    const start = out.length
    out.push(t.key)
    let any = false
    for (const c of t.children) if (visit(c)) any = true
    if (!match(t) && !any) out.length = start
    return match(t) || any
  }
  for (const t of roots) visit(t)
  return out
}

const all = (ts: readonly TNode[]): TNode[] => ts.flatMap(t => [t, ...all(t.children)])

describe('flattenTree', () => {
  const tree = [n('a', n('a1', n('a1x')), n('a2')), n('b')]

  it('shows only roots when nothing is expanded', () => {
    expect(rows(flattenTree(tree, access, new Set()))).toEqual(['a', 'b'])
  })

  it('walks expanded branches only, depth-first in order', () => {
    expect(rows(flattenTree(tree, access, new Set(['a'])))).toEqual(['a', '  a1', '  a2', 'b'])
    expect(rows(flattenTree(tree, access, new Set(['a', 'a1'])))).toEqual([
      'a',
      '  a1',
      '    a1x',
      '  a2',
      'b',
    ])
    // An expanded key under a collapsed parent stays hidden.
    expect(rows(flattenTree(tree, access, new Set(['a1'])))).toEqual(['a', 'b'])
  })

  it('reports parent, children, expansion and sibling positions', () => {
    const r = flattenTree(tree, access, new Set(['a', 'b']))
    expect(
      r.map(x => [x.key, x.parentKey, x.hasChildren, x.expanded, x.posinset, x.setsize]),
    ).toEqual([
      ['a', null, true, true, 1, 2],
      ['a1', 'a', true, false, 1, 2],
      ['a2', 'a', false, false, 2, 2],
      // A leaf is never "expanded", even if its key is in the set.
      ['b', null, false, false, 2, 2],
    ])
    expect(r.every(x => !x.match)).toBe(true)
  })

  it('an empty filter result is empty; a null filter is no filter', () => {
    expect(flattenTree(tree, access, new Set(), () => false)).toEqual([])
    expect(rows(flattenTree(tree, access, new Set(), null))).toEqual(['a', 'b'])
  })

  it('filtering shows matches with their ancestors, force-expanded, ignoring the expanded set', () => {
    const r = flattenTree(tree, access, new Set(), x => ['a1x', 'b'].includes(x.key))
    expect(rows(r)).toEqual(['a', '  a1', '    a1x', 'b'])
    expect(r.map(x => [x.key, x.match, x.expanded, x.posinset, x.setsize])).toEqual([
      ['a', false, true, 1, 2],
      ['a1', false, true, 1, 1],
      ['a1x', true, false, 1, 1],
      ['b', true, false, 2, 2],
    ])
  })

  it('a matching branch without matching descendants stays collapsed', () => {
    const r = flattenTree(tree, access, new Set(['a']), x => x.key === 'a')
    expect(rows(r)).toEqual(['a'])
    expect(r[0]).toMatchObject({ match: true, expanded: false, hasChildren: true })
  })

  it('property: expanding every branch lists every node once, in pre-order', () => {
    fc.assert(
      fc.property(forest, f => {
        const r = flattenTree(f, access, branchKeys(f, access))
        expect(r.map(x => x.key)).toEqual(all(f).map(x => x.key))
      }),
    )
  })

  it('property: row count = roots + children of every visible expanded row; positions are consistent', () => {
    fc.assert(
      fc.property(forest, fc.func(fc.boolean()), (f, pick) => {
        const expanded = new Set(
          all(f)
            .filter(x => pick(x.key))
            .map(x => x.key),
        )
        const r = flattenTree(f, access, expanded)
        const expectCount =
          f.length + r.filter(x => x.expanded).reduce((s, x) => s + x.node.children.length, 0)
        expect(r).toHaveLength(expectCount)
        expect(r.filter(x => x.expanded !== isOpen(x, expanded))).toEqual([])
        for (const x of r) {
          const sibs = r.filter(y => y.parentKey === x.parentKey)
          expect(x.setsize).toBe(sibs.length)
          expect(sibs[x.posinset - 1]).toBe(x)
        }
      }),
    )
  })

  it('property: filtered rows = matches ∪ their ancestors, in pre-order', () => {
    fc.assert(
      fc.property(forest, fc.func(fc.boolean()), (f, pick) => {
        const match = (x: TNode) => pick(x.key)
        const r = flattenTree(f, access, new Set(), match)
        expect(r.map(x => x.key)).toEqual(matchesWithAncestors(f, match))
        for (const x of r) expect(x.match).toBe(match(x.node))
      }),
    )
  })
})

describe('branchKeys', () => {
  it('collects every node with children, at any depth', () => {
    const tree = [n('a', n('a1', n('a1x')), n('a2')), n('b')]
    expect([...branchKeys(tree, access)].toSorted()).toEqual(['a', 'a1'])
    expect(branchKeys([], access).size).toBe(0)
  })
})
