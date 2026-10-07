import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Route analysis over generated src/routes trees (SvelteKit routing rules:
 * kit docs "Routing" and "Advanced routing").
 */
import * as fc from 'fast-check'
import { describe, it, expect, afterAll } from 'vitest'

import { analyzeRoutes, classifyFile, parseRouteId } from '../src/analyzers/routes.js'
import type { ParamInfo, RouteFile, RouteInfo } from '../src/types.js'

const tmpRoots: string[] = []
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true })
})

/** Create `src/routes` with the given files (`/`-separated, relative to it). */
function routesTree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-routes-'))
  tmpRoots.push(root)
  for (const f of files) {
    const full = path.join(root, ...f.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, '')
  }
  return root
}

const p = (name: string, extra: Partial<ParamInfo> = {}): ParamInfo => ({
  name,
  optional: false,
  rest: false,
  ...extra,
})

/** Route order: by path, then id. */
const byPathThenId = (a: RouteInfo, b: RouteInfo) =>
  a.path.localeCompare(b.path) || a.id.localeCompare(b.id)

describe('analyzeRoutes: directory name → path and params', () => {
  it('the routes directory itself is the root route', () => {
    expect(analyzeRoutes(routesTree(['+page.svelte']))).toMatchObject([
      { id: '/', path: '/', pattern: '/', segments: [], params: [] },
    ])
  })

  it.each<[dir: string, path: string, params: ParamInfo[]]>([
    ['about', '/about', []],
    ['blog/[slug]', '/blog/:slug', [p('slug')]],
    ['users/[id=integer]', '/users/:id', [p('id', { matcher: 'integer' })]],
    ['[[lang]]/home', '/:lang?/home', [p('lang', { optional: true })]],
    ['[[lang=locale]]/home', '/:lang?/home', [p('lang', { optional: true, matcher: 'locale' })]],
    ['docs/[...rest]', '/docs/*rest', [p('rest', { rest: true })]],
    ['docs/[...p=slug]', '/docs/*p', [p('p', { rest: true, matcher: 'slug' })]],
    ['a/[...rest]/z', '/a/*rest/z', [p('rest', { rest: true })]],
    ['foo-[id]', '/foo-:id', [p('id')]],
    ['[a]-[b]', '/:a-:b', [p('a'), p('b')]],
    ['x[a=m]y[[b]]', '/x:ay:b?', [p('a', { matcher: 'm' }), p('b', { optional: true })]],
    [
      '[org]/[repo]/tree/[branch]/[...file]',
      '/:org/:repo/tree/:branch/*file',
      [p('org'), p('repo'), p('branch'), p('file', { rest: true })],
    ],
    ['(auth)/login', '/login', []],
    ['(app)/(nested)/settings', '/settings', []],
    ['(app)', '/', []],
    ['(app)/item/[id]/embed', '/item/:id/embed', [p('id')]],
    // escapes are literal characters, not params
    ['smileys/[x+3a]-[x+29]', '/smileys/:-)', []],
    ['[x+2e]well-known', '/.well-known', []],
    ['[u+d83e][u+dd2a]', '/🤪', []],
    ['[u+1f92a]', '/🤪', []],
    // malformed brackets are kept verbatim (SvelteKit would reject them)
    ['[a-b]', '/[a-b]', []],
    ['[open', '/[open', []],
    ['[u+110000]', '/[u+110000]', []],
  ])('%j → %s', (dir, expectedPath, params) => {
    const routes = analyzeRoutes(routesTree([`${dir}/+page.svelte`]))
    expect(routes).toHaveLength(1)
    const [route] = routes
    expect(route!.id).toBe(dir)
    expect(route!.path).toBe(expectedPath)
    expect(route!.pattern).toBe(expectedPath)
    expect(route!.segments).toEqual(expectedPath.split('/').filter(Boolean))
    expect(route!.params).toEqual(params)
  })
})

describe('classifyFile', () => {
  it.each<[name: string, type: RouteFile['type'] | null]>([
    ['+page.svelte', 'page'],
    ['+layout.svelte', 'layout'],
    ['+error.svelte', 'error'],
    ['+page.ts', 'page-load'],
    ['+page.js', 'page-load'],
    ['+layout.ts', 'layout-load'],
    ['+layout.js', 'layout-load'],
    ['+page.server.ts', 'page-load-server'],
    ['+page.server.js', 'page-load-server'],
    ['+layout.server.ts', 'layout-load-server'],
    ['+layout.server.js', 'layout-load-server'],
    ['+server.ts', 'endpoint'],
    ['+server.js', 'endpoint'],
    // layout resets (advanced routing): still pages / layouts
    ['+page@.svelte', 'page'],
    ['+page@item.svelte', 'page'],
    ['+page@[id].svelte', 'page'],
    ['+page@(app).svelte', 'page'],
    ['+layout@.svelte', 'layout'],
    ['+layout@(group).svelte', 'layout'],
    // not SvelteKit route files (default moduleExtensions are .js / .ts)
    ['+server.mjs', null],
    ['+page.mjs', null],
    ['+server.svelte', null],
    ['+server.server.ts', null],
    ['+page.server.svelte', null],
    ['+error.ts', null],
    ['+error@.svelte', null],
    ['+page@.ts', null],
    ['+page.svelte.bak', null],
    ['page.svelte', null],
    ['+Page.svelte', null],
    ['Component.svelte', null],
    ['+page.d.ts', null],
    ['.+page.svelte', null],
  ])('%s → %s', (name, type) => {
    expect(classifyFile(name)).toBe(type)
  })
})

describe('analyzeRoutes: route files and flags', () => {
  const routesDir = routesTree([
    '+layout.svelte',
    '+layout.server.ts',
    '+page.svelte',
    '+error.svelte',
    'dashboard/+layout.ts',
    'dashboard/+page.ts',
    'dashboard/+page.server.js',
    'dashboard/+page@.svelte',
    'api/hello/+server.ts',
    'api/legacy/+server.mjs',
    'marx-brothers/+error.svelte',
    'marx-brothers/chico/README.md',
    'only-components/Widget.svelte',
    '(app)/+layout@.svelte',
    '(app)/item/+page@(app).svelte',
  ])
  const routes = analyzeRoutes(routesDir)
  const byId = new Map(routes.map(r => [r.id, r]))
  const flags = (id: string) => {
    const r = byId.get(id)!
    return {
      page: r.hasPage,
      layout: r.hasLayout,
      serverPage: r.hasServerPage,
      serverLayout: r.hasServerLayout,
      endpoint: r.hasEndpoint,
      pageLoad: r.hasPageLoad,
      layoutLoad: r.hasLayoutLoad,
    }
  }
  const none = {
    page: false,
    layout: false,
    serverPage: false,
    serverLayout: false,
    endpoint: false,
    pageLoad: false,
    layoutLoad: false,
  }

  it('lists exactly the directories with route files, sorted by path', () => {
    expect(routes.map(r => r.id).toSorted()).toEqual(
      ['/', '(app)', '(app)/item', 'api/hello', 'dashboard', 'marx-brothers'].toSorted(),
    )
    expect(routes).toEqual(routes.toSorted(byPathThenId))
  })

  it.each<[id: string, expected: Partial<typeof none>]>([
    ['/', { page: true, layout: true, serverLayout: true }],
    ['dashboard', { page: true, pageLoad: true, serverPage: true, layoutLoad: true }],
    ['api/hello', { endpoint: true }],
    ['marx-brothers', {}], // +error.svelte only: listed, but not a page
    ['(app)', { layout: true }],
    ['(app)/item', { page: true }],
  ])('%s flags', (id, expected) => {
    expect(flags(id)).toEqual({ ...none, ...expected })
  })

  it('records every route file with its absolute path', () => {
    const files = byId
      .get('dashboard')!
      .files.map(f => `${f.type} ${path.basename(f.path)}`)
      .toSorted((a, b) => a.localeCompare(b))
    expect(files).toEqual([
      'layout-load +layout.ts',
      'page +page@.svelte',
      'page-load +page.ts',
      'page-load-server +page.server.js',
    ])
    for (const r of routes) for (const f of r.files) expect(fs.existsSync(f.path)).toBe(true)
  })

  it('error-only directories carry an error file', () => {
    expect(byId.get('marx-brothers')!.files.map(f => f.type)).toEqual(['error'])
  })

  it('returns [] for a missing routes directory', () => {
    expect(analyzeRoutes(path.join(routesDir, 'nope'))).toEqual([])
  })
})

describe('parseRouteId properties', () => {
  const plain = fc.stringMatching(/^[a-z0-9-]{1,8}$/)
  const name = fc.stringMatching(/^[a-z_]\w{0,6}$/)
  const segment = fc.oneof(
    plain.map(s => ({ dir: s, url: s, param: null as ParamInfo | null })),
    name.map(n => ({ dir: `[${n}]`, url: `:${n}`, param: p(n) })),
    name.map(n => ({ dir: `[[${n}]]`, url: `:${n}?`, param: p(n, { optional: true }) })),
    name.map(n => ({ dir: `[...${n}]`, url: `*${n}`, param: p(n, { rest: true }) })),
    fc
      .tuple(name, name)
      .map(([n, m]) => ({ dir: `[${n}=${m}]`, url: `:${n}`, param: p(n, { matcher: m }) })),
    plain.map(s => ({ dir: `(${s})`, url: null as string | null, param: null })),
  )

  it('builds the URL from the segments in order, dropping groups', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 8 }), segs => {
        const { routePath, params } = parseRouteId(segs.map(s => s.dir).join('/'))
        const urlParts = segs.map(s => s.url).filter((u): u is string => u !== null)
        expect(routePath).toBe('/' + urlParts.join('/'))
        expect(params).toEqual(segs.map(s => s.param).filter(Boolean))
      }),
    )
  })

  it('never throws and always returns an absolute path', () => {
    fc.assert(
      fc.property(fc.string(), id => {
        const { routePath } = parseRouteId(id)
        expect(routePath.startsWith('/')).toBe(true)
      }),
    )
  })
})
