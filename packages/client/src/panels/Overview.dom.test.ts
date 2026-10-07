import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { AssetInfo, ComponentInstance, RouteInfo } from '../lib/types.js'
import { settle } from '../test/dom.js'
import { project } from '../test/fake-rpc.js'
import Overview from './Overview.svelte'

function route(id: string, page: boolean, endpoint: boolean): RouteInfo {
  return {
    id,
    path: id,
    pattern: id,
    segments: [],
    hasPage: page,
    hasLayout: false,
    hasServerPage: false,
    hasServerLayout: false,
    hasEndpoint: endpoint,
    hasPageLoad: false,
    hasLayoutLoad: false,
    params: [],
    files: [],
  }
}

function asset(name: string, size: number): AssetInfo {
  return { name, path: name, relativePath: name, url: `/${name}`, size, type: 'image', mtime: 0 }
}

function instance(id: number, file: string): ComponentInstance {
  return { id, file, name: file, parentId: null, mounted: true }
}

function withData() {
  vi.mocked(rpc.getProject).mockResolvedValue({
    ...project,
    dependencies: { svelte: '^5.0.0', zod: '^3.0.0' },
    devDependencies: { vite: '^6.0.0', '@sveltejs/kit': '^2.0.0' },
  })
  vi.mocked(rpc.getRoutes).mockResolvedValue([
    route('/', true, false),
    route('/about', true, false),
    route('/api', false, true),
  ])
  vi.mocked(rpc.getAssets).mockResolvedValue([asset('a.png', 1024), asset('b.png', 1024)])
  vi.mocked(rpc.getModuleGraph).mockResolvedValue({ modules: [], cycles: [['a', 'b']] })
  vi.mocked(rpc.getLiveComponents).mockResolvedValue([
    instance(1, 'A.svelte'),
    instance(2, 'A.svelte'),
    instance(3, 'B.svelte'),
  ])
  vi.mocked(rpc.getCompilerWarnings).mockResolvedValue([
    { code: 'a11y', message: 'm', file: 'x.svelte' },
  ])
  vi.mocked(rpc.getRuntimeErrors).mockResolvedValue([{ message: 'boom', timestamp: 0 }])
}

const tile = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) })
const depNames = () =>
  within(screen.getByRole('list', { name: 'Dependencies' }))
    .getAllByRole('listitem')
    .map(li => li.textContent.replaceAll(/\s+/g, ' ').trim())

describe('Overview panel', () => {
  it('shows a loading skeleton, then the project with versions', async () => {
    render(Overview)
    expect(screen.queryByRole('heading', { name: 'demo-app' })).toBeNull()
    await settle()
    expect(screen.getByRole('region', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'demo-app' })).toBeTruthy()
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    const versions = screen.getAllByRole('definition').map(d => d.textContent)
    expect(versions).toEqual(['5.0.0', '2.0.0', '6.0.0'])
  })

  it('falls back for a project without name, version or framework versions', async () => {
    vi.mocked(rpc.getProject).mockResolvedValue({
      ...project,
      name: '',
      version: '',
      svelteVersion: '',
      sveltekitVersion: '',
      viteVersion: '',
    })
    render(Overview)
    await settle()
    expect(screen.getByRole('heading', { name: 'Untitled project' })).toBeTruthy()
    expect(screen.getAllByRole('definition').map(d => d.textContent)).toEqual(['—', '—', '—'])
    expect(screen.getByText('No packages match.')).toBeTruthy()
  })

  it('summarises routes, components, modules, assets and problems in tiles', async () => {
    withData()
    render(Overview)
    await settle()
    expect(tile('Routes').textContent).toContain('3')
    expect(tile('Routes').textContent).toContain('2 pages · 1 endpoints')
    expect(tile('Mounted components').textContent).toContain('from 2 files')
    expect(tile('Modules').textContent).toContain('1 circular')
    expect(tile('Static assets').textContent).toContain('2')
    expect(tile('Static assets').textContent).toContain('2.0 KB')
    expect(tile('Problems').textContent).toContain('1 errors · 1 warnings')
  })

  it('shows "—" for stats whose RPC failed and "no cycles" when there are none', async () => {
    vi.mocked(rpc.getRoutes).mockRejectedValue(new Error('no kit'))
    vi.mocked(rpc.getLiveComponents).mockRejectedValue(new Error('no runtime'))
    vi.mocked(rpc.getRuntimeErrors).mockRejectedValue(new Error('x'))
    render(Overview)
    await settle()
    expect(tile('Routes').textContent).toContain('— pages · — endpoints')
    expect(tile('Mounted components').textContent).not.toContain('from')
    expect(tile('Modules').textContent).toContain('no cycles')
    expect(tile('Problems').textContent).toContain('— errors · 0 warnings')
  })

  it('does not claim "no cycles" when the module graph could not be read', async () => {
    vi.mocked(rpc.getModuleGraph).mockRejectedValue(new Error('no graph'))
    render(Overview)
    await settle()
    expect(tile('Modules').textContent).toContain('—')
    expect(tile('Modules').textContent).not.toContain('cycles')
  })

  it('updates the mounted components once the app reports them, only when they changed', async () => {
    vi.useFakeTimers()
    onTestFinished(() => void vi.useRealTimers())
    let components = 0
    vi.mocked(rpc.getVersions).mockImplementation(() =>
      Promise.resolve({
        components,
        renderProfiles: 0,
        loadProfiles: 0,
        stateTimeline: 0,
        reactiveGraph: 0,
        errors: 0,
        fps: 0,
      }),
    )
    render(Overview)
    await vi.advanceTimersByTimeAsync(0)
    // first load: the runtime has not reported its components yet
    expect(tile('Mounted components').textContent).toContain('from 0 files')
    const calls = vi.mocked(rpc.getLiveComponents).mock.calls.length

    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(rpc.getLiveComponents).mock.calls.length).toBe(calls) // version unchanged

    vi.mocked(rpc.getLiveComponents).mockResolvedValue([
      instance(1, 'src/App.svelte'),
      instance(2, 'src/Box.svelte'),
      instance(3, 'src/Box.svelte'),
    ])
    components = 1
    await vi.advanceTimersByTimeAsync(2000)
    expect(tile('Mounted components').textContent).toContain('3')
    expect(tile('Mounted components').textContent).toContain('from 2 files')
  })

  it('navigates to a panel from its tile', async () => {
    withData()
    render(Overview)
    await settle()
    await userEvent.click(tile('Routes'))
    expect(location.hash).toBe('#/routes')
    await userEvent.click(tile('Problems'))
    expect(location.hash).toBe('#/errors')
  })

  it('lists dependencies sorted, filters by kind and by name', async () => {
    withData()
    render(Overview)
    await settle()
    expect(depNames()).toEqual([
      '@sveltejs/kit dev ^2.0.0',
      'svelte ^5.0.0',
      'vite dev ^6.0.0',
      'zod ^3.0.0',
    ])
    const kinds = screen.getByRole('radiogroup', { name: 'Dependency kind' })
    expect(within(kinds).getByRole('radio', { name: 'All 4' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    await userEvent.click(within(kinds).getByRole('radio', { name: 'Runtime 2' }))
    expect(depNames()).toEqual(['svelte ^5.0.0', 'zod ^3.0.0'])
    await userEvent.click(within(kinds).getByRole('radio', { name: 'Dev 2' }))
    expect(depNames()).toEqual(['@sveltejs/kit dev ^2.0.0', 'vite dev ^6.0.0'])

    await userEvent.click(within(kinds).getByRole('radio', { name: 'All 4' }))
    await userEvent.type(screen.getByRole('searchbox', { name: /^Filter/ }), 'svelte')
    expect(depNames()).toEqual(['@sveltejs/kit dev ^2.0.0', 'svelte ^5.0.0'])
    await userEvent.type(screen.getByRole('searchbox', { name: /^Filter/ }), 'zzz')
    expect(depNames()).toEqual(['No packages match.'])
  })

  it('shows an error with the reason and retries', async () => {
    vi.mocked(rpc.getProject).mockRejectedValueOnce(new Error('RPC get-project failed: down'))
    render(Overview)
    await settle()
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Dev server not reachable')).toBeTruthy()
    expect(within(alert).getByText('RPC get-project failed: down')).toBeTruthy()
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { name: 'demo-app' })).toBeTruthy()
  })

  it('refreshes the project and the stats', async () => {
    render(Overview)
    await settle()
    expect(rpc.getProject).toHaveBeenCalledOnce()
    withData()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await settle()
    expect(rpc.getProject).toHaveBeenCalledTimes(2)
    expect(rpc.getRoutes).toHaveBeenCalledTimes(2)
    expect(rpc.getLiveComponents).toHaveBeenCalledTimes(2)
    expect(tile('Routes').textContent).toContain('3')
    expect(tile('Mounted components').textContent).toContain('from 2 files')
  })
})
