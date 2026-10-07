import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * API playground: which methods a `+server` file exports (parsed), and the
 * outbound request (SSRF guard, no redirects, timeout). Offline: fetch and
 * DNS are mocked.
 */
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

import { analyzeApiEndpoints, exportedNames, sendApiRequest } from '../src/analyzers/api.js'
import { fetchWithTimeout, OUTBOUND_TIMEOUT_MS } from '../src/analyzers/http.js'
import type { RouteInfo } from '../src/types.js'

const lookup = vi.hoisted(() =>
  vi.fn((_host: string, _opts?: unknown) =>
    Promise.resolve([{ address: '93.184.215.14', family: 4 }]),
  ),
)
vi.mock('node:dns/promises', () => ({ default: { lookup } }))

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
    ['function', 'export function GET() {}', ['GET']],
    ['async function', 'export async function POST() {}', ['POST']],
    ['const arrow', 'export const PUT = () => new Response()', ['PUT']],
    [
      'typed const',
      "import type { RequestHandler } from './$types'\nexport const PATCH: RequestHandler = async () => new Response()",
      ['PATCH'],
    ],
    ['multiple declarators', 'export const DELETE = h, OPTIONS = h', ['DELETE', 'OPTIONS']],
    ['export list', 'function GET() {}\nexport { GET }', ['GET']],
    [
      'renamed export',
      'const handler = () => {}\nexport { handler as POST, handler as HEAD }',
      ['POST', 'HEAD'],
    ],
    ['string export name', "const h = 1\nexport { h as 'PUT' }", ['PUT']],
    ['re-export', "export { GET } from './shared'", ['GET']],
    [
      'display order, not source order',
      'export const OPTIONS = h\nexport const GET = h',
      ['GET', 'OPTIONS'],
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
    expect(js!.methods).toEqual(['GET'])
    // TS-only syntax is not JavaScript
    const [bad] = analyzeApiEndpoints([endpointRoute('export const GET: number = 1', 'js')])
    expect(bad!.methods).toEqual([])
  })

  it('reports an unreadable endpoint with no methods instead of throwing', () => {
    const route = endpointRoute(null)
    expect(analyzeApiEndpoints([route])).toEqual([
      { route: route.id, path: route.path, methods: [], file: route.files[0]!.path },
    ])
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

const req = (over: Partial<Parameters<typeof sendApiRequest>[0]> = {}) => ({
  url: 'https://example.com/api',
  method: 'GET',
  headers: '',
  body: '',
  ...over,
})

describe('sendApiRequest', () => {
  beforeEach(() => lookup.mockClear())

  it('returns status, headers and body; never follows redirects', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(
        new Response('moved', { status: 302, statusText: 'Found', headers: { location: '/x' } }),
      ),
    )
    const res = await sendApiRequest(req())
    expect(res).toMatchObject({
      status: 302,
      statusText: 'Found',
      body: 'moved',
      headers: { location: '/x' },
    })
    expect(res.duration).toBeGreaterThanOrEqual(0)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'manual' })
  })

  it.each([
    ['GET', 'x', undefined],
    ['HEAD', 'x', undefined],
    ['POST', 'x', 'x'],
    ['PUT', '', undefined],
    ['DELETE', '{"a":1}', '{"a":1}'],
  ])('%s with body %j sends body %j', async (method, body, sent) => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('')))
    await sendApiRequest(req({ method, body }))
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(sent)
  })

  it.each([
    ['', {}],
    ['  ', {}],
    ['{}', {}],
    ['{"x-a":"1","Accept":"text/plain"}', { 'x-a': '1', Accept: 'text/plain' }],
  ])('headers %j are sent as %j', async (headers, sent) => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('')))
    const res = await sendApiRequest(req({ headers }))
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(sent)
  })

  it.each([
    ['{bad', /SyntaxError/],
    ['5', /JSON object of string values/],
    ['null', /JSON object of string values/],
    ['[]', /JSON object of string values/],
    ['"x"', /JSON object of string values/],
    ['{"a":1}', /JSON object of string values/],
    ['{"a":{"b":"c"}}', /JSON object of string values/],
  ])('invalid headers %j fail without sending', async (headers, message) => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('')))
    const res = await sendApiRequest(req({ headers }))
    expect(res).toMatchObject({ status: 0, headers: {}, body: '' })
    expect(res.statusText).toMatch(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['http://169.254.169.254/latest/meta-data', /Blocked: private IP/],
    ['http://localhost:6379/', /Blocked: internal hostname/],
    ['file:///etc/passwd', /Blocked URL scheme/],
    ['not a url', /Invalid URL/],
  ])('blocks %s before fetching', async (url, message) => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('')))
    const res = await sendApiRequest(req({ url }))
    expect(res.status).toBe(0)
    expect(res.statusText).toMatch(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks a public name resolving to a private address (DNS-based SSRF)', async () => {
    lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    const fetchMock = mockFetch(() => Promise.resolve(new Response('')))
    const res = await sendApiRequest(req({ url: 'https://rebind.example/' }))
    expect(res.statusText).toMatch(/resolves to private address/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the dev server origin', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('ok')))
    const res = await sendApiRequest(req({ url: 'http://localhost:5173/api/x' }), {
      allowedOrigins: ['http://localhost:5173'],
    })
    expect(res).toMatchObject({ status: 200, body: 'ok' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('reports network errors as status 0', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    const res = await sendApiRequest(req())
    expect(res).toMatchObject({ status: 0, statusText: 'TypeError: fetch failed' })
  })

  it('gives up after the timeout when the server never answers', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    mockFetch((_url, init) => {
      signal = init.signal
      return new Promise(() => {}) // never settles, ignores the abort
    })
    const pending = sendApiRequest(req(), {}, 1000)
    await vi.advanceTimersByTimeAsync(999)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const res = await pending
    expect(res).toMatchObject({ status: 0, statusText: 'Error: Timed out after 1000ms' })
    expect(signal?.aborted).toBe(true)
  })

  it('the timeout also covers a body that never finishes', async () => {
    vi.useFakeTimers()
    mockFetch(() => Promise.resolve(new Response(new ReadableStream({ start() {} }))))
    const pending = sendApiRequest(req(), {}, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect((await pending).statusText).toMatch(/Timed out/)
  })
})

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
