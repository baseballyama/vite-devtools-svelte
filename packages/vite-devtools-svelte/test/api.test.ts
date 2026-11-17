import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * API playground: which methods a `+server` file exports (parsed), and the
 * outbound fetch helper the OG preview shares (no redirects, timeout).
 * Offline: fetch is mocked.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

import { analyzeApiEndpoints, exportedNames } from '../src/analyzers/api.js'
import { fetchWithTimeout, OUTBOUND_TIMEOUT_MS } from '../src/analyzers/http.js'
import type { RouteInfo } from '../src/types.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-api-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

let n = 0
function endpointRoute(code: string | null, ext = 'ts'): RouteInfo {
  const dir = path.join(tmp, `r${n++}`)
  fs.mkdirSync(dir)
  const file = path.join(dir, `+server.${ext}`)
  if (code !== null) fs.writeFileSync(file, code)
  return {
    id: `r${n}`,
    path: `/r${n}`,
    pattern: `/r${n}`,
    segments: [],
    hasPage: false,
    hasLayout: false,
    hasServerPage: false,
    hasServerLayout: false,
    hasEndpoint: true,
    hasPageLoad: false,
    hasLayoutLoad: false,
    params: [],
    files: [{ type: 'endpoint', path: file }],
  }
}

const ALL = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

describe('analyzeApiEndpoints: exported methods', () => {
  it.each<[label: string, code: string, methods: string[]]>([
    // SvelteKit answers HEAD with the GET handler
    ['function', 'export function GET() {}', ['GET', 'HEAD']],
    ['async function', 'export async function POST() {}', ['POST']],
    ['const arrow', 'export const PUT = () => new Response()', ['PUT']],
    [
      'typed const',
      "import type { RequestHandler } from './$types'\nexport const PATCH: RequestHandler = async () => new Response()",
      ['PATCH'],
    ],
    ['multiple declarators', 'export const DELETE = h, OPTIONS = h', ['DELETE', 'OPTIONS']],
    ['export list', 'function GET() {}\nexport { GET }', ['GET', 'HEAD']],
    [
      'renamed export',
      'const handler = () => {}\nexport { handler as POST, handler as HEAD }',
      ['POST', 'HEAD'],
    ],
    ['string export name', "const h = 1\nexport { h as 'PUT' }", ['PUT']],
    ['re-export', "export { GET } from './shared'", ['GET', 'HEAD']],
    [
      'display order, not source order',
      'export const OPTIONS = h\nexport const GET = h',
      ['GET', 'HEAD', 'OPTIONS'],
    ],
    ['fallback answers every method', 'export const fallback = h', ALL],
    ['fallback with GET', 'export const GET = h\nexport async function fallback() {}', ALL],
    // false positives of the old substring match
    ['prefix name', 'export const GETTER = 1\nexport function POSTED() {}', []],
    ['commented out', '// export function GET() {}\n/* export const POST = 1 */', []],
    ['inside a string', "const s = 'export function GET() {}'", []],
    ['lowercase', 'export function get() {}', []],
    ['not exported', 'function GET() {}', []],
    ['default export', 'export default function GET() {}', []],
    ['destructuring', 'export const { GET } = handlers', []],
    ['export star is unknown', "export * from './handlers'", []],
    ['empty file', '', []],
    ['syntax error', 'export function GET( {', []],
  ])('%s', (_label, code, methods) => {
    const [endpoint] = analyzeApiEndpoints([endpointRoute(code)])
    expect(endpoint!.methods).toEqual(methods)
  })

  it('parses .js endpoints as JavaScript', () => {
    const [js] = analyzeApiEndpoints([endpointRoute('export async function GET() {}', 'js')])
    expect(js!.methods).toEqual(['GET', 'HEAD'])
    // TS-only syntax is not JavaScript
    const [bad] = analyzeApiEndpoints([endpointRoute('export const GET: number = 1', 'js')])
    expect(bad!.methods).toEqual([])
  })

  it('reports an unreadable endpoint with no methods instead of throwing', () => {
    const route = endpointRoute(null)
    expect(analyzeApiEndpoints([route])).toEqual([
      {
        route: route.id,
        path: route.path,
        url: route.path,
        methods: [],
        file: route.files[0]!.path,
      },
    ])
  })

  it('puts the URL under the dev server base', () => {
    const route = { ...endpointRoute('export const GET = h'), path: '/api/items/:id' }
    for (const base of ['/app/', '/app']) {
      const [endpoint] = analyzeApiEndpoints([route], base)
      expect(endpoint).toMatchObject({ path: '/api/items/:id', url: '/app/api/items/:id' })
    }
    expect(analyzeApiEndpoints([route])[0]!.url).toBe('/api/items/:id')
  })

  it('skips routes without an endpoint file', () => {
    const route = endpointRoute('export const GET = 1')
    expect(analyzeApiEndpoints([{ ...route, files: [{ type: 'page', path: 'x' }] }])).toEqual([])
  })

  it('exportedNames returns null for unparsable code', () => {
    expect(exportedNames('export {', 'x.ts')).toBeNull()
    expect(exportedNames('export const a = 1, b = 2', 'x.ts')).toEqual(new Set(['a', 'b']))
  })
})

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  // every call in this file passes the URL as a string
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => impl(url as string, init!))
}

describe('fetchWithTimeout', () => {
  it('defaults to OUTBOUND_TIMEOUT_MS and clears its timer on success', async () => {
    vi.useFakeTimers()
    mockFetch(() => Promise.resolve(new Response('ok')))
    expect(await fetchWithTimeout('https://e.com', {}, r => r.text())).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
    expect(OUTBOUND_TIMEOUT_MS).toBe(30_000)
  })

  it('forces redirect: manual even when the caller asks to follow', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('')))
    await fetchWithTimeout('https://e.com', { redirect: 'follow' }, r => r.text())
    expect(fetchMock.mock.calls[0]![1]!.redirect).toBe('manual')
  })

  it('propagates a failure of the reader', async () => {
    mockFetch(() => Promise.resolve(new Response('')))
    await expect(
      fetchWithTimeout('https://e.com', {}, () => Promise.reject(new Error('read'))),
    ).rejects.toThrow('read')
  })
})
