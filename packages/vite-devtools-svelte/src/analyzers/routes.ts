import fs from 'node:fs'
import path from 'node:path'

import type { RouteInfo, ParamInfo, RouteFile } from '../types.js'

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
const ROUTE_FILE = /^\+(page|layout|error|server)(@[^/\\]*)?(?:\.(server))?\.(svelte|js|ts)$/

export function classifyFile(name: string): RouteFile['type'] | null {
  const m = ROUTE_FILE.exec(name)
  if (!m) return null
  const [, kind, reset, server, ext] = m
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

/** Inside brackets: `name`, `...name`, each with an optional `=matcher`. */
const PARAM = /^(\.\.\.)?(\w+)(?:=(\w+))?$/

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
    if (!segment || /^\(.+\)$/.test(segment)) continue
    out.push(parseSegment(segment, params))
  }
  return { routePath: '/' + out.join('/'), params }
}

function parseSegment(segment: string, params: ParamInfo[]): string {
  let result = ''
  let i = 0
  while (i < segment.length) {
    if (segment[i] !== '[') {
      result += segment[i]
      i++
      continue
    }
    const optional = segment.startsWith('[[', i)
    const close = segment.indexOf(optional ? ']]' : ']', i)
    if (close === -1) {
      result += segment.slice(i)
      break
    }
    const inner = segment.slice(i + (optional ? 2 : 1), close)
    const end = close + (optional ? 2 : 1)
    const escaped = optional ? null : decodeEscape(inner)
    const param = PARAM.exec(inner)
    if (escaped !== null) {
      result += escaped
    } else if (param) {
      const [, rest, name, matcher] = param
      const info: ParamInfo = { name: name!, optional, rest: !!rest }
      if (matcher) info.matcher = matcher
      params.push(info)
      result += rest ? `*${name}` : `:${name}${optional ? '?' : ''}`
    } else {
      result += segment.slice(i, end)
    }
    i = end
  }
  return result
}

/** The character of an `x+nn` / `u+nnnn` escape, or null when `inner` is not one. */
function decodeEscape(inner: string): string | null {
  const hex = /^x\+([0-9a-f]{2})$/i.exec(inner)
  if (hex) return String.fromCodePoint(Number.parseInt(hex[1]!, 16))
  const uni = /^u\+([0-9a-f]{4,6})$/i.exec(inner)
  if (!uni) return null
  const code = Number.parseInt(uni[1]!, 16)
  return code <= 0x10ffff ? String.fromCodePoint(code) : null
}
