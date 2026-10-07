import type { ComponentInstance } from './types.js'

/** A mounted component instance in the Components tree. */
export interface LiveNode {
  c: ComponentInstance
  /** Path key: `Parent#0/Name#ordinal` (ordinal among same-name siblings). */
  key: string
  children: LiveNode[]
}

export interface LiveTree {
  roots: LiveNode[]
  byId: Map<number, LiveNode>
  byKey: Map<string, LiveNode>
  /** Keys of roots whose parent lies outside the server's bounded capture. */
  detached: Set<string>
  epoch: string | null
}

/**
 * Build the instance tree of one live snapshot. Rows are keyed by a path
 * (`Parent#0/Name#ordinal`, ordinal among same-name siblings). Tree order is
 * registration order, which can differ from DOM order after keyed reorders.
 */
export function buildLiveTree(list: readonly ComponentInstance[], epoch: string | null): LiveTree {
  const byId = new Map<number, LiveNode>()
  for (const c of list) byId.set(c.id, { c, key: '', children: [] })
  const roots: LiveNode[] = []
  // A parent outside the server's bounded capture leaves its subtree
  // without an anchor: surface it as a root, flagged as detached.
  const detachedNodes = new Set<LiveNode>()
  for (const node of byId.values()) {
    const parent = node.c.parentId === null ? undefined : byId.get(node.c.parentId)
    if (parent) parent.children.push(node)
    else {
      roots.push(node)
      if (node.c.parentId !== null) detachedNodes.add(node)
    }
  }
  const byKey = new Map<string, LiveNode>()
  const assign = (nodes: LiveNode[], prefix: string) => {
    const seen = new Map<string, number>()
    for (const n of nodes) {
      const ord = seen.get(n.c.name) ?? 0
      seen.set(n.c.name, ord + 1)
      n.key = `${prefix}${detachedNodes.has(n) ? '~' : ''}${n.c.name}#${ord}`
      byKey.set(n.key, n)
      if (n.children.length > 0) assign(n.children, n.key + '/')
    }
  }
  assign(roots, '')
  const detached = new Set([...detachedNodes].map(n => n.key))
  return { roots, byId, byKey, detached, epoch }
}
