import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as http from '../lib/http.js'
import type { ApiResponse } from '../lib/http.js'
import * as rpc from '../lib/rpc.js'
import type { ApiEndpoint } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import ApiPlayground from './ApiPlayground.svelte'

vi.mock('../lib/http.js', async importOriginal => ({
  ...(await importOriginal<typeof http>()),
  sendRequest: vi.fn(),
}))

const endpoints: ApiEndpoint[] = [
  {
    route: '/api/users',
    path: '/api/users',
    url: '/app/api/users',
    methods: ['GET', 'POST'],
    file: 'src/routes/api/users/+server.ts',
  },
  {
    route: '/api/items/[id]',
    path: '/api/items/:id',
    url: '/app/api/items/:id',
    methods: ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    file: 'src/routes/api/items/[id]/+server.ts',
  },
  {
    route: '/api/ping',
    path: '/api/ping',
    url: '/app/api/ping',
    methods: ['HEAD'],
    file: 'src/routes/api/ping/+server.ts',
  },
]

function ok(over: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
    size: 7,
    duration: 12,
    url: 'http://x/',
    redirected: false,
    truncated: null,
    ...over,
  }
}

async function setup() {
  const user = userEvent.setup()
  const { container } = render(ApiPlayground)
  await settle()
  return { user, container, list: screen.getByRole('listbox', { name: 'API endpoints' }) }
}

/**
 * Pick a `<select>` option. Svelte's `bind:value` reads `select.querySelector(':checked')`,
 * which happy-dom does not match for `<option>`s, so answer it from `selectedOptions`.
 */
async function choose(select: HTMLSelectElement, value: string) {
  Object.defineProperty(select, 'querySelector', {
    configurable: true,
    value(this: HTMLSelectElement, selector: string) {
      return selector === ':checked'
        ? (this.selectedOptions[0] ?? null)
        : ([...this.options].find(o => o.matches(selector)) ?? null)
    },
  })
  select.value = value
  await fireEvent.change(select)
}

const urlInput = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Request URL' })
const sendButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Send/ })
const response = () => screen.getByRole('region', { name: 'Response' })

// spies such as the requestAnimationFrame one stay inside the test that made them
afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }))
  vi.mocked(rpc.getApiEndpoints).mockResolvedValue(endpoints)
  vi.mocked(http.sendRequest).mockReset().mockResolvedValue(ok())
})

describe('ApiPlayground', () => {
  it('lists endpoints with their methods and a count', async () => {
    const { list } = await setup()
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]!.textContent).toContain('/api/users')
    expect(options[0]!.textContent).toContain('POST')
    // More than three methods collapse into a "+n" badge.
    expect(options[1]!.textContent).toContain('+2')
    expect(screen.getByRole('heading', { name: /API/ }).textContent).toContain('3')
    // Nothing picked yet.
    expect(within(response()).getByText('Send a request')).toBeTruthy()
    expect(sendButton().disabled).toBe(true)
  })

  it('filters endpoints and shows a no-match state', async () => {
    const { user, list } = await setup()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'items')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(within(list).getByText('items').tagName).toBe('MARK')
    await user.clear(search)
    await user.type(search, 'zzz')
    expect(within(list).queryAllByRole('option')).toHaveLength(0)
    expect(within(list).getByText('No endpoints match')).toBeTruthy()
  })

  it('shows the empty state when there are no endpoints', async () => {
    vi.mocked(rpc.getApiEndpoints).mockResolvedValue([])
    const { list } = await setup()
    expect(within(list).getByText('No +server endpoints')).toBeTruthy()
  })

  it('shows a failed scan as an error, not as "No +server endpoints"', async () => {
    vi.mocked(rpc.getApiEndpoints).mockRejectedValue(new Error('RPC down'))
    render(ApiPlayground)
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('RPC down')
    expect(screen.queryByText('No +server endpoints')).toBeNull()
  })

  it('shows a scanning state until endpoints load', async () => {
    vi.mocked(rpc.getApiEndpoints).mockReturnValue(new Promise(() => {}))
    const { list } = await setup()
    expect(within(list).getByText('Scanning +server files…')).toBeTruthy()
  })

  it('picking an endpoint fills method and URL; Send calls sendRequest and shows the response', async () => {
    vi.mocked(http.sendRequest).mockResolvedValue(
      ok({ headers: { 'Content-Type': 'application/json', 'x-id': '7' } }),
    )
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    // The endpoint's URL under the dev server base, on the app's origin.
    expect(urlInput().value).toBe(`${location.origin}/app/api/users`)
    const method = screen.getByRole<HTMLSelectElement>('combobox', { name: 'HTTP method' })
    expect(method.value).toBe('GET')
    // Only the endpoint's methods are offered.
    expect(
      within(method)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual(['GET', 'POST'])
    // GET has no body.
    expect(screen.getByText('GET requests have no body.')).toBeTruthy()

    await choose(method, 'POST')
    await user.type(screen.getByRole('textbox', { name: 'Request body' }), '{{"n":1}')
    await user.click(screen.getByRole('tab', { name: /Headers/ }))
    const headers = screen.getByRole('textbox', { name: 'Request headers as JSON' })
    await user.clear(headers)
    await user.type(headers, '{{"x-a":"b"}')
    await user.click(sendButton())
    await settle()

    expect(http.sendRequest).toHaveBeenCalledWith(
      {
        url: `${location.origin}/app/api/users`,
        method: 'POST',
        headers: { 'x-a': 'b' },
        body: '{"n":1}',
      },
      { signal: expect.any(AbortSignal), onProgress: expect.any(Function) },
    )
    const res = response()
    expect(within(res).getByText('200 OK')).toBeTruthy()
    expect(within(res).getByText('2 headers')).toBeTruthy()
    expect(within(res).getByText('x-id')).toBeTruthy()
    // JSON is pretty-printed.
    expect(res.querySelector('pre')!.textContent).toBe('{\n  "a": 1\n}')
  })

  it('opens the handler file in the editor', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    await user.click(screen.getByRole('button', { name: 'src/routes/api/users/+server.ts' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/routes/api/users/+server.ts')
  })

  it('sends a typed URL with ⌘↵, drops the body for GET and empty headers become {}', async () => {
    vi.mocked(http.sendRequest).mockResolvedValue(
      ok({ status: 404, statusText: 'Not Found', headers: {}, body: '' }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/y')
    await user.click(screen.getByRole('tab', { name: /Headers/ }))
    await user.clear(screen.getByRole('textbox', { name: 'Request headers as JSON' }))
    await fireEvent.keyDown(urlInput(), { key: 'Enter', metaKey: true })
    await settle()
    expect(vi.mocked(http.sendRequest).mock.calls[0]![0]).toEqual({
      url: 'http://x/y',
      method: 'GET',
      headers: {},
      body: '',
    })
    expect(within(response()).getByText('404 Not Found')).toBeTruthy()
    expect(within(response()).getByText('(empty body)')).toBeTruthy()
  })

  it('keeps non-JSON bodies verbatim and renders markup in them as text', async () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    vi.mocked(http.sendRequest).mockResolvedValue(
      ok({
        status: 301,
        statusText: 'Moved',
        headers: { 'content-type': 'text/html' },
        body: payload,
      }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    const res = response()
    expect(within(res).getByText('301 Moved')).toBeTruthy()
    expect(res.querySelector('pre')!.textContent).toBe(payload)
    expect(res.querySelector('img, script')).toBeNull()
  })

  it('falls back to the raw body when JSON-looking content does not parse', async () => {
    vi.mocked(http.sendRequest).mockResolvedValue(
      ok({ status: 100, statusText: 'Continue', headers: {}, body: '{oops' }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe('{oops')
  })

  it('shows a failed request and recovers on the next send', async () => {
    vi.mocked(http.sendRequest).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.mocked(http.sendRequest).mockRejectedValueOnce('plain failure')
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByRole('alert').textContent).toContain('ECONNREFUSED')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByRole('alert').textContent).toContain('plain failure')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByText('200 OK')).toBeTruthy()
  })

  it('streams the body as it arrives, follows it, and Stop aborts the request', async () => {
    let resolve!: (r: ApiResponse) => void
    vi.mocked(http.sendRequest).mockReturnValue(
      new Promise(r => {
        resolve = r
      }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    // Waiting for the headers: Stop replaces Send, and ⌘↵ does not send twice.
    expect(within(response()).getByText('Waiting for a response…')).toBeTruthy()
    expect(response().getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull()
    await fireEvent.keyDown(urlInput(), { key: 'Enter', ctrlKey: true })
    expect(http.sendRequest).toHaveBeenCalledOnce()

    const { signal, onProgress } = vi.mocked(http.sendRequest).mock.calls[0]![1]!
    const head = ok({ headers: { 'content-type': 'text/event-stream' }, body: '' })
    onProgress!(head)
    await settle()
    expect(within(response()).getByText('Streaming…')).toBeTruthy()
    // An empty body so far is not "(empty body)".
    expect(response().querySelector('pre')!.textContent).toBe('')
    // A body still arriving is shown raw, even when it parses as JSON, and
    // the view follows its end.
    const pre = response().querySelector('pre')!
    Object.defineProperty(pre, 'scrollHeight', { configurable: true, value: 500 })
    onProgress!({ ...head, body: '{"a":1}' })
    await settle()
    expect(pre.textContent).toBe('{"a":1}')
    expect(pre.scrollTop).toBe(500)
    // A reader who scrolls up keeps their place.
    Object.defineProperty(pre, 'clientHeight', { configurable: true, value: 100 })
    pre.scrollTop = 0
    await fireEvent.scroll(pre)
    onProgress!({ ...head, body: '{"a":1' })
    await settle()
    expect(pre.scrollTop).toBe(0)

    await user.click(screen.getByRole('button', { name: /^Stop/ }))
    expect(signal!.aborted).toBe(true)
    resolve(ok({ body: '{"a":1', truncated: 'stopped' }))
    await settle()
    expect(within(response()).queryByText('Streaming…')).toBeNull()
    expect(
      within(response()).getByText('Stopped while streaming; showing what arrived'),
    ).toBeTruthy()
    expect(sendButton().disabled).toBe(false)
  })

  it('shows only the end of a long body while it streams, and all of it once it ends', async () => {
    const note = 'Showing the end while streaming; all of it once it ends'
    const long = `${'a'.repeat(70 * 1024)}END`
    let resolve!: (r: ApiResponse) => void
    vi.mocked(http.sendRequest).mockImplementation((_req, opts) => {
      opts!.onProgress!(ok({ body: long, headers: {} }))
      return new Promise(r => {
        resolve = r
      })
    })
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    const shown = response().querySelector('pre')!.textContent
    expect(shown).toHaveLength(64 * 1024)
    expect(shown.endsWith('END')).toBe(true)
    expect(within(response()).getByText(note)).toBeTruthy()

    resolve(ok({ body: long, headers: {} }))
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe(long)
    expect(within(response()).queryByText(note)).toBeNull()
  })

  it('never starts the streaming tail inside a surrogate pair', async () => {
    // '😀' is two UTF-16 units; the 64 Ki-character cut falls between them
    const body = `😀${'a'.repeat(64 * 1024 - 1)}`
    vi.mocked(http.sendRequest).mockImplementation((_req, opts) => {
      opts!.onProgress!(ok({ body, headers: {} }))
      return new Promise(() => {})
    })
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe('a'.repeat(64 * 1024 - 1))
  })

  it('stopping before any response is not a failure', async () => {
    vi.mocked(http.sendRequest).mockImplementation(
      (_req, opts) =>
        new Promise(resolve => {
          opts!.signal!.addEventListener('abort', () => {
            resolve(ok({ status: 0, statusText: 'Stopped', headers: {}, body: '', size: 0 }))
          })
        }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await user.click(screen.getByRole('button', { name: /^Stop/ }))
    await settle()
    expect(within(response()).getByText('Stopped before a response')).toBeTruthy()
    expect(within(response()).queryByRole('alert')).toBeNull()
    // announced once, by the live region
    expect(within(response()).queryByRole('status')).toBeNull()
    expect(document.querySelector('[aria-live]')!.textContent).toBe('Stopped before a response')
    expect(sendButton().disabled).toBe(false)

    // sending again shows the next response
    vi.mocked(http.sendRequest).mockResolvedValue(ok())
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByText('200 OK')).toBeTruthy()
    expect(within(response()).queryByText('Stopped before a response')).toBeNull()
  })

  it('picking an endpoint after an early stop clears it', async () => {
    vi.mocked(http.sendRequest).mockImplementation(
      (_req, opts) =>
        new Promise(resolve => {
          opts!.signal!.addEventListener('abort', () => {
            resolve(ok({ status: 0, statusText: 'Stopped', headers: {}, body: '', size: 0 }))
          })
        }),
    )
    const { user, list } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await user.click(screen.getByRole('button', { name: /^Stop/ }))
    await settle()
    await user.click(within(list).getAllByRole('option')[0]!)
    expect(within(response()).getByText('Send a request')).toBeTruthy()
  })

  it('a frame still pending never paints older progress over the result', async () => {
    vi.mocked(http.sendRequest).mockImplementation((_req, opts) => {
      // the last chunk and the end arrive in the same frame
      opts!.onProgress!(ok({ body: 'partial' }))
      return Promise.resolve(ok({ body: 'final', truncated: 'size' }))
    })
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe('final')
    expect(within(response()).getByText('Body cut at 5.00 MB')).toBeTruthy()
  })

  it('shows a request with no response (status 0) as a failure', async () => {
    vi.mocked(http.sendRequest).mockResolvedValue(
      ok({ status: 0, statusText: 'Failed to fetch (cors hint)', headers: {}, body: '', size: 0 }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByRole('alert').textContent).toContain(
      'Failed to fetch (cors hint)',
    )
    expect(within(response()).queryByText(/^0 /)).toBeNull()
  })

  it('a new send clears the last response and follows its stream again', async () => {
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByText('200 OK')).toBeTruthy()
    // scroll up in the finished response
    const pre = response().querySelector('pre')!
    Object.defineProperty(pre, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(pre, 'scrollHeight', { configurable: true, value: 500 })
    pre.scrollTop = 0
    await fireEvent.scroll(pre)

    vi.mocked(http.sendRequest).mockReturnValue(new Promise(() => {}))
    await user.click(sendButton())
    // the previous response is gone while the new one is awaited
    expect(within(response()).getByText('Waiting for a response…')).toBeTruthy()
    const { onProgress } = vi.mocked(http.sendRequest).mock.calls[1]![1]!
    onProgress!(ok({ body: 'streaming' }))
    await settle()
    const next = response().querySelector('pre')!
    Object.defineProperty(next, 'scrollHeight', { configurable: true, value: 900 })
    onProgress!(ok({ body: 'streaming more' }))
    await settle()
    expect(next.scrollTop).toBe(900)
  })

  it('picking another endpoint stops the request and drops its late results', async () => {
    let resolve!: (r: ApiResponse) => void
    vi.mocked(http.sendRequest).mockReturnValue(
      new Promise(r => {
        resolve = r
      }),
    )
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    await user.click(sendButton())
    const { signal, onProgress } = vi.mocked(http.sendRequest).mock.calls[0]![1]!
    onProgress!(ok({ body: 'old stream' }))
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe('old stream')

    await user.click(within(list).getAllByRole('option')[1]!)
    expect(signal!.aborted).toBe(true)
    // the new endpoint is ready at once, not waiting for the old request
    expect(within(response()).getByText('Send a request')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull()
    // a chunk of the old stream arrives and its frame fires
    onProgress!(ok({ body: 'old stream, more' }))
    await settle()
    expect(within(response()).getByText('Send a request')).toBeTruthy()
    // a new request starts before the old one ends
    vi.mocked(http.sendRequest).mockReturnValue(new Promise(() => {}))
    await user.click(sendButton())
    // a late chunk of the old request lands after the new one's own chunk
    const next = vi.mocked(http.sendRequest).mock.calls[1]![1]!
    next.onProgress!(ok({ body: 'NEW' }))
    onProgress!(ok({ body: 'OLD' }))
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe('NEW')
    // then the old request ends: the new one is still in flight
    resolve(ok({ body: 'old stream, more', truncated: 'stopped' }))
    await settle()
    expect(within(response()).getByText('Streaming…')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Stop/ }))
    expect(next.signal!.aborted).toBe(true)
    expect(urlInput().value).toBe(`${location.origin}/app/api/items/:id`)
  })

  it('announces the status and the final size, not every repaint', async () => {
    let resolve!: (r: ApiResponse) => void
    vi.mocked(http.sendRequest).mockReturnValue(
      new Promise(r => {
        resolve = r
      }),
    )
    const { user, container } = await setup()
    const live = () => container.querySelectorAll('[aria-live]')
    expect(live()).toHaveLength(1)
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    const { onProgress } = vi.mocked(http.sendRequest).mock.calls[0]![1]!
    onProgress!(ok({ body: 'a', size: 1, duration: 1 }))
    await settle()
    expect(live()[0]!.textContent).toBe('200 OK, streaming')
    onProgress!(ok({ body: 'ab', size: 2, duration: 2 }))
    await settle()
    expect(live()[0]!.textContent).toBe('200 OK, streaming')
    resolve(ok({ body: 'abc', size: 3 }))
    await settle()
    expect(live()).toHaveLength(1)
    expect(live()[0]!.textContent).toBe('200 OK, 3 B')
  })

  it('shows one repaint per frame with the latest progress, and the byte size', async () => {
    vi.mocked(http.sendRequest).mockImplementation((_req, opts) => {
      // two chunks in the same frame: only the second is painted
      opts!.onProgress!(ok({ body: 'first', size: 5 }))
      opts!.onProgress!(ok({ body: 'first second', size: 2048 }))
      return new Promise(() => {})
    })
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(raf).toHaveBeenCalledOnce()
    expect(response().querySelector('pre')!.textContent).toBe('first second')
    expect(within(response()).getByText('2.0 KB')).toBeTruthy()
  })

  it('aborts the request in flight when the panel goes away', async () => {
    vi.mocked(http.sendRequest).mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const { unmount } = render(ApiPlayground)
    await settle()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    const { signal } = vi.mocked(http.sendRequest).mock.calls[0]![1]!
    expect(signal!.aborted).toBe(false)
    unmount()
    expect(signal!.aborted).toBe(true)
  })

  it('names the headers the browser will drop', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('tab', { name: /Headers/ }))
    const headers = screen.getByRole('textbox', { name: 'Request headers as JSON' })
    await user.clear(headers)
    await user.type(headers, '{{"Cookie":"a=1","x-ok":"1","Sec-Fetch-Mode":"x","Proxy-Auth":"y"}')
    expect(screen.getByText('Cookie, Sec-Fetch-Mode, Proxy-Auth')).toBeTruthy()
    await user.clear(headers)
    await user.type(headers, '{{"x-ok":"1"}')
    expect(screen.queryByText(/drops them here/)).toBeNull()
  })

  it('validates headers JSON and blocks sending', async () => {
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(screen.getByRole('tab', { name: /Headers/ }))
    const headers = screen.getByRole('textbox', { name: 'Request headers as JSON' })
    await user.clear(headers)
    await user.type(headers, '[[1]')
    expect(screen.getByText('Headers must be a JSON object')).toBeTruthy()
    expect(headers.getAttribute('aria-invalid')).toBe('true')
    expect(sendButton().disabled).toBe(true)
    await user.type(headers, 'x')
    expect(headers.getAttribute('aria-invalid')).toBe('true')
    await fireEvent.keyDown(headers, { key: 'Enter', metaKey: true })
    expect(http.sendRequest).not.toHaveBeenCalled()
    // Back to the body tab: HEAD/GET explain there is no body.
    await user.click(screen.getByRole('tab', { name: 'Body' }))
    expect(screen.getByRole('tab', { name: 'Body' }).getAttribute('aria-selected')).toBe('true')
  })

  it('rejects header values that are not strings', async () => {
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(screen.getByRole('tab', { name: /Headers/ }))
    const headers = screen.getByRole('textbox', { name: 'Request headers as JSON' })
    await user.clear(headers)
    await user.type(headers, '{{"x-n":1}')
    expect(screen.getByText('Header values must be strings')).toBeTruthy()
    expect(sendButton().disabled).toBe(true)
  })

  it.each([
    ['size', 'Body cut at 5.00 MB'],
    ['stopped', 'Stopped while streaming; showing what arrived'],
    ['error', 'Connection failed midway; showing what arrived'],
  ] as const)('says why a %s-truncated body is partial', async (truncated, note) => {
    vi.mocked(http.sendRequest).mockResolvedValue(ok({ truncated }))
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByText(note)).toBeTruthy()
    expect(within(response()).queryByText(/Redirected/)).toBeNull()
  })

  it('shows where a redirect ended', async () => {
    vi.mocked(http.sendRequest).mockResolvedValue(ok({ redirected: true, url: 'http://x/login' }))
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(within(response()).getByText('Redirected to http://x/login')).toBeTruthy()
  })

  it('rescans endpoints', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Rescan endpoints' }))
    await settle()
    expect(rpc.getApiEndpoints).toHaveBeenCalledTimes(2)
  })

  it('ignores plain Enter in the client area', async () => {
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await fireEvent.keyDown(urlInput(), { key: 'a', metaKey: true })
    expect(http.sendRequest).not.toHaveBeenCalled()
  })
})
