/**
 * Flattening for virtualised trees. Only expanded branches are walked, so
 * cost is proportional to visible rows — except while filtering, where every
 * node is visited once (O(n)) to keep ancestors of matches visible.
 */

export interface TreeRow<N> {
  node: N
  key: string
  depth: number
  parentKey: string | null
  hasChildren: boolean
  expanded: boolean
  /** True when the node itself matches the active filter. */
  match: boolean
  /** 1-based position among visible siblings (aria-posinset). */
  posinset: number
  /** Number of visible siblings including itself (aria-setsize). */
  setsize: number
}

export interface TreeAccess<N> {
  key: (n: N) => string
  children: (n: N) => readonly N[]
}

export function flattenTree<N>(
  roots: readonly N[],
  access: TreeAccess<N>,
  expanded: ReadonlySet<string>,
  filter?: ((n: N) => boolean) | null,
): TreeRow<N>[] {
  const out: TreeRow<N>[] = []
  if (!filter) {
    const walk = (nodes: readonly N[], depth: number, parentKey: string | null) => {
      for (const node of nodes) {
        const key = access.key(node)
        const kids = access.children(node)
        const isOpen = kids.length > 0 && expanded.has(key)
        out.push({
          node,
          key,
          depth,
          parentKey,
          hasChildren: kids.length > 0,
          expanded: isOpen,
          match: false,
          posinset: 0,
          setsize: 0,
        })
        if (isOpen) walk(kids, depth + 1, key)
      }
    }
    walk(roots, 0, null)
    return withSiblingPositions(out)
  }

  // Filtering: emit a node if it matches or any descendant matches; branches
  // with matches are force-expanded so results are always visible. Rows are
  // pushed optimistically and truncated when a subtree has no match (O(n)).
  const visit = (node: N, depth: number, parentKey: string | null): boolean => {
    const key = access.key(node)
    const kids = access.children(node)
    const self = filter(node)
    const at = out.length
    const row: TreeRow<N> = {
      node,
      key,
      depth,
      parentKey,
      hasChildren: kids.length > 0,
      expanded: false,
      match: self,
      posinset: 0,
      setsize: 0,
    }
    out.push(row)
    let any = false
    for (const k of kids) if (visit(k, depth + 1, key)) any = true
    if (!self && !any) {
      out.length = at
      return false
    }
    row.expanded = any
    return true
  }
  for (const r of roots) visit(r, 0, null)
  return withSiblingPositions(out)
}

/**
 * Fill aria-posinset / aria-setsize relative to visible siblings (rows that
 * share a parent), so screen readers announce "3 of 7" rather than the
 * flattened "3 of 5000". O(n) over the emitted rows.
 */
function withSiblingPositions<N>(rows: TreeRow<N>[]): TreeRow<N>[] {
  const counts = new Map<string | null, number>()
  for (const r of rows) {
    const n = (counts.get(r.parentKey) ?? 0) + 1
    counts.set(r.parentKey, n)
    r.posinset = n
  }
  for (const r of rows) r.setsize = counts.get(r.parentKey)!
  return rows
}

/** Every key that has children — for "expand all". */
export function branchKeys<N>(roots: readonly N[], access: TreeAccess<N>): Set<string> {
  const out = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const n = stack.pop()!
    const kids = access.children(n)
    if (kids.length) {
      out.add(access.key(n))
      for (const k of kids) stack.push(k)
    }
  }
  return out
}

// ---- Anchors that survive live updates -----------------------------------

/** Lookup tables of one snapshot of a live tree. */
export interface AnchorIndex<N> {
  byId: ReadonlyMap<number, N>
  byKey: ReadonlyMap<string, N>
}

/** A remembered node: its runtime id (authoritative) plus its path (HMR fallback). */
export interface Anchor {
  id: number | undefined
  path: string
}

/**
 * Re-find an anchored node in a new snapshot.
 *
 * 1. The id is still live → that node (wherever its path moved: removing an
 *    earlier same-name sibling shifts ordinals, a keyed reorder moves it).
 * 2. The id is gone → the node now at the old path, **only if its id is fresh**
 *    (absent from the previous snapshot). That is an HMR remount of the same
 *    slot. A surviving sibling that merely shifted into the path is never
 *    adopted.
 * 3. Otherwise → `null` (the node was unmounted).
 */
export function resolveAnchor<N>(
  anchor: Anchor,
  prevIds: ReadonlySet<number> | ReadonlyMap<number, unknown>,
  next: AnchorIndex<N>,
  idOf: (node: N) => number,
): N | null {
  if (anchor.id !== undefined) {
    const same = next.byId.get(anchor.id)
    if (same) return same
  }
  const atPath = next.byKey.get(anchor.path)
  if (atPath && !prevIds.has(idOf(atPath))) return atPath
  return null
}

/**
 * Carry path-keyed UI state (selection, expanded set) from snapshot `prev`
 * to `next` with `resolveAnchor` semantics. Keys unknown to `prev` keep only
 * their path, so they follow the fresh-id rule. Returns the keys in `next`.
 */
export function remapKeys<N>(
  keys: Iterable<string>,
  prev: AnchorIndex<N> | null,
  next: AnchorIndex<N>,
  idOf: (node: N) => number,
  keyOf: (node: N) => string,
): string[] {
  const prevIds = prev?.byId ?? new Map<number, N>()
  const out: string[] = []
  for (const path of keys) {
    const was = prev?.byKey.get(path)
    const node = resolveAnchor({ id: was ? idOf(was) : undefined, path }, prevIds, next, idOf)
    if (node) out.push(keyOf(node))
  }
  return out
}

/** A snapshot plus the app page load (epoch) its ids belong to. */
export interface EpochIndex<N> extends AnchorIndex<N> {
  /** `''` = server without epochs (always comparable); `null` = unknown (never comparable). */
  epoch: string | null
}

/**
 * `remapKeys` across snapshots that may come from different app page loads.
 * Instance ids restart per page load, so ids are only compared within the
 * same epoch. Across a reload or a flip between app tabs the previous
 * snapshot is ignored and keys resolve by path only: the selection lands on
 * the path-equivalent node (or is dropped), never on a coincident id.
 */
export function remapAcross<N>(
  keys: Iterable<string>,
  prev: EpochIndex<N> | null,
  next: EpochIndex<N>,
  idOf: (node: N) => number,
  keyOf: (node: N) => string,
): string[] {
  const comparable = prev !== null && prev.epoch !== null && prev.epoch === next.epoch
  return remapKeys(keys, comparable ? prev : null, next, idOf, keyOf)
}
