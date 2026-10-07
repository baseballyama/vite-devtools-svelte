import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { ApiEndpoint, ApiResponse } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import ApiPlayground from './ApiPlayground.svelte'

const endpoints: ApiEndpoint[] = [
  {
    route: '/api/users',
    path: '/api/users',
    methods: ['GET', 'POST'],
    file: 'src/routes/api/users/+server.ts',
  },
  {
    route: '/api/items/[id]',
    path: '/api/items/[id]',
    methods: ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    file: 'src/routes/api/items/[id]/+server.ts',
  },
  {
    route: '/api/ping',
    path: '/api/ping',
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
    duration: 12,
    ...over,
  }
}

async function setup() {
  const user = userEvent.setup()
  render(ApiPlayground)
  await settle()
  return { user, list: screen.getByRole('listbox', { name: 'API endpoints' }) }
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

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }))
  vi.mocked(rpc.getApiEndpoints).mockResolvedValue(endpoints)
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

  it('shows a scanning state until endpoints load', async () => {
    vi.mocked(rpc.getApiEndpoints).mockReturnValue(new Promise(() => {}))
    const { list } = await setup()
    expect(within(list).getByText('Scanning +server files…')).toBeTruthy()
  })

  it('picking an endpoint fills method and URL; sending calls the RPC and shows the response', async () => {
    vi.mocked(rpc.sendApiRequest).mockResolvedValue(
      ok({ headers: { 'Content-Type': 'application/json', 'x-id': '7' } }),
    )
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    expect(urlInput().value).toBe(`${location.origin}/api/users`)
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

    expect(rpc.sendApiRequest).toHaveBeenCalledWith(
      `${location.origin}/api/users`,
      'POST',
      '{"x-a":"b"}',
      '{"n":1}',
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
    vi.mocked(rpc.sendApiRequest).mockResolvedValue(
      ok({ status: 404, statusText: 'Not Found', headers: {}, body: '' }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/y')
    await user.click(screen.getByRole('tab', { name: /Headers/ }))
    await user.clear(screen.getByRole('textbox', { name: 'Request headers as JSON' }))
    await fireEvent.keyDown(urlInput(), { key: 'Enter', metaKey: true })
    await settle()
    expect(rpc.sendApiRequest).toHaveBeenCalledWith('http://x/y', 'GET', '{}', '')
    expect(within(response()).getByText('404 Not Found')).toBeTruthy()
    expect(within(response()).getByText('(empty body)')).toBeTruthy()
  })

  it('keeps non-JSON bodies verbatim and renders markup in them as text', async () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    vi.mocked(rpc.sendApiRequest).mockResolvedValue(
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
    vi.mocked(rpc.sendApiRequest).mockResolvedValue(
      ok({ status: 100, statusText: 'Continue', headers: {}, body: '{oops' }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    await settle()
    expect(response().querySelector('pre')!.textContent).toBe('{oops')
  })

  it('shows a failed request and recovers on the next send', async () => {
    vi.mocked(rpc.sendApiRequest).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.mocked(rpc.sendApiRequest).mockRejectedValueOnce('plain failure')
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

  it('shows "Sending…" and ignores repeat sends while a request is in flight', async () => {
    let resolve!: (r: ApiResponse) => void
    vi.mocked(rpc.sendApiRequest).mockReturnValue(
      new Promise(r => {
        resolve = r
      }),
    )
    const { user } = await setup()
    await user.type(urlInput(), 'http://x/')
    await user.click(sendButton())
    expect(sendButton().textContent).toContain('Sending…')
    expect(sendButton().disabled).toBe(true)
    await fireEvent.keyDown(urlInput(), { key: 'Enter', ctrlKey: true })
    expect(rpc.sendApiRequest).toHaveBeenCalledOnce()
    resolve(ok())
    await settle()
    expect(sendButton().textContent).toContain('Send')
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
    expect(rpc.sendApiRequest).not.toHaveBeenCalled()
    // Back to the body tab: HEAD/GET explain there is no body.
    await user.click(screen.getByRole('tab', { name: 'Body' }))
    expect(screen.getByRole('tab', { name: 'Body' }).getAttribute('aria-selected')).toBe('true')
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
    expect(rpc.sendApiRequest).not.toHaveBeenCalled()
  })
})
