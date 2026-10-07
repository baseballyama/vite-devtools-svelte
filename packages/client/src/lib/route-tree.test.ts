import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildRouteTree, type RouteNode } from './route-tree.js'
import type { RouteInfo } from './types.js'

const route = (id: string): RouteInfo => ({
  id,
  path: id,
  pattern: '',
  segments: id.split('/').filter(Boolean),
  hasPage: true,
  hasLayout: false,
  hasServerPage: false,
  hasServerLayout: false,
  hasEndpoint: false,
  hasPageLoad: false,
  hasLayoutLoad: false,
  params: [],
  files: [],
})

const outline = (nodes: RouteNode[], depth = 0): string[] =>
  nodes.flatMap(n => [
    `${'  '.repeat(depth)}${n.segment}${n.route ? '' : ' (dir)'}`,
    ...outline(n.children, depth + 1),
  ])

/** Key of a child segment under `parent` (the root is `/`, not a prefix). */
const childKey = (parent: string, segment: string) => `${parent === '/' ? '' : parent}/${segment}`

describe('buildRouteTree', () => {
  it('always has the "/" root, without a route when there is none', () => {
    const t = buildRouteTree([])
    expect(outline(t.roots)).toEqual(['/ (dir)'])
    expect([...t.byKey.keys()]).toEqual(['/'])
  })

  it('nests segments like src/routes, with intermediate directories and sorted siblings', () => {
    const t = buildRouteTree(['/blog/[slug]', '/', '/(app)/settings', '/about', '/blog'].map(route))
    expect(outline(t.roots)).toEqual([
      '/',
      '  (app) (dir)',
      '    settings',
      '  about',
      '  blog',
      '    [slug]',
    ])
    expect(t.byKey.get('/blog/[slug]')!.route!.id).toBe('/blog/[slug]')
    expect(t.byKey.get('/(app)')!.route).toBeNull()
  })

  it('does not mutate its input order', () => {
    const input = ['/b', '/a'].map(route)
    buildRouteTree(input)
    expect(input.map(r => r.id)).toEqual(['/b', '/a'])
  })

  it('property: every route is reachable at its id and every key is a prefix path', () => {
    const seg = fc.constantFrom('a', 'b', '[id]', '(g)', '[[opt]]', '[...rest]')
    const ids = fc.uniqueArray(
      fc.array(seg, { maxLength: 4 }).map(s => '/' + s.join('/')),
      { maxLength: 15 },
    )
    fc.assert(
      fc.property(ids, list => {
        const t = buildRouteTree(list.map(route))
        for (const id of list) expect(t.byKey.get(id)!.route!.id).toBe(id)
        const withRoute = [...t.byKey.values()].filter(x => x.route)
        expect(withRoute).toHaveLength(list.length)
        for (const [key, node] of t.byKey) {
          expect(node.key).toBe(key)
          for (const child of node.children) expect(child.key).toBe(childKey(key, child.segment))
        }
      }),
    )
  })
})
