import fs from 'node:fs'

import { parseSync } from 'vite'

import type { ApiEndpoint, RouteInfo } from '../types.js'

/** The request handlers a SvelteKit `+server` file may export, in display order. */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/**
 * Names a `+server` module exports. Parsed, not substring-matched: the old
 * `content.includes('export const GET')` also matched `export const GETTER`
 * and commented-out code, and missed `export { handler as GET }`. Null when
 * the module cannot be read or parsed.
 */
export function exportedNames(code: string, filename: string): Set<string> | null {
  // The language (js / ts) follows the file extension.
  const { program, errors } = parseSync(filename, code)
  if (errors.length > 0) return null
  const names = new Set<string>()
  for (const node of program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue
    const decl = node.declaration
    if (decl?.type === 'FunctionDeclaration' && decl.id) names.add(decl.id.name)
    else if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier') names.add(d.id.name)
    }
    for (const spec of node.specifiers) {
      const exported = spec.exported
      names.add(exported.type === 'Literal' ? exported.value : exported.name)
    }
  }
  return names
}

/**
 * List `+server` endpoints and the HTTP methods they export. A `fallback`
 * handler answers every method, and SvelteKit answers `HEAD` from `GET`.
 * `methods` is empty when nothing is known (unreadable or unparsable file,
 * no handler exports). `url` is the route path under the dev server's
 * `base` (SvelteKit's `paths.base`), the path the app actually serves.
 */
export function analyzeApiEndpoints(routes: RouteInfo[], base = '/'): ApiEndpoint[] {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  const endpoints: ApiEndpoint[] = []
  for (const route of routes) {
    const serverFile = route.files.find(f => f.type === 'endpoint')
    if (!serverFile) continue
    let names: Set<string> | null = null
    try {
      const code = fs.readFileSync(serverFile.path, 'utf-8')
      names = exportedNames(code, serverFile.path)
    } catch {
      /* file vanished or is unreadable */
    }
    const has = (name: string) => names?.has(name) === true
    const methods: string[] = has('fallback')
      ? [...HTTP_METHODS]
      : HTTP_METHODS.filter(m => has(m) || (m === 'HEAD' && has('GET')))
    endpoints.push({
      route: route.id,
      path: route.path,
      url: prefix + route.path,
      methods,
      file: serverFile.path,
    })
  }
  return endpoints
}
