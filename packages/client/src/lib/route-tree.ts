import type { RouteInfo } from './types.js'

/** One `src/routes` directory segment; `route` is set when it has route files. */
export interface RouteNode {
  key: string
  segment: string
  route: RouteInfo | null
  children: RouteNode[]
}

export interface RouteTree {
  roots: RouteNode[]
  byKey: Map<string, RouteNode>
}

/**
 * Build a segment tree keyed by route id so `(group)` / `[param]`
 * directories nest exactly like src/routes on disk.
 */
export function buildRouteTree(routes: readonly RouteInfo[]): RouteTree {
  const root: RouteNode = { key: '/', segment: '/', route: null, children: [] }
  const byKey = new Map<string, RouteNode>([['/', root]])
  const sorted = routes.toSorted((a, b) => a.id.localeCompare(b.id))
  for (const r of sorted) {
    if (r.id === '/') {
      root.route = r
      continue
    }
    let parent = root
    let key = ''
    for (const seg of r.id.split('/').filter(Boolean)) {
      key += '/' + seg
      let node = byKey.get(key)
      if (!node) {
        node = { key, segment: seg, route: null, children: [] }
        byKey.set(key, node)
        parent.children.push(node)
      }
      parent = node
    }
    parent.route = r
  }
  return { roots: [root], byKey }
}
