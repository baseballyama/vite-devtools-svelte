import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { OGPreview, RouteInfo } from '../lib/types.js'
import { settle } from '../test/dom.js'
import OGPreviewPanel from './OGPreview.svelte'

function route(path: string, over: Partial<RouteInfo> = {}): RouteInfo {
  return {
    id: path,
    path,
    pattern: path,
    segments: path.split('/').filter(Boolean),
    hasPage: true,
    hasLayout: false,
    hasServerPage: false,
    hasServerLayout: false,
    hasEndpoint: false,
    hasPageLoad: false,
    hasLayoutLoad: false,
    params: [],
    files: [],
    ...over,
  }
}

const full: OGPreview = {
  url: 'https://example.com/about',
  title: 'About us',
  description: 'Who we are',
  image: 'https://example.com/og.png',
  tags: [
    { property: 'og:title', content: 'About us' },
    { property: 'twitter:card', content: 'summary_large_image' },
  ],
  issues: [],
}

/** Answer Svelte's `select.querySelector(':checked')`, which happy-dom does not match for options. */
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

async function setup() {
  const user = userEvent.setup()
  render(OGPreviewPanel)
  await settle()
  return user
}

const routeSelect = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Route' })
const previewButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Preview' })

beforeEach(() => {
  vi.mocked(rpc.getRoutes).mockResolvedValue([
    route('/'),
    route('/about'),
    route('/blog/[slug]', { params: [{ name: 'slug', optional: false, rest: false }] }),
    route('/api', { hasPage: false }),
  ])
  vi.mocked(rpc.getOGPreview).mockResolvedValue(full)
})

describe('OGPreview', () => {
  it('offers only static page routes and starts with an explainer', async () => {
    await setup()
    const options = within(routeSelect()).getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['/', '/about'])
    expect(screen.getByText('Check how a page unfurls')).toBeTruthy()
  })

  it('falls back to "/" when the app has no routes', async () => {
    vi.mocked(rpc.getRoutes).mockResolvedValue([])
    await setup()
    expect(
      within(routeSelect())
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual(['/'])
  })

  it('previews the chosen route: cards, checks and tags', async () => {
    const user = await setup()
    await choose(routeSelect(), '/about')
    expect(screen.getByRole('button', { name: 'Preview /about' })).toBeTruthy()
    await user.click(previewButton())
    await settle()
    expect(rpc.getOGPreview).toHaveBeenCalledWith(`${location.origin}/about`)
    const cards = screen.getByRole('region', { name: 'Card previews' })
    expect(within(cards).getByText('X / Twitter · summary_large_image')).toBeTruthy()
    expect(within(cards).getAllByText('About us')).toHaveLength(2)
    expect(within(cards).getAllByText('example.com')).toHaveLength(2)
    expect(cards.querySelectorAll('img')).toHaveLength(2)
    expect(screen.getByText('all good')).toBeTruthy()
    expect(screen.getByText('Title, description and image are present.')).toBeTruthy()
    expect(screen.getByText('twitter:card')).toBeTruthy()
  })

  it('reports missing tags and lists the issues', async () => {
    vi.mocked(rpc.getOGPreview).mockResolvedValue({
      url: 'not a url',
      title: '',
      description: '',
      image: '',
      tags: [],
      issues: ['Missing og:title', 'Missing og:image'],
    })
    const user = await setup()
    // The explainer's own button runs the preview too.
    await user.click(screen.getByRole('button', { name: 'Preview /' }))
    await settle()
    expect(screen.getAllByText('Untitled page')).toHaveLength(2)
    expect(screen.getAllByText('No description')).toHaveLength(2)
    expect(screen.getByText('no og:image')).toBeTruthy()
    expect(screen.getByText('X / Twitter · summary')).toBeTruthy()
    expect(screen.getByText('Missing og:image')).toBeTruthy()
    expect(screen.getByText('none')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('previews a custom URL and disables the route picker', async () => {
    const user = await setup()
    await user.type(screen.getByRole('textbox', { name: 'Custom URL' }), '  https://x.dev/p  ')
    expect(routeSelect().disabled).toBe(true)
    await user.click(previewButton())
    await settle()
    expect(rpc.getOGPreview).toHaveBeenCalledWith('https://x.dev/p')
  })

  it('renders tag content with markup as text', async () => {
    vi.mocked(rpc.getOGPreview).mockResolvedValue({
      ...full,
      image: '',
      title: '<img src=x onerror=alert(1)>',
      tags: [{ property: 'og:description', content: '<script>alert(1)</script>' }],
    })
    const user = await setup()
    await user.click(previewButton())
    await settle()
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(screen.getAllByText('<img src=x onerror=alert(1)>')).toHaveLength(2)
    expect(document.querySelector('script, img')).toBeNull()
  })

  it('shows a fetch error, then recovers', async () => {
    vi.mocked(rpc.getOGPreview).mockRejectedValueOnce(new Error('404 page'))
    vi.mocked(rpc.getOGPreview).mockRejectedValueOnce('timeout')
    const user = await setup()
    await user.click(previewButton())
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('404 page')
    await user.click(previewButton())
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('timeout')
    await user.click(previewButton())
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('region', { name: 'Card previews' })).toBeTruthy()
  })

  it('shows "Fetching…" while the request is in flight', async () => {
    let resolve!: (p: OGPreview) => void
    vi.mocked(rpc.getOGPreview).mockReturnValue(
      new Promise(r => {
        resolve = r
      }),
    )
    const user = await setup()
    await user.click(previewButton())
    const busy = screen.getByRole<HTMLButtonElement>('button', { name: 'Fetching…' })
    expect(busy.disabled).toBe(true)
    resolve(full)
    await settle()
    expect(previewButton().disabled).toBe(false)
  })
})
