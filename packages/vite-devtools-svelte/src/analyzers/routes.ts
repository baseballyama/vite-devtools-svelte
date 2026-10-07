import fs from 'node:fs'
import path from 'node:path'

import type { RouteInfo, ParamInfo, RouteFile } from '../types.js'
import { HEX_DIGITS, WORD_CHARS, consistsOf } from './text.js'

export function analyzeRoutes(routesDir: string): RouteInfo[] {
  if (!fs.existsSync(routesDir)) return []

  const routes: RouteInfo[] = []
  scanDirectory(routesDir, routesDir, routes)
  // id breaks ties (`/` and `(group)` share a path) so the order never depends on readdir
  return routes.toSorted((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
}

function scanDirectory(dir: string, rootDir: string, routes: RouteInfo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  const files: RouteFile[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanDirectory(path.join(dir, entry.name), rootDir, routes)
      continue
    }

    const type = classifyFile(entry.name)
    if (type) files.push({ type, path: path.join(dir, entry.name) })
  }

  if (files.length > 0) {
    // Route ids use `/` on every platform (the client splits them on `/`).
    const relativePath = path.relative(rootDir, dir).split(path.sep).join('/')
    const { routePath, params } = parseRouteId(relativePath)

    routes.push({
      id: relativePath || '/',
      path: routePath,
      pattern: routePath,
      segments: routePath.split('/').filter(Boolean),
      hasPage: files.some(f => f.type === 'page'),
      hasLayout: files.some(f => f.type === 'layout'),
      hasServerPage: files.some(f => f.type === 'page-load-server'),
      hasServerLayout: files.some(f => f.type === 'layout-load-server'),
      hasEndpoint: files.some(f => f.type === 'endpoint'),
      hasPageLoad: files.some(f => f.type === 'page-load'),
      hasLayoutLoad: files.some(f => f.type === 'layout-load'),
      params,
      files,
    })
  }
}

/**
 * SvelteKit's route files. Modules use the default `kit.moduleExtensions`
 * (`.js`, `.ts`). Components may carry a layout reset (`+page@.svelte`,
 * `+page@(group).svelte`, `+layout@item.svelte`, …): those were not
 * recognised before, so a route whose page resets its layout vanished.
 */
export function classifyFile(name: string): RouteFile['type'] | null {
  const dot = name.lastIndexOf('.')
  const ext = name.slice(dot + 1)
  if (!name.startsWith('+') || (ext !== 'svelte' && ext !== 'js' && ext !== 'ts')) return null
  let stem = name.slice(1, dot) // `page@(group)`, `layout.server`, …
  const server = stem.endsWith('.server')
  if (server) stem = stem.slice(0, -'.server'.length)
  const at = stem.indexOf('@')
  const reset = at !== -1
  const kind = reset ? stem.slice(0, at) : stem
  if (ext === 'svelte') {
    if (server) return null
    if (kind === 'page') return 'page'
    if (kind === 'layout') return 'layout'
    // `+error@x.svelte` / `+server.svelte` are not SvelteKit files
    return kind === 'error' && !reset ? 'error' : null
  }
  if (reset) return null // layout resets apply to components only
  if (kind === 'server') return server ? null : 'endpoint'
  if (kind === 'page') return server ? 'page-load-server' : 'page-load'
  if (kind === 'layout') return server ? 'layout-load-server' : 'layout-load'
  return null // `+error.js`
}

/**
 * URL pattern and params of a route id (`/`-separated, relative to
 * src/routes), following SvelteKit's routing rules:
 * - `(group)` segments are not part of the URL;
 * - `[p]` → `:p`, `[[p]]` → `:p?`, `[...p]` → `*p`; a `=matcher` goes to
 *   `params[].matcher`, not into the pattern;
 * - params may sit inside a segment (`foo-[id]`, `[a]-[b]`);
 * - `[x+nn]` / `[u+nnnn]` are escaped literal characters.
 * Brackets that are none of these are kept verbatim.
 */
export function parseRouteId(id: string): { routePath: string; params: ParamInfo[] } {
  const params: ParamInfo[] = []
  const out: string[] = []
  for (const segment of id.split('/')) {
    const group = segment.length > 2 && segment.startsWith('(') && segment.endsWith(')')
    if (!segment || group) continue
    out.push(parseSegment(segment, params))
  }
  return { routePath: '/' + out.join('/'), params }
}

function parseSegment(segment: string, params: ParamInfo[]): string {
  let result = ''
  let i = 0
  for (let open = segment.indexOf('['); open !== -1; open = segment.indexOf('[', i)) {
    result += segment.slice(i, open)
    const optional = segment.startsWith('[[', open)
    const close = segment.indexOf(optional ? ']]' : ']', open)
    if (close === -1) {
      i = open
      break
    }
    const inner = segment.slice(open + (optional ? 2 : 1), close)
    i = close + (optional ? 2 : 1)
    result +=
      (optional ? null : decodeEscape(inner)) ??
      parseParam(inner, optional, params) ??
      segment.slice(open, i)
  }
  return result + segment.slice(i)
}

/**
 * Inside brackets: `name` or `...name`, each with an optional `=matcher`.
 * Records the param and returns its pattern; null when `inner` is not one.
 */
function parseParam(inner: string, optional: boolean, params: ParamInfo[]): string | null {
  const rest = inner.startsWith('...')
  const [name = '', matcher, extra] = inner.slice(rest ? 3 : 0).split('=')
  const valid =
    consistsOf(name, WORD_CHARS) &&
    (matcher === undefined || consistsOf(matcher, WORD_CHARS)) &&
    extra === undefined
  if (!valid) return null
  params.push(matcher === undefined ? { name, optional, rest } : { name, optional, rest, matcher })
  return rest ? `*${name}` : `:${name}${optional ? '?' : ''}`
}

/** The character of an `x+nn` / `u+nnnn` escape, or null when `inner` is not one. */
function decodeEscape(inner: string): string | null {
  const prefix = inner.slice(0, 2).toLowerCase()
  const hex = inner.slice(2)
  const sized =
    prefix === 'x+' ? hex.length === 2 : prefix === 'u+' && hex.length >= 4 && hex.length <= 6
  if (!sized || !consistsOf(hex, HEX_DIGITS)) return null
  const code = Number.parseInt(hex, 16)
  return code <= 0x10ffff ? String.fromCodePoint(code) : null
}
