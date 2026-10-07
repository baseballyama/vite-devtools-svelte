import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { AssetInfo } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import Assets from './Assets.svelte'

function asset(relativePath: string, type: string, size: number, mtime = 0, url = ''): AssetInfo {
  return {
    name: relativePath.split('/').at(-1)!,
    path: `/app/static/${relativePath}`,
    relativePath,
    url,
    size,
    type,
    mtime,
  }
}

const data: AssetInfo[] = [
  asset('img/logo.png', 'image/png', 600_000, 3, '/base/img/logo.png'),
  asset('fonts/inter.woff2', 'font/woff2', 40_000, 1),
  asset('robots.txt', 'text/plain', 100, 2),
  asset('data.bin', 'application/octet-stream', 2_000, 4),
  asset('clip.mp4', 'video/mp4', 300_000, 5),
  asset('ding.mp3', 'audio/mpeg', 5_000, 6),
]

async function setup() {
  const user = userEvent.setup()
  render(Assets)
  await settle()
  return { user, list: screen.getByRole('listbox', { name: 'Static assets' }) }
}

const names = (list: HTMLElement) =>
  within(list)
    .queryAllByRole('option')
    .map(o => o.querySelector('.file')!.textContent.trim())

const header = (name: string) =>
  screen.getAllByRole('columnheader').find(h => h.textContent.trim().startsWith(name))!

/** Only the `.table` container is narrow. */
const narrow = (el: HTMLElement) => ({
  width: el.classList.contains('table') ? 600 : 1200,
  height: 800,
})

beforeEach(() => {
  layout(() => ({ width: 1200, height: 800 }))
  vi.mocked(rpc.getAssets).mockResolvedValue(data)
})

describe('Assets', () => {
  it('lists assets largest first with all columns at full width', async () => {
    const { list } = await setup()
    expect(names(list)).toEqual([
      'img/logo.png',
      'clip.mp4',
      'fonts/inter.woff2',
      'ding.mp3',
      'data.bin',
      'robots.txt',
    ])
    expect(header('Size').getAttribute('aria-sort')).toBe('descending')
    expect(header('File').getAttribute('aria-sort')).toBe('none')
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'File',
      'Type',
      'Modified',
      'Size',
    ])
    expect(within(list).getByText('image/png')).toBeTruthy()
    expect(screen.getByTitle('Total size of shown assets').textContent).toBe('924.9 KB')
    expect(screen.getByRole('heading', { name: /Assets/ }).textContent).toContain('6')
  })

  it('sorts by column, toggling the direction', async () => {
    const { user, list } = await setup()
    await user.click(within(header('File')).getByRole('button'))
    expect(header('File').getAttribute('aria-sort')).toBe('ascending')
    expect(names(list)[0]).toBe('clip.mp4')
    await user.click(within(header('File')).getByRole('button'))
    expect(header('File').getAttribute('aria-sort')).toBe('descending')
    expect(names(list)[0]).toBe('robots.txt')
    // Dates sort newest first on the first click.
    await user.click(within(header('Modified')).getByRole('button'))
    expect(header('Modified').getAttribute('aria-sort')).toBe('descending')
    expect(names(list)[0]).toBe('ding.mp3')
    await user.click(within(header('Type')).getByRole('button'))
    expect(names(list)[0]).toBe('data.bin')
  })

  it('hides secondary columns in narrow containers', async () => {
    layout(narrow)
    const { list } = await setup()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'File',
      'Size',
    ])
    expect(within(list).queryByText('image/png')).toBeNull()
  })

  it('filters by category (only the ones present) and by text', async () => {
    vi.mocked(rpc.getAssets).mockResolvedValue(data.filter(a => !a.type.startsWith('audio')))
    const { user, list } = await setup()
    const group = screen.getByRole('radiogroup', { name: 'Asset type' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map(r => r.textContent.replaceAll(/\s+/g, ' ').trim()),
    ).toEqual(['All 5', 'Image 1', 'Font 1', 'Video 1', 'Text 1', 'Other 1'])
    await user.click(within(group).getByRole('radio', { name: /Font/ }))
    expect(names(list)).toEqual(['fonts/inter.woff2'])
    await user.click(within(group).getByRole('radio', { name: /All/ }))
    await user.type(screen.getByRole('searchbox'), 'octet')
    expect(names(list)).toEqual(['data.bin'])
    expect(screen.getByTitle('Total size of shown assets').textContent).toBe('2.0 KB')
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(within(list).getByText('No assets match')).toBeTruthy()
  })

  it('keeps the chosen category listed after its last asset goes away', async () => {
    const { user } = await setup()
    const group = screen.getByRole('radiogroup', { name: 'Asset type' })
    await user.click(within(group).getByRole('radio', { name: /Font/ }))
    vi.mocked(rpc.getAssets).mockResolvedValue(data.filter(a => !a.type.startsWith('font')))
    await user.click(screen.getByRole('button', { name: 'Rescan static directory' }))
    await settle()
    const font = within(group).getByRole('radio', { name: /Font/ })
    expect(font.getAttribute('aria-checked')).toBe('true')
    expect(font.textContent).toContain('0')
  })

  it('shows an image asset with preview and actions', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    const details = screen.getByRole('complementary', { name: 'logo.png details' })
    expect(within(details).getByRole('img', { name: 'logo.png' }).getAttribute('src')).toBe(
      '/base/img/logo.png',
    )
    expect(within(details).getByText('600,000 bytes', { exact: false })).toBeTruthy()
    expect(within(details).getByText('/app/static/img/logo.png')).toBeTruthy()
    await user.click(within(details).getByRole('button', { name: 'Open URL' }))
    expect(open).toHaveBeenCalledWith('/base/img/logo.png', '_blank', 'noopener')
    await user.click(within(details).getByRole('button', { name: 'Reveal' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('/app/static/img/logo.png')
    await fireEvent.keyDown(details, { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('falls back to the root URL and shows no preview for non-images', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getByText('robots.txt'))
    const details = screen.getByRole('complementary', { name: 'robots.txt details' })
    expect(within(details).queryByRole('img')).toBeNull()
    expect(within(details).getByText('/robots.txt')).toBeTruthy()
    await user.click(within(details).getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens an asset in the editor with Enter', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getByText('robots.txt'))
    await user.keyboard('{Enter}')
    expect(rpc.openInEditor).toHaveBeenCalledWith('/app/static/robots.txt')
  })

  it('shows loading, error and empty states', async () => {
    let reject!: (e: Error) => void
    vi.mocked(rpc.getAssets).mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r
      }),
    )
    const { user, list } = await setup()
    expect(within(list).getByText('Scanning static directory…')).toBeTruthy()
    reject(new Error('ENOENT static'))
    await settle()
    expect(within(list).getByRole('alert').textContent).toContain('ENOENT static')
    vi.mocked(rpc.getAssets).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Rescan static directory' }))
    await settle()
    expect(within(list).getByText('No static assets')).toBeTruthy()
  })
})
