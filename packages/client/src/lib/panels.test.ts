import { describe, expect, it, vi } from 'vitest';

// Panels import the RPC layer (feature-detected functions included) and the
// router, which reads the hash on load; nothing is called while loading.
vi.mock('./rpc.js', () => ({ getCaptureInfo: vi.fn(), getVersions: vi.fn() }));
vi.stubGlobal('location', { hash: '' });

const { groupLabels, panelById, panels, panelsForView, requestedPanelView, visiblePanels } =
  await import('./panels.js');
const { icons } = await import('./icons.js');

const KIT_ONLY = new Set(['routes', 'loads', 'build', 'api']);
const DOCK_ONLY = new Set(['addons']);
const visibleIds = (kit?: boolean, docked = true) => visiblePanels(kit, docked).map(p => p.id);

describe('panel registry', () => {
  it('has unique ids, known icons and known groups', () => {
    const ids = panels.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of panels) {
      expect(icons).toHaveProperty(p.icon);
      expect(groupLabels).toHaveProperty(p.group);
      expect(p.label.trim()).not.toBe('');
      expect(p.description.trim()).not.toBe('');
    }
  });

  it('lists the panels of one group together (navigation renders them in order)', () => {
    const groups = panels.map(p => p.group);
    const firstSeen = [...new Set(groups)];
    expect(groups).toEqual(firstSeen.flatMap(g => groups.filter(x => x === g)));
  });

  it('offers the SvelteKit-only panels only when the app uses SvelteKit', () => {
    expect(visibleIds(true)).toEqual(panels.map(p => p.id));
    expect(visibleIds(false)).toEqual(panels.map(p => p.id).filter(id => !KIT_ONLY.has(id)));
    expect(visibleIds()).toEqual(visibleIds(false)); // unknown yet
  });

  it('groups panels by workflow, including SvelteKit tools', () => {
    expect(panelsForView(true, 'overview').map(p => p.id)).toEqual(['overview']);
    expect(panelsForView(true, 'problems').map(p => p.id)).toEqual(['errors']);
    expect(panelsForView(true, 'inspect').map(p => p.id)).toEqual([
      'components',
      'reactive',
      'timeline',
    ]);
    expect(panelsForView(true, 'profile').map(p => p.id)).toEqual([
      'performance',
      'loads',
      'fps',
      'build',
    ]);
    expect(panelsForView(true, 'project').map(p => p.id)).toEqual([
      'routes',
      'api',
      'modules',
      'assets',
      'og',
    ]);
    expect(panelsForView(false, 'profile').map(p => p.id)).toEqual(['performance', 'fps']);
    expect(panelsForView(false, 'project').map(p => p.id)).toEqual(['modules', 'assets', 'og']);
    expect(panelsForView(true, 'add', true).map(p => p.id)).toEqual(['addons']);
    expect(panelsForView(true, 'add', false)).toEqual([]);
  });

  it('uses workflow views in the dock and keeps every panel in standalone mode', () => {
    expect(requestedPanelView('?view=inspect', false)).toBe('inspect');
    expect(requestedPanelView('?view=profile', false)).toBe('profile');
    expect(requestedPanelView('?view=unknown', false)).toBeNull();
    expect(requestedPanelView('', true)).toBe('overview');
    expect(requestedPanelView('', false)).toBeNull();
    expect(requestedPanelView('?view=nope', true)).toBe('overview');
    for (const key of ['constructor', '__proto__', 'toString'])
      expect(requestedPanelView(`?view=${key}`, false)).toBeNull();
    expect(panelsForView(true, null)).toEqual(visiblePanels(true));
  });

  it('offers the dock-only panels only inside the Vite DevTools dock', () => {
    expect(visibleIds(true, false)).toEqual(panels.map(p => p.id).filter(id => !DOCK_ONLY.has(id)));
    expect(visiblePanels(true).map(p => p.id)).toEqual(visibleIds(true, false));
  });

  it.each(panels.map(p => p.id))('panelById(%j) finds it', id => {
    expect(panelById(id).id).toBe(id);
  });

  it.each(['', 'nope', 'OVERVIEW', 'overview/', '__proto__', 'constructor'])(
    'panelById(%j) falls back to the first panel (overview)',
    id => {
      expect(panelById(id)).toBe(panels[0]);
      expect(panels[0].id).toBe('overview');
    },
  );

  // Compiles and evaluates every panel (and the components it imports) once:
  // slow under coverage instrumentation, hence the timeout.
  it('every panel module loads a component', { timeout: 60_000 }, async () => {
    const mods = await Promise.all(panels.map(async p => [p.id, typeof (await p.load()).default]));
    expect(Object.fromEntries(mods)).toEqual(
      Object.fromEntries(panels.map(p => [p.id, 'function'])),
    );
  });
});
