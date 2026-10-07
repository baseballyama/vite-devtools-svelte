import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { RouteInfo } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import Routes from './Routes.svelte'

function route(id: string, over: Partial<RouteInfo> = {}): RouteInfo {
  return {
    id,
    path: id.replaceAll(/\/\([^)]+\)/g, '') || '/',
    pattern: `^${id}$`,
    segments: id.split('/').filter(Boolean),
    hasPage: true,
    hasLayout: false,
    hasServerPage: false,
    hasServerLayout: false,
    hasEndpoint: false,
    hasPageLoad: false,
    hasLayoutLoad: false,
    params: [],
    files: [{ type: 'page', path: `src/routes${id === '/' ? '' : id}/+page.svelte` }],
    ...over,
  }
}

const routes: RouteInfo[] = [
  route('/', {
    hasLayout: true,
    files: [
      { type: 'layout', path: 'src/routes/+layout.svelte' },
      { type: 'page', path: 'src/routes/+page.svelte' },
      { type: 'error', path: 'src/routes/+error.svelte' },
    ],
  }),
  route('/about', { hasPageLoad: true, hasServerPage: true }),
  route('/blog/[slug]', {
    params: [{ name: 'slug', optional: false, rest: false, matcher: 'word' }],
    files: [
      { type: 'page-load-server', path: 'src/routes/blog/[slug]/+page.server.ts' },
      { type: 'page', path: 'src/routes/blog/[slug]/+page.svelte' },
    ],
  }),
  route('/(app)/dash', { hasServerLayout: true, hasLayoutLoad: true }),
  route('/api/items', {
    hasPage: false,
    hasEndpoint: true,
    files: [{ type: 'endpoint', path: 'src/routes/api/items/+server.ts' }],
  }),
  route('/docs/[[lang]]/[...rest]', {
    hasPage: false,
    params: [
      { name: 'lang', optional: true, rest: false },
      { name: 'rest', optional: false, rest: true },
    ],
    // A file type a newer server might add: shown by its raw name.
    files: [{ type: 'future' as 'page', path: 'src/routes/docs/[[lang]]/[...rest]/+future.ts' }],
  }),
]

async function setup() {
  const user = userEvent.setup()
  render(Routes)
  await settle()
  return { user, tree: screen.getByRole('tree', { name: 'Route tree' }) }
}

const items = (tree: HTMLElement) => within(tree).queryAllByRole('treeitem')
const labels = (tree: HTMLElement) =>
  items(tree).map(i => i.querySelector('.seg')!.textContent.trim())
const item = (tree: HTMLElement, seg: string) =>
  items(tree).find(i => i.querySelector('.seg')!.textContent.trim() === seg)!

beforeEach(() => {
  layout(() => ({ width: 1200, height: 800 }))
  vi.mocked(rpc.getRoutes).mockResolvedValue(routes)
})

describe('Routes', () => {
  it('renders the route tree fully expanded for small apps', async () => {
    const { tree } = await setup()
    expect(labels(tree)).toEqual([
      '/',
      '(app)',
      'dash',
      'about',
      'api',
      'items',
      'blog',
      '[slug]',
      'docs',
      '[[lang]]',
      '[...rest]',
    ])
    const root = item(tree, '/')
    expect(root.getAttribute('aria-level')).toBe('1')
    expect(root.getAttribute('aria-expanded')).toBe('true')
    expect(item(tree, 'dash').getAttribute('aria-level')).toBe('3')
    expect(item(tree, 'dash').getAttribute('aria-expanded')).toBeNull()
    // Route kind markers.
    expect(within(root).getByTitle('+page.svelte')).toBeTruthy()
    expect(within(root).getByTitle('+layout.svelte')).toBeTruthy()
    expect(within(item(tree, 'about')).getByTitle('server load')).toBeTruthy()
    expect(within(item(tree, 'dash')).getByTitle('universal load')).toBeTruthy()
    expect(within(item(tree, 'items')).getByTitle('+server endpoint')).toBeTruthy()
    // Segment kinds are styled apart.
    expect(item(tree, '[...rest]').querySelector('.seg.rest')).toBeTruthy()
    expect(item(tree, '[slug]').querySelector('.seg.param')).toBeTruthy()
    expect(item(tree, '(app)').querySelector('.seg.group.dir')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Routes/ }).textContent).toContain('6')
  })

  it('filters by kind with counts', async () => {
    const { user, tree } = await setup()
    const kinds = screen.getByRole('radiogroup', { name: 'Route kind' })
    expect(within(kinds).getByRole('radio', { name: /Pages/ }).textContent).toContain('4')
    await user.click(within(kinds).getByRole('radio', { name: /Endpoints/ }))
    expect(labels(tree)).toEqual(['/', 'api', 'items'])
    await user.click(within(kinds).getByRole('radio', { name: /Dynamic/ }))
    expect(labels(tree)).toContain('[slug]')
    expect(labels(tree)).toContain('[...rest]')
    expect(labels(tree)).not.toContain('about')
    await user.click(within(kinds).getByRole('radio', { name: /Pages/ }))
    expect(labels(tree)).toContain('about')
    expect(labels(tree)).not.toContain('items')
  })

  it('searches by path, highlights matches, and shows a no-match state', async () => {
    const { user, tree } = await setup()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'about')
    expect(labels(tree)).toEqual(['/', 'about'])
    expect(within(item(tree, 'about')).getAllByText('about')[0]!.tagName).toBe('MARK')
    await user.clear(search)
    await user.type(search, 'nope')
    expect(items(tree)).toHaveLength(0)
    expect(within(tree).getByText('No routes match')).toBeTruthy()
  })

  it('collapses and expands all', async () => {
    const { user, tree } = await setup()
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(labels(tree)).toEqual(['/', '(app)', 'about', 'api', 'blog', 'docs'])
    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(items(tree)).toHaveLength(11)
  })

  it('opens the details of a selected route and closes them', async () => {
    const { user, tree } = await setup()
    await user.click(item(tree, '[slug]'))
    const details = screen.getByRole('complementary', { name: '/blog/[slug] details' })
    expect(within(details).getByText('src/routes/blog/[slug]')).toBeTruthy()
    expect(within(details).getByText('slug=word').getAttribute('title')).toBe('matcher: word')
    expect(within(details).getByText('+page.server')).toBeTruthy()
    // Dynamic routes cannot be visited directly.
    expect(within(details).queryByRole('button', { name: 'Open page' })).toBeNull()
    await user.click(
      within(details).getByTitle('Open src/routes/blog/[slug]/+page.svelte in editor'),
    )
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/routes/blog/[slug]/+page.svelte')

    await user.click(within(details).getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()

    // Optional / rest params and unknown file types.
    await user.click(item(tree, '[...rest]'))
    const rest = screen.getByRole('complementary', { name: '/docs/[[lang]]/[...rest] details' })
    expect(within(rest).getByText('lang?')).toBeTruthy()
    expect(within(rest).getByText('...rest')).toBeTruthy()
    expect(within(rest).getByText('future')).toBeTruthy()
    await fireEvent.keyDown(rest, { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows the root route with its badges and visits static pages', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { user, tree } = await setup()
    await user.click(item(tree, '/'))
    const details = screen.getByRole('complementary', { name: '/ details' })
    expect(within(details).getByText('src/routes')).toBeTruthy()
    expect(within(details).getByText('page')).toBeTruthy()
    expect(within(details).getByText('layout')).toBeTruthy()
    expect(within(details).getByText('none')).toBeTruthy()
    expect(within(details).getByText('+error.svelte')).toBeTruthy()
    await user.click(within(details).getByRole('button', { name: 'Open page' }))
    expect(open).toHaveBeenCalledWith(`${location.origin}/`, '_blank', 'noopener')

    await user.click(item(tree, 'items'))
    const api = screen.getByRole('complementary', { name: '/api/items details' })
    expect(within(api).getByText('endpoint')).toBeTruthy()
    await user.click(item(tree, 'dash'))
    expect(
      within(screen.getByRole('complementary', { name: '/dash details' })).getByText('server load'),
    ).toBeTruthy()
  })

  it('Enter opens the primary file: page, else endpoint, else the first file', async () => {
    const { user, tree } = await setup()
    await user.click(item(tree, 'about'))
    await user.keyboard('{Enter}')
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/routes/about/+page.svelte')
    await user.click(item(tree, 'items'))
    await user.keyboard('{Enter}')
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/routes/api/items/+server.ts')
    await user.click(item(tree, '[...rest]'))
    await user.keyboard('{Enter}')
    expect(rpc.openInEditor).toHaveBeenLastCalledWith(
      'src/routes/docs/[[lang]]/[...rest]/+future.ts',
    )
    // A directory without route files has nothing to open.
    await user.click(item(tree, '(app)'))
    await user.keyboard('{Enter}')
    expect(rpc.openInEditor).toHaveBeenCalledTimes(3)
  })

  it('does nothing when a route has no files', async () => {
    vi.mocked(rpc.getRoutes).mockResolvedValue([route('/', { files: [] })])
    const { user, tree } = await setup()
    await user.click(item(tree, '/'))
    await user.keyboard('{Enter}')
    expect(rpc.openInEditor).not.toHaveBeenCalled()
  })

  it('expands only the first two levels of large apps', async () => {
    vi.mocked(rpc.getRoutes).mockResolvedValue(
      Array.from({ length: 61 }, (_, i) => route(`/s${i}/mid/deep`)),
    )
    const { tree } = await setup()
    // The root and the first-level directories are open; deeper ones stay collapsed.
    expect(item(tree, 's0').getAttribute('aria-expanded')).toBe('true')
    expect(labels(tree)).toContain('mid')
    expect(labels(tree)).not.toContain('deep')
  })

  it('shows loading, error and empty states', async () => {
    let reject!: (e: Error) => void
    vi.mocked(rpc.getRoutes).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r
      }),
    )
    const { user, tree } = await setup()
    expect(within(tree).getByText('Scanning src/routes…')).toBeTruthy()
    reject(new Error('EACCES'))
    await settle()
    expect(within(tree).getByRole('alert').textContent).toContain('EACCES')

    vi.mocked(rpc.getRoutes).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Rescan routes' }))
    await settle()
    expect(within(tree).getByText('No routes found')).toBeTruthy()
  })
})
