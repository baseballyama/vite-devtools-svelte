import fs from 'node:fs'

import { assertOutboundUrl } from '../server/security.js'
import type { OutboundUrlOptions } from '../server/security.js'
import type { ApiEndpoint, ApiResponse, RouteInfo } from '../types.js'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** List `+server` endpoints and the HTTP methods they export. */
export function analyzeApiEndpoints(routes: RouteInfo[]): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = []
  for (const route of routes) {
    const serverFile = route.files.find(f => f.type === 'endpoint')
    if (!serverFile) continue
    let content = ''
    try {
      content = fs.readFileSync(serverFile.path, 'utf-8')
    } catch {
      /* file may not exist */
    }
    const methods = HTTP_METHODS.filter(
      m =>
        content.includes(`export const ${m}`) ||
        content.includes(`export async function ${m}`) ||
        content.includes(`export function ${m}`),
    )
    if (methods.length === 0) methods.push('GET')
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

/**
 * Send a request to a public URL or the dev server itself (SSRF-guarded) and
 * report the response. Redirects are returned, never followed.
 */
export async function sendApiRequest(
  input: ApiRequestInput,
  options: OutboundUrlOptions = {},
): Promise<ApiResponse> {
  const start = performance.now()
  const duration = () => Math.round((performance.now() - start) * 100) / 100
  try {
    await assertOutboundUrl(input.url, options)
    // Shape is validated by fetch() itself (a TypeError lands in the catch).
    const parsedHeaders = (input.headers ? JSON.parse(input.headers) : {}) as RequestInit['headers']
    const init: RequestInit = { method: input.method, headers: parsedHeaders, redirect: 'manual' }
    if (input.body && input.method !== 'GET' && input.method !== 'HEAD') init.body = input.body
    const res = await fetch(input.url, init)
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    return { status: res.status, statusText: res.statusText, headers, body, duration: duration() }
  } catch (e) {
    return { status: 0, statusText: String(e), headers: {}, body: '', duration: duration() }
  }
}
