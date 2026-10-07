import fs from 'node:fs'

import { parseSync } from 'vite'

import { assertOutboundUrl } from '../server/security.js'
import type { OutboundUrlOptions } from '../server/security.js'
import type { ApiEndpoint, ApiResponse, RouteInfo } from '../types.js'
import { fetchWithTimeout } from './http.js'

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
 * handler answers every method. `methods` is empty when nothing is known
 * (unreadable or unparsable file, no handler exports).
 */
export function analyzeApiEndpoints(routes: RouteInfo[]): ApiEndpoint[] {
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
    const methods: string[] = names?.has('fallback')
      ? [...HTTP_METHODS]
      : HTTP_METHODS.filter(m => names?.has(m))
    endpoints.push({ route: route.id, path: route.path, methods, file: serverFile.path })
  }
  return endpoints
}

export interface ApiRequestInput {
  url: string
  method: string
  /** JSON-encoded header object (as typed by the user). */
  headers: string
  body: string
}

/** The header object typed by the user: empty, or a JSON object of string values. */
function parseHeaders(raw: string): Record<string, string> {
  if (!raw.trim()) return {}
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every(v => typeof v === 'string')
  ) {
    throw new TypeError('Headers must be a JSON object of string values')
  }
  return parsed as Record<string, string>
}

/**
 * Send a request to a public URL or the dev server itself (SSRF-guarded) and
 * report the response. Redirects are returned, never followed; the request
 * gives up after {@link fetchWithTimeout}'s timeout. Every failure is a
 * `status: 0` response whose `statusText` says why.
 */
export async function sendApiRequest(
  input: ApiRequestInput,
  options: OutboundUrlOptions = {},
  timeoutMs?: number,
): Promise<ApiResponse> {
  const start = performance.now()
  const duration = () => Math.round((performance.now() - start) * 100) / 100
  try {
    await assertOutboundUrl(input.url, options)
    const init: RequestInit = { method: input.method, headers: parseHeaders(input.headers) }
    if (input.body && input.method !== 'GET' && input.method !== 'HEAD') init.body = input.body
    return await fetchWithTimeout(
      input.url,
      init,
      async res => {
        const body = await res.text()
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          headers[k] = v
        })
        return {
          status: res.status,
          statusText: res.statusText,
          headers,
          body,
          duration: duration(),
        }
      },
      timeoutMs,
    )
  } catch (e) {
    return { status: 0, statusText: String(e), headers: {}, body: '', duration: duration() }
  }
}
