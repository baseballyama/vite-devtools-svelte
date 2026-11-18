import { render, screen, waitFor, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import App from './App.svelte';
import { elementPick } from './lib/element-pick.svelte.js';
import * as rpc from './lib/rpc.js';
import { settle } from './test/dom.js';
import { emitConnection, emitPick, project } from './test/fake-rpc.js';

// One panel whose module fails to load and one that throws while rendering,
// to exercise the shell's error states. Every other panel is the real one
// (over the fake RPC layer).
vi.mock('./panels/OGPreview.svelte', () => {
  throw new Error('chunk failed');
});
vi.mock('./panels/FpsMonitor.svelte', () => ({
  default: () => {
    throw new Error('kaboom');
  },
}));

/** The router follows `hashchange` (links, back/forward, deep links). */
function navigate(hash: string) {
  history.pushState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  flushSync();
}

async function renderApp(hash = '#/overview', search = '') {
  history.replaceState(null, '', `/${search}`);
  navigate(hash);
  const view = render(App);
  await settle();
  return view;
}

const nav = () => screen.getByRole('navigation', { name: 'Panels' });
const current = () =>
  within(nav())
    .getAllByRole('link')
    .find(a => a.getAttribute('aria-current'));
const themeButton = () => screen.getByRole('button', { name: /^Theme: / });

/** Open the palette with Ctrl+K and click the command whose label matches. */
async function runCommand(label: string) {
  await userEvent.keyboard('{Control>}k{/Control}');
  await userEvent.click(screen.getByRole('option', { name: new RegExp(label) }));
}
const visiblePanel = () => screen.getByRole('region', { name: n => n !== 'Dependencies' });

describe('App shell', () => {
  it('lists every panel by group and opens the panel named in the hash', async () => {
    await renderApp('#/overview');
    for (const group of ['General', 'Inspect', 'Profile', 'Project'])
      expect(within(nav()).getByRole('group', { name: group })).toBeTruthy();
    // Overview and Problems lead, under a heading only screen readers announce.
    const general = within(nav()).getByRole('group', { name: 'General' });
    expect(
      within(general)
        .getAllByRole('link')
        .map(a => a.textContent?.trim()),
    ).toEqual(['Overview', 'Problems']);
    expect(within(general).getByText('General').classList.contains('sr-only')).toBe(true);
    expect(within(nav()).getAllByRole('link')).toHaveLength(14);
    expect(current()?.textContent).toContain('Overview');
    expect(current()?.getAttribute('href')).toBe('#/overview');
    expect(document.title).toBe('Overview · Svelte DevTools');
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Overview'));
    expect(screen.getByRole('button', { name: /Routes/ })).toBeTruthy();
  });

  it('uses a focused shell without tabs for the embedded Overview', async () => {
    await renderApp('#/overview', '?view=overview');
    expect(screen.queryByRole('navigation', { name: 'Panels' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Workflow tools' })).toBeNull();
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Overview'));
    expect(screen.queryByRole('button', { name: /Routes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mounted components/ })).toBeNull();
    expect(screen.getByText('Mounted components')).toBeTruthy();
  });

  it('falls back to Overview for an unknown hash', async () => {
    await renderApp('#/nope');
    expect(current()?.textContent).toContain('Overview');
    expect(document.title).toBe('Overview · Svelte DevTools');
  });

  it('switches panels on hash change and keeps visited panels mounted but hidden', async () => {
    await renderApp('#/overview');
    await screen.findByRole('heading', { name: 'demo-app' });

    navigate('#/modules');
    // A panel shows a loading bar until its module arrives.
    expect(screen.getByLabelText('Loading panel').getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Modules'));
    expect(current()?.textContent).toContain('Modules');
    // Overview stays in the DOM (state kept), hidden.
    expect(screen.queryByRole('heading', { name: 'demo-app' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'demo-app', hidden: true })).toBeTruthy();

    navigate('#/overview');
    expect(screen.getByRole('heading', { name: 'demo-app' })).toBeTruthy();
  });

  it('navigates with the sidebar links', async () => {
    await renderApp('#/overview');
    const link = within(nav()).getByRole('link', { name: 'Assets' });
    // happy-dom follows the fragment link and fires `hashchange`.
    await userEvent.click(link);
    await waitFor(() => expect(current()?.textContent).toContain('Assets'));
    expect(location.hash).toBe('#/assets');
  });

  it('reports a panel that fails to load', async () => {
    await renderApp('#/og');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 4000 });
    expect(within(screen.getByRole('alert')).getByText('Could not load panel')).toBeTruthy();
  });

  it('contains a panel that crashes while rendering and offers a reload', async () => {
    await renderApp('#/fps');
    // Panel modules load lazily: give a loaded machine more than the 1 s default.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 4000 });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Frame rate crashed')).toBeTruthy();
    expect(within(alert).getByText('kaboom')).toBeTruthy();
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload panel' }));
    await settle();
    // Still broken: the boundary catches it again; the rest of the shell keeps working.
    expect(within(screen.getByRole('alert')).getByText('Frame rate crashed')).toBeTruthy();
    navigate('#/overview');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cycles the theme system → light → dark → system and persists overrides', async () => {
    await renderApp();
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: system (click to change)');
    await userEvent.click(themeButton());
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: light (click to change)');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('svelte-devtools-theme')).toBe('light');
    await userEvent.click(themeButton());
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: dark (click to change)');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await userEvent.click(themeButton());
    expect(themeButton().getAttribute('aria-label')).toBe('Theme: system (click to change)');
    expect(localStorage.getItem('svelte-devtools-theme')).toBeNull();
  });

  it('collapses and expands the sidebar, remembering the choice', async () => {
    const { container } = await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(true);
    expect(localStorage.getItem('svelte-devtools:nav')).toBe('"collapsed"');
    // Collapsed links keep their label as a tooltip.
    expect(within(nav()).getByRole('link', { name: 'API' }).getAttribute('title')).toBe('API');
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(false);
  });

  it('shows the dev-server connection status', async () => {
    await renderApp();
    const status = within(nav()).getByRole('status');
    expect(status.textContent).toContain('connected');
    expect(status.getAttribute('title')).toBe('Dev server: connected (standalone)');
    emitConnection({ status: 'connecting', host: 'unknown' });
    flushSync();
    expect(status.getAttribute('title')).toBe('Dev server: connecting');
    emitConnection({ status: 'connected', host: 'vite-devtools' });
    flushSync();
    expect(status.getAttribute('title')).toBe('Dev server: connected (Vite DevTools)');
  });
});

const KIT_ONLY = ['Routes', 'Load functions', 'API', 'Build'];
const labels = () =>
  within(nav())
    .getAllByRole('link')
    .map(a => a.textContent?.trim());
const withoutKit = () => vi.mocked(rpc.getProject).mockResolvedValue({ ...project, kit: false });

/** Hold `getProject` open; returns its resolver. */
function pendingProject() {
  let resolve!: (p: typeof project) => void;
  vi.mocked(rpc.getProject).mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  return resolve;
}

describe('App without SvelteKit', () => {
  it('hides the SvelteKit-only panels from the sidebar and the palette', async () => {
    withoutKit();
    await renderApp();
    expect(within(nav()).getAllByRole('link')).toHaveLength(10);
    for (const label of KIT_ONLY) expect(labels()).not.toContain(label);
    await userEvent.keyboard('{Control>}k{/Control}');
    const options = screen.getAllByRole('option').map(o => o.textContent);
    for (const label of KIT_ONLY) expect(options.some(o => o?.includes(label))).toBe(false);
  });

  it('redirects a link to a SvelteKit-only panel to Overview', async () => {
    withoutKit();
    await renderApp('#/api');
    await waitFor(() => expect(location.hash).toBe('#/overview'));
    expect(current()?.textContent).toContain('Overview');
  });

  it('skips the hidden panels with Alt+↑/↓', async () => {
    withoutKit();
    await renderApp('#/render');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(location.hash).toBe('#/fps');
  });

  it('keeps them hidden until the project is known, then shows them for SvelteKit', async () => {
    const resolve = pendingProject();
    await renderApp();
    expect(within(nav()).getAllByRole('link')).toHaveLength(10);
    resolve(project);
    await waitFor(() => expect(within(nav()).getAllByRole('link')).toHaveLength(14));
  });

  it('never loads a SvelteKit-only panel while the project is unknown', async () => {
    const resolve = pendingProject();
    await renderApp('#/build');
    expect(screen.getByLabelText('Loading panel')).toBeTruthy();
    expect(current()).toBeUndefined();
    resolve({ ...project, kit: false });
    await waitFor(() => expect(location.hash).toBe('#/overview'));
    expect(rpc.getBuildAnalysis).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Build', hidden: true })).toBeNull();
  });

  it('keeps a link to a SvelteKit-only panel in a SvelteKit app', async () => {
    const resolve = pendingProject();
    await renderApp('#/build');
    expect(location.hash).toBe('#/build');
    resolve(project);
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Build'));
    expect(location.hash).toBe('#/build');
    expect(current()?.textContent).toContain('Build');
  });

  it('steps from a panel that is not listed yet with Alt+↑/↓', async () => {
    pendingProject();
    await renderApp('#/build');
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(location.hash).toBe('#/og');
    navigate('#/build');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(location.hash).toBe('#/overview');
  });

  it('checks again after a reconnect (the server may have added SvelteKit)', async () => {
    withoutKit();
    await renderApp();
    expect(within(nav()).getAllByRole('link')).toHaveLength(10);
    vi.mocked(rpc.getProject).mockResolvedValue(project);
    emitConnection({ status: 'disconnected', host: 'standalone' });
    flushSync();
    emitConnection({ status: 'connected', host: 'standalone' });
    await waitFor(() => expect(within(nav()).getAllByRole('link')).toHaveLength(14));
  });

  it('shows every panel when the project lookup fails', async () => {
    vi.mocked(rpc.getProject).mockRejectedValue(new Error('down'));
    await renderApp();
    await waitFor(() => expect(within(nav()).getAllByRole('link')).toHaveLength(14));
  });
});

describe('workflow views', () => {
  it('shows Inspect subpages as horizontal tabs', async () => {
    await renderApp('#/components', '?view=inspect');
    expect(screen.queryByRole('navigation', { name: 'Panels' })).toBeNull();
    const tabs = screen.getByRole('navigation', { name: 'Workflow tools' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map(link => link.textContent?.trim()),
    ).toEqual(['Components', 'Reactivity', 'State timeline']);
    expect(
      within(tabs).getByRole('link', { name: 'Components' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(document.title).toBe('Components · Svelte DevTools');
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Components'));
  });

  it('recombines SvelteKit pages with their workflow tabs', async () => {
    await renderApp('#/loads', '?view=profile');
    const tabs = screen.getByRole('navigation', { name: 'Workflow tools' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map(link => link.textContent?.trim()),
    ).toEqual(['Render', 'Load functions', 'Frame rate', 'Build']);
    expect(
      within(tabs).getByRole('link', { name: 'Load functions' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('opens the first tab of the view for a panel of another workflow', async () => {
    await renderApp('#/routes', '?view=inspect');
    await waitFor(() => expect(location.hash).toBe('#/components'));
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Components'));
  });

  it('leaves another workflow when the project lookup fails too', async () => {
    vi.mocked(rpc.getProject).mockRejectedValue(new Error('down'));
    await renderApp('#/routes', '?view=problems');
    await waitFor(() => expect(location.hash).toBe('#/errors'));
  });

  it('drops the SvelteKit tabs of a view without SvelteKit', async () => {
    withoutKit();
    await renderApp('#/routes', '?view=project');
    await waitFor(() => expect(location.hash).toBe('#/modules'));
    const tabs = screen.getByRole('navigation', { name: 'Workflow tools' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map(link => link.textContent?.trim()),
    ).toEqual(['Modules', 'Assets', 'Social preview']);
  });

  it('is the Overview dock in Vite DevTools, and the full UI in any other frame', async () => {
    const key = '__DEVFRAME_HUB_CLIENT_CONTEXT__';
    (window as unknown as Record<string, unknown>)[key] = { clientType: 'embedded' };
    try {
      await renderApp('#/overview');
      expect(screen.queryByRole('navigation', { name: 'Panels' })).toBeNull();
    } finally {
      delete (window as unknown as Record<string, unknown>)[key];
    }
  });
});

describe('App keyboard shortcuts and command palette', () => {
  it('omits standalone navigation commands from embedded views', async () => {
    await renderApp('#/overview', '?view=overview');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('option', { name: /sidebar/ })).toBeNull();
  });

  it('toggles the palette with ⌘K / Ctrl+K and from the Search button', async () => {
    await renderApp();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    await userEvent.keyboard('{Meta>}K{/Meta}');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^Search/ }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('goes to a panel from the palette', async () => {
    await renderApp();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.keyboard('timeline');
    expect(screen.getAllByRole('option')[0]!.textContent).toContain('State timeline');
    await userEvent.keyboard('{Enter}');
    expect(location.hash).toBe('#/timeline');
    expect(current()?.textContent).toContain('State timeline');
  });

  it('runs preference commands from the palette', async () => {
    const { container } = await renderApp();
    await runCommand('Theme: dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await runCommand('Theme: light');
    expect(document.documentElement.dataset.theme).toBe('light');
    await runCommand('Theme: follow system');
    expect(localStorage.getItem('svelte-devtools-theme')).toBeNull();
    await runCommand('Collapse sidebar');
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(true);
    await runCommand('Expand sidebar');
    expect(container.querySelector('.app')!.classList.contains('collapsed')).toBe(false);
  });

  it('steps through panels with Alt+↑/↓, wrapping around', async () => {
    await renderApp('#/overview');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(location.hash).toBe('#/errors');
    await userEvent.keyboard('{Alt>}{ArrowUp}{ArrowUp}{/Alt}');
    expect(location.hash).toBe('#/og');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(location.hash).toBe('#/overview');
  });

  it('focuses the visible panel search with "/", but not while typing', async () => {
    await renderApp('#/overview');
    const search = await screen.findByRole('searchbox');
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(search);
    // Inside an input "/" is just a character.
    await userEvent.keyboard('/');
    expect((search as HTMLInputElement).value).toBe('/');

    search.blur();
    // While the palette is open, shortcuts other than ⌘K are left to it.
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(location.hash).toBe('#/overview');
  });

  it('ignores "/" on a panel without a search field', async () => {
    await renderApp('#/fps');
    await screen.findByRole('alert');
    document.body.focus();
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('element picks', () => {
  it('leaves an incompatible embedded workflow for the host to switch', async () => {
    await renderApp('#/overview', '?view=overview');
    emitPick({ epoch: 'e1', componentId: 2 });
    flushSync();
    expect(elementPick.pending).toBeNull();
    expect(screen.queryByRole('region', { name: 'Components', hidden: true })).toBeNull();
  });

  it('a pick in the Inspect dock opens Components with the pick pending', async () => {
    await renderApp('#/reactive', '?view=inspect');
    const pick = { epoch: 'e1', componentId: 2 };
    emitPick(pick);
    flushSync();
    expect(location.hash).toBe('#/components');
    expect(elementPick.pending).toBe(pick);
    elementPick.done(pick);
  });

  it('a pick on the app page opens Components with the pick pending', async () => {
    const view = await renderApp('#/build');
    const pick = { epoch: 'e1', componentId: 2 };
    emitPick(pick);
    flushSync();
    expect(location.hash).toBe('#/components');
    expect(current()?.textContent).toContain('Components');
    await waitFor(() => expect(visiblePanel().getAttribute('aria-label')).toBe('Components'));
    // (no live instance #2 here: the pick stays pending)
    expect(elementPick.pending).toBe(pick);
    elementPick.done(pick);
    view.unmount();
    emitPick(pick);
    expect(elementPick.pending).toBeNull();
  });
});
