import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { elementPick } from '../lib/element-pick.svelte.js';
import { reactiveScope } from '../lib/reactive-scope.svelte.js';
import { router } from '../lib/router.svelte.js';
import * as rpc from '../lib/rpc.js';
import type { ComponentInstance, ComponentRelation, LiveComponentsMeta } from '../lib/types.js';
import { fakePollClock, layout, nextPoll, settle } from '../test/dom.js';
import Components from './Components.svelte';

const c = (
  id: number,
  name: string,
  parentId: number | null,
  file = `/app/src/lib/${name}.svelte`,
  mounted = true,
): ComponentInstance => ({ id, name, parentId, file, mounted });

// App > Layout > Page > (Row, Row). Live files are absolute module ids;
// relation files are relative to the project root (`meta().root`).
const instances: ComponentInstance[] = [
  c(1, 'App', null, '/app/src/App.svelte'),
  c(2, 'Layout', 1, '/app/src/routes/+layout.svelte'),
  c(3, 'Page', 2, '/app/src/routes/+page.svelte'),
  c(4, 'Row', 3),
  c(5, 'Row', 3),
];

const relations: ComponentRelation[] = [
  {
    file: 'src/routes/+page.svelte',
    name: 'Page',
    imports: ['src/lib/Row.svelte', 'src/lib/Icon.svelte'],
  },
  { file: 'src/lib/Row.svelte', name: 'Row', imports: [] },
  { file: 'src/App.svelte', name: 'App', imports: ['src/routes/+page.svelte'] },
];

const meta = (over: Partial<LiveComponentsMeta> = {}): LiveComponentsMeta => ({
  total: 5,
  kept: 5,
  truncated: false,
  files: 3,
  root: '/app',
  epoch: 'e1',
  epochs: 1,
  ...over,
});

const tree = () => screen.getByRole('tree', { name: 'Mounted component tree' });
const items = () => within(tree()).queryAllByRole('treeitem');
const labels = () => items().map(r => r.querySelector('.tag')?.textContent?.trim());
const row = (name: string, n = 0) =>
  items().filter(r => r.querySelector('.tag')?.textContent?.trim() === `<${name}>`)[n]!;

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }));
  vi.mocked(rpc.getLiveComponents).mockResolvedValue(instances);
  vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue(meta());
  vi.mocked(rpc.getComponentRelations).mockResolvedValue(relations);
  reactiveScope.set(null);
});

const relationCalls = () => vi.mocked(rpc.getComponentRelations).mock.calls.length;

describe('Components: live tree', () => {
  it('renders the mounted tree with the first levels open and ARIA tree attributes', async () => {
    render(Components);
    await settle();
    expect(labels()).toEqual(['<App>', '<Layout>', '<Page>', '<Row>', '<Row>']);
    const page = row('Page');
    expect(page.getAttribute('aria-level')).toBe('3');
    expect(page.getAttribute('aria-expanded')).toBe('true');
    const second = row('Row', 1);
    expect(second.getAttribute('aria-level')).toBe('4');
    expect(second.getAttribute('aria-posinset')).toBe('2');
    expect(second.getAttribute('aria-setsize')).toBe('2');
    expect(second.hasAttribute('aria-expanded')).toBe(false);
  });

  it('collapses and expands all', async () => {
    render(Components);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(labels()).toEqual(['<App>']);
    // Collapsed branches show their child count.
    expect(row('App').querySelector('.kids')?.textContent).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(labels()).toHaveLength(5);
  });

  it('navigates with the keyboard: ← collapses, → expands', async () => {
    render(Components);
    await settle();
    tree().focus();
    await userEvent.keyboard('{ArrowDown}'); // select App
    expect(row('App').getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(labels()).toEqual(['<App>']);
    await userEvent.keyboard('{ArrowRight}');
    expect(labels()).toContain('<Layout>');
  });

  it('analyzes components once a row is selected, not again per row', async () => {
    render(Components);
    await settle();
    expect(relationCalls()).toBe(0);
    tree().focus();
    await userEvent.keyboard('{ArrowDown}');
    await settle();
    expect(relationCalls()).toBe(1);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await settle();
    await userEvent.click(row('Page'));
    await settle();
    expect(relationCalls()).toBe(1);
    // HMR edits do not re-run the analysis, so the tree details pane offers Re-analyze.
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));
    await settle();
    expect(relationCalls()).toBe(2);
    // Entering Files still loads fresh relations.
    await userEvent.click(screen.getByRole('radio', { name: 'Files' }));
    await settle();
    expect(relationCalls()).toBe(3);
  });

  it('filters instances by name or file', async () => {
    render(Components);
    await settle();
    const search = screen.getByRole('searchbox', { name: 'Filter' });
    expect(search.getAttribute('placeholder')).toBe('Filter instances…');
    await userEvent.type(search, 'Row');
    // Ancestors of matches stay as context.
    expect(labels()).toContain('<Row>');
    expect(screen.getByText('2', { selector: '.hits' })).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.type(search, 'nothing-like-this');
    expect(screen.getByText('No instances match “nothing-like-this”')).toBeTruthy();
  });

  it('inspects an instance: ancestors, children, imports, editor and reactivity', async () => {
    render(Components);
    await settle();
    await userEvent.click(row('Page'));
    await settle();
    const aside = screen.getByRole('complementary', { name: '<Page> details' });
    expect(within(aside).getByText('mounted')).toBeTruthy();
    expect(within(aside).getByText('#3')).toBeTruthy();
    expect(within(aside).getByRole('button', { name: 'App' })).toBeTruthy();
    expect(within(aside).getByRole('button', { name: 'Layout' })).toBeTruthy();
    // Children and static imports (relations load once something is selected).
    expect(within(aside).getAllByRole('button', { name: /^Row\s*#\d$/ })).toHaveLength(2);
    expect(within(aside).getByRole('button', { name: /^Icon/ })).toBeTruthy();

    await userEvent.click(within(aside).getByRole('button', { name: /^Icon/ }));
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/lib/Icon.svelte');
    await userEvent.click(within(aside).getByRole('button', { name: 'Open in editor' }));
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('/app/src/routes/+page.svelte');

    await userEvent.click(within(aside).getByRole('button', { name: 'Layout' }));
    await settle();
    expect(row('Layout').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: '<Layout> details' })).toBeTruthy();
  });

  it('reveals a child from the details pane', async () => {
    render(Components);
    await settle();
    await userEvent.click(row('Page'));
    await userEvent.click(screen.getAllByRole('button', { name: /^Row\s*#5$/ })[0]!);
    await settle();
    expect(row('Row', 1).getAttribute('aria-selected')).toBe('true');
  });

  it('"Show reactivity" scopes the Reactivity panel to the instance and navigates there', async () => {
    render(Components);
    await settle();
    await userEvent.click(row('Row'));
    await userEvent.click(screen.getByRole('button', { name: 'Show reactivity' }));
    expect(reactiveScope.current).toEqual({
      componentId: 4,
      epoch: 'e1',
      label: '<Row>',
      file: '/app/src/lib/Row.svelte',
    });
    expect(router.current).toBe('reactive');
    expect(location.hash).toBe('#/reactive');
    router.go('components');
  });

  it('waits for a consistent snapshot when the page load changed mid-read', async () => {
    vi.mocked(rpc.getLiveComponentsMeta)
      .mockResolvedValueOnce(meta({ epoch: 'e1' }))
      .mockResolvedValueOnce(meta({ epoch: 'e2' }))
      // The refetch that follows sees a settled page load.
      .mockResolvedValue(meta({ epoch: 'e2' }));
    render(Components);
    await settle();
    // The flipped snapshot is refetched right away.
    expect(vi.mocked(rpc.getLiveComponents).mock.calls.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(row('Row'));
    expect(screen.getByRole('button', { name: 'Show reactivity' })).toBeTruthy();
  });

  it('keeps the selection on the same instance when a sibling unmounts', async () => {
    fakePollClock();
    render(Components);
    await settle();
    await userEvent.click(row('Row', 1)); // #5
    expect(screen.getByRole('complementary', { name: '<Row> details' }).textContent).toContain(
      '#5',
    );
    // #4 goes away: #5 becomes the first <Row>, its path key shifts.
    vi.mocked(rpc.getLiveComponents).mockResolvedValue(instances.filter(i => i.id !== 4));
    await nextPoll(2000);
    expect(labels()).toEqual(['<App>', '<Layout>', '<Page>', '<Row>']);
    expect(row('Row').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: '<Row> details' }).textContent).toContain(
      '#5',
    );
  });

  it('Enter opens the selected instance in the editor', async () => {
    render(Components);
    await settle();
    tree().focus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(rpc.openInEditor).toHaveBeenCalledWith('/app/src/App.svelte');
  });

  it('"N mounted instances" jumps to the file in Files mode', async () => {
    render(Components);
    await settle();
    await userEvent.click(row('Row'));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: '2 mounted instances' }));
    await settle();
    expect(screen.getByRole('radio', { name: 'Files' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Row details' })).toBeTruthy();
  });

  it('shows unmounted instances and detached subtrees', async () => {
    vi.mocked(rpc.getLiveComponents).mockResolvedValue([
      c(1, 'App', null, '/app/src/App.svelte', false),
      c(7, 'Orphan', 99),
    ]);
    vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue(
      meta({ total: 10, kept: 2, truncated: true }),
    );
    render(Components);
    await settle();
    expect(row('App').querySelector('.tag.dim')).toBeTruthy();
    expect(within(row('Orphan')).getByText('detached')).toBeTruthy();
    const notice = String(
      screen.getAllByRole('status').find(s => s.textContent?.includes('Showing'))?.textContent,
    );
    expect(notice).toMatch(/Showing\s+parents first\s+2\s+of\s+10/);
    expect(notice).toContain('detached');
    await userEvent.click(row('App'));
    const aside = screen.getByRole('complementary', { name: '<App> details' });
    expect(within(aside).getByText('unmounted')).toBeTruthy();
    // Only mounted instances can scope Reactivity.
    expect(within(aside).queryByRole('button', { name: /Show reactivity/ })).toBeNull();
    expect(within(aside).getByRole('button', { name: '1 mounted instance' })).toBeTruthy();
  });

  it('shows an empty state with a way to the files view', async () => {
    vi.mocked(rpc.getLiveComponents).mockResolvedValue([]);
    render(Components);
    await settle();
    expect(screen.getByText('No mounted components')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Browse component files instead' }));
    await settle();
    expect(screen.getByRole('listbox', { name: 'Component files' })).toBeTruthy();
  });

  it('shows a read error', async () => {
    vi.mocked(rpc.getLiveComponents).mockRejectedValue(new Error('app gone'));
    render(Components);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('app gone');
  });
});

async function files() {
  render(Components);
  await settle();
  await userEvent.click(screen.getByRole('radio', { name: 'Files' }));
  await settle();
}
const table = () => screen.getByRole('listbox', { name: 'Component files' });
const names = () =>
  within(table())
    .queryAllByRole('option')
    .map(o => o.querySelector('.cname')?.textContent);

describe('Components: files', () => {
  it('lists component files sorted by name, with import / user / mounted counts', async () => {
    await files();
    expect(names()).toEqual(['App', 'Page', 'Row']);
    const rowEl = within(table()).getAllByRole('option')[2]!;
    const cells = [...rowEl.querySelectorAll('.end')].map(e => e.textContent);
    // Row: no imports, used by Page, 2 mounted.
    expect(cells).toEqual(['', '1', '2']);
    // Persisted across reloads.
    expect(localStorage.getItem('svelte-devtools:components:mode')).toBe('"files"');
  });

  it('counts only live files under the root, whose spelling may end with a slash', async () => {
    vi.mocked(rpc.getLiveComponents).mockResolvedValue([
      c(1, 'App', null, '/app/src/App.svelte'),
      c(2, 'Row', 1, '/elsewhere/src/lib/Row.svelte'),
    ]);
    vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue(meta({ root: '/app/' }));
    await files();
    const mounted = within(table())
      .getAllByRole('option')
      .map(o => o.querySelectorAll('.end')[2]?.textContent);
    // App, Page, Row
    expect(mounted).toEqual(['1', '–', '–']);
  });

  it('sorts by a column', async () => {
    await files();
    const imports = screen.getByRole('columnheader', { name: 'Imports' });
    await userEvent.click(within(imports).getByRole('button'));
    expect(imports.getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Page', 'App', 'Row']);
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: 'Used by' })).getByRole('button'),
    );
    expect(names()[2]).toBe('App');
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: 'Mounted' })).getByRole('button'),
    );
    expect(names()[0]).toBe('Row');
  });

  it('filters files', async () => {
    await files();
    const search = screen.getByRole('searchbox', { name: 'Filter' });
    expect(search.getAttribute('placeholder')).toBe('Filter components…');
    await userEvent.type(search, 'routes');
    expect(names()).toEqual(['Page']);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No components match “routeszzz”')).toBeTruthy();
  });

  it('inspects a file: imports, users, navigation, editor and "Show in tree"', async () => {
    await files();
    await userEvent.click(within(table()).getAllByRole('option')[1]!); // Page
    let aside = screen.getByRole('complementary', { name: 'Page details' });
    expect(within(aside).getByText('Imports')).toBeTruthy();
    // Icon is not an analysed component: open it in the editor.
    await userEvent.click(within(aside).getByRole('button', { name: /^Icon/ }));
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/lib/Icon.svelte');
    // Used by App → select App.
    await userEvent.click(within(aside).getByRole('button', { name: /^App/ }));
    aside = screen.getByRole('complementary', { name: 'App details' });
    expect(within(aside).getByText('Not imported by any component (route or entry).')).toBeTruthy();
    // An import that is a component selects it.
    await userEvent.click(within(aside).getByRole('button', { name: /^\+page/ }));
    await userEvent.click(
      within(screen.getByRole('complementary', { name: 'Page details' })).getByRole('button', {
        name: /^Row/,
      }),
    );
    aside = screen.getByRole('complementary', { name: 'Row details' });
    expect(within(aside).getByText('Imports no other components.')).toBeTruthy();
    await userEvent.click(within(aside).getByRole('button', { name: 'Open in editor' }));
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/lib/Row.svelte');

    await userEvent.click(within(aside).getByRole('button', { name: 'Show in tree' }));
    await settle();
    expect(screen.getByRole('radio', { name: 'Live tree' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(row('Row').getAttribute('aria-selected')).toBe('true');
  });

  it('Enter opens the selected file; close clears the selection', async () => {
    await files();
    table().focus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('src/App.svelte');
    await userEvent.click(screen.getByRole('button', { name: 'Close details (Esc)' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('re-analyzes on demand', async () => {
    await files();
    const before = relationCalls();
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));
    await settle();
    expect(relationCalls()).toBe(before + 1);
  });

  it('shows analysis errors and the no-files state', async () => {
    vi.mocked(rpc.getComponentRelations).mockRejectedValueOnce(new Error('parse failed'));
    await files();
    expect(screen.getByRole('alert').textContent).toContain('parse failed');
    vi.mocked(rpc.getComponentRelations).mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));
    await settle();
    expect(screen.getByText('No .svelte files found')).toBeTruthy();
  });
});

const pickOf = (componentId: number, epoch = 'e1') => ({
  epoch,
  componentId,
});
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  Object.defineProperty(document, 'hidden', { configurable: true, value: state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('Components: element picked on the app page', () => {
  it('selects and reveals the instance: ancestors expanded, filter cleared, details open', async () => {
    render(Components);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter' }), 'Layout');
    expect(labels()).not.toContain('<Row>');
    const pick = pickOf(5);
    elementPick.set(pick);
    await settle();
    expect(row('Row', 1).getAttribute('aria-selected')).toBe('true');
    expect(labels()).toEqual(['<App>', '<Layout>', '<Page>', '<Row>', '<Row>']);
    expect(screen.getByRole('complementary', { name: '<Row> details' }).textContent).toContain(
      '#5',
    );
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Filter' }).value).toBe('');
    expect(elementPick.pending).toBeNull();
  });

  it('switches from Files to the live tree', async () => {
    render(Components);
    await settle();
    await userEvent.click(screen.getByRole('radio', { name: 'Files' }));
    elementPick.set(pickOf(3));
    await settle();
    expect(row('Page').getAttribute('aria-selected')).toBe('true');
  });

  it('a pick of an instance not in the snapshot yet refetches the tree once', async () => {
    render(Components);
    await settle();
    const calls = vi.mocked(rpc.getLiveComponents).mock.calls.length;
    vi.mocked(rpc.getLiveComponents).mockResolvedValue([...instances, c(6, 'Cell', 4)]);
    elementPick.set(pickOf(6));
    await settle();
    expect(vi.mocked(rpc.getLiveComponents).mock.calls.length).toBe(calls + 1);
    expect(row('Cell').getAttribute('aria-selected')).toBe('true');
  });

  it("waits for the pick's page load before matching ids", async () => {
    fakePollClock();
    render(Components);
    await settle();
    const pick = pickOf(4, 'e2');
    elementPick.set(pick);
    await settle();
    expect(items().some(r => r.getAttribute('aria-selected') === 'true')).toBe(false);
    expect(elementPick.pending).toBe(pick);
    // the server now serves the picked tab
    vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue(meta({ epoch: 'e2' }));
    await nextPoll(2000);
    expect(row('Row').getAttribute('aria-selected')).toBe('true');
  });

  it('a tab that is hidden when the pick arrives reveals it once visible', async () => {
    render(Components);
    await settle();
    setVisibility('hidden');
    try {
      elementPick.set(pickOf(4));
      await settle();
      expect(elementPick.pending).not.toBeNull();
      expect(row('Row').getAttribute('aria-selected')).not.toBe('true');
    } finally {
      setVisibility('visible');
    }
    await settle();
    expect(row('Row').getAttribute('aria-selected')).toBe('true');
  });
});

// The Vite DevTools hub's client context, which the docked UI finds on its parent window.
const KEY = '__DEVFRAME_HUB_CLIENT_CONTEXT__';
const setHub = (ctx: unknown) => {
  (window as unknown as Record<string, unknown>)[KEY] = ctx;
};
const hub = (setActionActive = vi.fn(() => Promise.resolve(true))) => ({
  clientType: 'embedded',
  docks: { entries: [{ id: 'svelte:inspector' }], setActionActive },
});

describe('Components: Pick element', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[KEY];
  });

  it.each([
    ['outside the Vite DevTools dock', undefined],
    ['in a dock without the inspector', { ...hub(), docks: { entries: [] } }],
    ['in the standalone Vite DevTools page', { ...hub(), clientType: 'standalone' }],
  ])('is not shown %s', async (_, ctx) => {
    setHub(ctx);
    render(Components);
    await settle();
    expect(screen.queryByRole('button', { name: 'Pick element' })).toBeNull();
  });

  it("turns the inspector's dock action on (not a toggle); a failure shows in its tooltip", async () => {
    const setActionActive = vi.fn(() => Promise.resolve(true));
    setHub(hub(setActionActive));
    render(Components);
    await settle();
    const button = screen.getByRole('button', { name: 'Pick element' });
    await userEvent.click(button);
    expect(setActionActive).toHaveBeenCalledExactlyOnceWith('svelte:inspector', true);
    setActionActive.mockRejectedValueOnce(new Error('not trusted'));
    await userEvent.click(button);
    await settle();
    expect(setActionActive).toHaveBeenCalledTimes(2);
    expect(button.getAttribute('title')).toBe('not trusted');
  });
});
