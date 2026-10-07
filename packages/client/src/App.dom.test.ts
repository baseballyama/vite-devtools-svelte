import { render, screen, waitFor, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import App from './App.svelte'
import { settle } from './test/dom.js'
import { emitConnection } from './test/fake-rpc.js'

// One panel whose module fails to load and one that throws while rendering,
// to exercise the shell's error states. Every other panel is the real one
// (over the fake RPC layer).
vi.mock('./panels/OGPreview.svelte', () => {
  throw new Error('chunk failed')
})
vi.mock('./panels/FpsMonitor.svelte', () => ({
  default: () => {
    throw new Error('kaboom')
  },
}))

/** The router follows `hashchange` (links, back/forward, deep links). */
function navigate(hash: string) {
  history.pushState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  flushSync()
}

async function renderApp(hash = '#/overview') {
  navigate(hash)
  const view = render(App)
  await settle()
  return view
}

const nav = () => screen.getByRole('navigation', { name: 'Panels' })
const current = () =>
  within(nav())
    .getAllByRole('link')
    .find(a => a.getAttribute('aria-current'))
const themeButton = () => screen.getByRole('button', { name: /^Theme: / })

/** Open the palette with Ctrl+K and click the command whose label matches. */
async function runCommand(label: string) {
  await userEvent.keyboard('{Control>}k{/Control}')
  await userEvent.click(screen.getByRole('option', { name: new RegExp(label) }))
}
const visiblePanel = () => screen.getByRole('region', { name: n => n !== 'Dependencies' })

describe('App shell', () => {
  it('lists every panel by group and opens the panel named in the hash', async () => {
    await renderApp('#/routes')
    for (const group of ['App', 'Performance', 'Tools'])
      expect(within(nav()).getByRole('group', { name: group })).toBeTruthy()
    expect(within(nav()).getAllByRole('link')).toHaveLength(15)
    expect(current()?.textContent).toContain('Routes')
    expect(current()?.getAttribute('href')).toBe('#/routes')
    expect(document.title).toBe('Routes · Svelte DevTools')
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Routes'))
  })

  it('falls back to Overview for an unknown hash', async () => {
    await renderApp('#/nope')
    expect(current()?.textContent).toContain('Overview')
    expect(document.title).toBe('Overview · Svelte DevTools')
  })

  it('switches panels on hash change and keeps visited panels mounted but hidden', async () => {
    await renderApp('#/overview')
    await screen.findByRole('heading', { name: 'demo-app' })

    navigate('#/modules')
    // A panel shows a loading bar until its module arrives.
    expect(screen.getByLabelText('Loading panel').getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Modules'))
    expect(current()?.textContent).toContain('Modules')
    // Overview stays in the DOM (state kept), hidden.
    expect(screen.queryByRole('heading', { name: 'demo-app' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'demo-app', hidden: true })).toBeTruthy()

    navigate('#/overview')
    expect(screen.getByRole('heading', { name: 'demo-app' })).toBeTruthy()
  })

  it('navigates with the sidebar links', async () => {
    await renderApp('#/overview')
    const link = within(nav()).getByRole('link', { name: 'Assets' })
    // happy-dom follows the fragment link and fires `hashchange`.
    await userEvent.click(link)
    await waitFor(() => expect(current()?.textContent).toContain('Assets'))
    expect(location.hash).toBe('#/assets')
  })

  it('reports a panel that fails to load', async () => {
    await renderApp('#/og')
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(within(screen.getByRole('alert')).getByText('Could not load panel')).toBeTruthy()
  })

  it('contains a panel that crashes while rendering and offers a reload', async () => {
    await renderApp('#/fps')
    // The panel module loads lazily: give a loaded machine more than the 1 s default.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 5000 })
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Frame rate crashed')).toBeTruthy()
    expect(within(alert).getByText('kaboom')).toBeTruthy()
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload panel' }))
    await settle()
    // Still broken: the boundary catches it again; the rest of the shell keeps working.
    expect(within(screen.getByRole('alert')).getByText('Frame rate crashed')).toBeTruthy()
    navigate('#/overview')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cycles the theme system → light → dark → system and persists overrides', async () => {
    await renderApp()
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: system (click to change)')
    await userEvent.click(themeButton())
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: light (click to change)')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('svelte-devtools-theme')).toBe('light')
    await userEvent.click(themeButton())
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: dark (click to change)')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await userEvent.click(themeButton())
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: system (click to change)')
    expect(localStorage.getItem('svelte-devtools-theme')).toBeNull()
  })

  it('collapses and expands the sidebar, remembering the choice', async () => {
    const { container } = await renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(true)
    expect(localStorage.getItem('svelte-devtools:nav')).toBe('"collapsed"')
    // Collapsed links keep their label as a tooltip.
    expect(within(nav()).getByRole('link', { name: 'Routes' }).getAttribute('title')).toBe('Routes')
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(false)
  })

  it('shows the dev-server connection status', async () => {
    await renderApp()
    const status = within(nav()).getByRole('status')
    expect(status.textContent).toContain('connected')
    expect(status.getAttribute('title')).toBe('Dev server: connected (standalone)')
    emitConnection({ status: 'connecting', host: 'unknown' })
    flushSync()
    expect(status.getAttribute('title')).toBe('Dev server: connecting')
    emitConnection({ status: 'connected', host: 'vite-devtools' })
    flushSync()
    expect(status.getAttribute('title')).toBe('Dev server: connected (Vite DevTools)')
  })
})

describe('App keyboard shortcuts and command palette', () => {
  it('toggles the palette with ⌘K / Ctrl+K and from the Search button', async () => {
    await renderApp()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    await userEvent.keyboard('{Meta>}K{/Meta}')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^Search/ }))
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('goes to a panel from the palette', async () => {
    await renderApp()
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.keyboard('timeline')
    expect(screen.getAllByRole('option')[0]!.textContent).toContain('State timeline')
    await userEvent.keyboard('{Enter}')
    expect(location.hash).toBe('#/timeline')
    expect(current()?.textContent).toContain('State timeline')
  })

  it('runs preference commands from the palette', async () => {
    const { container } = await renderApp()
    await runCommand('Theme: dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await runCommand('Theme: light')
    expect(document.documentElement.dataset.theme).toBe('light')
    await runCommand('Theme: follow system')
    expect(localStorage.getItem('svelte-devtools-theme')).toBeNull()
    await runCommand('Collapse sidebar')
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(true)
    await runCommand('Expand sidebar')
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(false)
  })

  it('steps through panels with Alt+↑/↓, wrapping around', async () => {
    await renderApp('#/overview')
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(location.hash).toBe('#/components')
    await userEvent.keyboard('{Alt>}{ArrowUp}{ArrowUp}{/Alt}')
    expect(location.hash).toBe('#/og')
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(location.hash).toBe('#/overview')
  })

  it('focuses the visible panel search with "/", but not while typing', async () => {
    await renderApp('#/overview')
    const search = await screen.findByRole('searchbox')
    await userEvent.keyboard('/')
    expect(document.activeElement).toBe(search)
    // Inside an input "/" is just a character.
    await userEvent.keyboard('/')
    expect((search as HTMLInputElement).value).toBe('/')

    search.blur()
    // While the palette is open, shortcuts other than ⌘K are left to it.
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(location.hash).toBe('#/overview')
  })

  it('ignores "/" on a panel without a search field', async () => {
    await renderApp('#/fps')
    await screen.findByRole('alert')
    document.body.focus()
    await userEvent.keyboard('/')
    expect(document.activeElement).toBe(document.body)
  })
})
