import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS, sendRequest } from './http.js'
import type { ApiRequest } from './http.js'

const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({
  url: 'http://localhost:5173/api',
  method: 'GET',
  headers: {},
  body: '',
  ...over,
})

const fetchMock = vi.fn<typeof fetch>()

/** A body that sends `chunks`, then stays open until the request is aborted (SSE-like). */
function endless(chunks: string[], signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk))
      signal.addEventListener('abort', () => c.error(signal.reason))
    },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', new URL('http://localhost:5173/.svelte-devtools/'))
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('sendRequest', () => {
  it('sends method, headers and body and reports the whole response', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"a":1}', { status: 201, statusText: 'Created', headers: { 'x-a': '1' } }),
    )
    const res = await sendRequest(req({ method: 'POST', headers: { 'x-b': '2' }, body: 'hi' }))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:5173/api')
    expect(init).toMatchObject({ method: 'POST', headers: { 'x-b': '2' }, body: 'hi' })
    // The browser's defaults stand: same-origin cookies, redirects followed.
    expect(init).not.toHaveProperty('credentials')
    expect(init).not.toHaveProperty('redirect')
    expect(res).toMatchObject({
      status: 201,
      statusText: 'Created',
      body: '{"a":1}',
      url: 'http://localhost:5173/api',
      redirected: false,
      truncated: null,
    })
    expect(res.headers['x-a']).toBe('1')
    expect(res.duration).toBeGreaterThanOrEqual(0)
  })

  it.each(['GET', 'HEAD'])('drops the body of %s', async method => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const res = await sendRequest(req({ method, body: 'ignored' }))
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('body')
    expect(res).toMatchObject({ status: 204, body: '', truncated: null })
  })

  it('reports the URL that answered after a redirect', async () => {
    const answered = new Response('login')
    Object.defineProperties(answered, {
      url: { value: 'http://localhost:5173/login' },
      redirected: { value: true },
    })
    fetchMock.mockResolvedValue(answered)
    expect(await sendRequest(req())).toMatchObject({
      url: 'http://localhost:5173/login',
      redirected: true,
    })
  })

  it('turns a failed fetch into status 0 with the reason', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockRejectedValueOnce('plain')
    expect(await sendRequest(req())).toMatchObject({
      status: 0,
      statusText: 'Failed to fetch',
      headers: {},
      body: '',
      truncated: null,
    })
    expect((await sendRequest(req())).statusText).toBe('plain')
  })

  it('points at CORS when a cross-origin request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await sendRequest(req({ url: 'https://api.example.com/x' }))).statusText).toBe(
      'Failed to fetch (a cross-origin URL answers only if its CORS policy allows this origin)',
    )
    // Relative URLs resolve against the page; unparsable ones get no hint.
    expect((await sendRequest(req({ url: '/api' }))).statusText).toBe('Failed to fetch')
    expect((await sendRequest(req({ url: 'http://[' }))).statusText).toBe('Failed to fetch')
  })

  it('gives up at the timeout and clears its timer', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = init!.signal!
          signal.addEventListener('abort', () => reject(signal.reason as Error))
        }),
    )
    const pending = sendRequest(req(), { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    expect((await pending).statusText).toBe('Timed out after 50ms')

    fetchMock.mockResolvedValue(new Response('ok'))
    await sendRequest(req())
    expect(vi.getTimerCount()).toBe(0)
    expect(REQUEST_TIMEOUT_MS).toBe(30_000)
  })

  it('keeps what a stream sent before the timeout', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(new Response(endless(['data: 1\n\n', 'data: 2\n\n'], init!.signal!))),
    )
    const pending = sendRequest(req(), { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    expect(await pending).toMatchObject({
      status: 200,
      body: 'data: 1\n\ndata: 2\n\n',
      truncated: 'timeout',
    })
  })

  it('keeps what arrived when the body fails midway', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('part'))
      },
      // asked for more once 'part' is read
      pull(c) {
        c.error(new Error('reset'))
      },
    })
    fetchMock.mockResolvedValue(new Response(body))
    expect(await sendRequest(req())).toMatchObject({ body: 'part', truncated: 'error' })
  })

  it('cuts the body at maxBytes and cancels the rest', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(new Response(endless(['ab', 'cdef'], controller.signal)))
    expect(await sendRequest(req(), { maxBytes: 4 })).toMatchObject({
      body: 'abcd',
      truncated: 'size',
    })
    // A source that throws on cancel does not fail the request.
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('abcdef'))
          },
          cancel() {
            throw new Error('cannot cancel')
          },
        }),
      ),
    )
    expect(await sendRequest(req(), { maxBytes: 4 })).toMatchObject({ truncated: 'size' })
    // A body of exactly maxBytes is whole.
    fetchMock.mockResolvedValue(new Response('abcd'))
    expect(await sendRequest(req(), { maxBytes: 4 })).toMatchObject({
      body: 'abcd',
      truncated: null,
    })
    expect(MAX_BODY_BYTES).toBe(5 * 1024 * 1024)
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('日本')
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.subarray(0, 2))
        c.enqueue(bytes.subarray(2))
        c.close()
      },
    })
    fetchMock.mockResolvedValue(new Response(body))
    expect((await sendRequest(req())).body).toBe('日本')
  })
})
