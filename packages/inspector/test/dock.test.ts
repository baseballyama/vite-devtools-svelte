import process from 'node:process';

import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { svelteInspector } from '../src/index.js';
import { defaultInspectorOptions } from '../src/options.js';
import type { ActionResult, Settings } from '../src/runtime/settings-shared.js';
import { same } from '../src/runtime/settings-shared.js';
import { mergeOptions, pickOptions, updateSaved, validateSettings } from '../src/settings.js';
import type { InspectorOptions } from '../src/types.js';

const defaults = defaultInspectorOptions as Settings;

// inspector variables set in the shell would otherwise change the options
beforeEach(() => {
  vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '');
  vi.stubEnv('SVELTE_INSPECTOR_TOGGLE', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Handler = (...args: unknown[]) => unknown;

/** Invoke a plugin hook declared as a function or as `{ handler }` */
const call = (hook: Plugin[keyof Plugin], ...args: unknown[]) =>
  (typeof hook === 'function' ? (hook as Handler) : (hook as { handler: Handler }).handler)(
    ...args,
  );

function setup(options?: InspectorOptions) {
  const plugin = svelteInspector(options);
  call(plugin.configResolved, {
    mode: 'development',
    root: process.cwd(),
    envDir: false,
    base: '/',
    plugins: [{ name: 'vite:devtools' }],
    logger: { warn() {}, error() {} },
  });
  return plugin;
}

interface DockEntry {
  id: string;
  type: string;
  groupId?: string;
  icon: string;
  toggle?: boolean;
  action?: { importFrom: string };
  renderer?: { importFrom: string };
}

/**
 * a fake vite devtools node context that records docks and rpc functions; `saved` stands in
 * for the per-user settings file, shared by every plugin set up with it
 */
function fakeDevtools(saved = new Map<string, unknown>(), { hmr = true } = {}) {
  const docks: DockEntry[] = [];
  const actions = new Map<string, (params?: unknown) => Promise<ActionResult>>();
  const optionsModule = { id: 'virtual:vite-devtools-svelte-inspector-options' };
  const client = {
    moduleGraph: {
      getModuleById: vi.fn((id: string) => (id === optionsModule.id ? optionsModule : undefined)),
      invalidateModule: vi.fn(),
    },
    hot: { send: vi.fn() },
  };
  const scope = vi.fn((_namespace: string) => ({
    settings: {
      global: {
        get: (key: string) => Promise.resolve(structuredClone(saved.get(key))),
        set: (key: string, value: unknown) => {
          saved.set(key, structuredClone(value));
          return Promise.resolve();
        },
        delete: (key: string) => {
          saved.delete(key);
          return Promise.resolve();
        },
      },
    },
  }));
  const ctx = {
    docks: {
      register: vi.fn((entry: Record<string, unknown>) =>
        docks.push(entry as unknown as DockEntry),
      ),
    },
    rpc: {
      register: (fn: {
        name: string;
        setup: () => { handler: (params?: unknown) => Promise<ActionResult> };
      }) => actions.set(fn.name, fn.setup().handler),
    },
    scope,
    viteServer: { config: { server: { hmr } }, environments: { client } },
  };
  const run = async (name: 'save' | 'reset', params?: unknown) => {
    const handler = actions.get(`svelte:inspector:${name}-settings`);
    if (!handler) throw new Error(`no ${name} action`);
    return handler(params);
  };
  return { ctx, docks, saved, client, scope, run };
}

/** a plugin set up in a fake Vite DevTools */
function setupInDock(options?: InspectorOptions, saved?: Map<string, unknown>) {
  const plugin = setup(options);
  const devtools = fakeDevtools(saved);
  plugin.devtools.setup(devtools.ctx as never);
  return { plugin, ...devtools };
}

async function servedOptions(plugin: Plugin) {
  const code = String(await call(plugin.load, 'virtual:vite-devtools-svelte-inspector-options'));
  return JSON.parse(code.slice('export default '.length));
}

/** what the settings view sends */
const form = (options: Record<string, unknown>) => {
  const { __internal: _, ...rest } = structuredClone(options);
  return rest;
};

const withDefaults = (patch: Record<string, unknown>) => ({
  ...structuredClone(defaultInspectorOptions),
  ...patch,
});

describe('the dock', () => {
  it('holds the inspector, which is never injected into the page', () => {
    const { plugin, docks } = setupInDock();
    expect(plugin.transform).toBeUndefined();
    expect(docks.map(d => [d.id, d.type, d.groupId])).toEqual([
      ['svelte', 'group', undefined],
      ['svelte:inspector', 'action', undefined],
      ['svelte:inspector-settings', 'custom-render', 'svelte'],
    ]);
    const [, inspector, settings] = docks;
    expect(inspector?.toggle).toBe(true);
    expect(inspector?.action?.importFrom).toBe(
      '/@id/__x00__virtual:vite-devtools-svelte-inspector-dock',
    );
    expect(Buffer.from(String(inspector?.icon.split(',')[1]), 'base64').toString()).toContain(
      'svelte-inspector-logo',
    );
    expect(Buffer.from(String(settings?.icon.split(',')[1]), 'base64').toString()).toContain(
      'svelte-inspector-settings',
    );
    expect(settings?.renderer?.importFrom).toBe(
      '/@id/__x00__virtual:vite-devtools-svelte-inspector-settings',
    );
  });

  it('serves the dock and settings client scripts', async () => {
    const plugin = setup();
    const dock = call(plugin.resolveId, 'virtual:vite-devtools-svelte-inspector-dock');
    expect(await call(plugin.load, dock)).toContain('devtools-action.ts');
    const settings = call(plugin.resolveId, 'virtual:vite-devtools-svelte-inspector-settings');
    expect(await call(plugin.load, settings)).toContain('settings-view.ts');
  });

  it('keeps a Svelte group another plugin registered first', () => {
    const plugin = setup();
    const { ctx, docks } = fakeDevtools();
    // the group is registered first and that registration fails
    ctx.docks.register.mockImplementationOnce(() => {
      throw new Error('Dock with id "svelte" is already registered');
    });
    plugin.devtools.setup(ctx as never);
    expect(docks.map(d => d.id)).toEqual(['svelte:inspector', 'svelte:inspector-settings']);
  });
});

describe('settings view', () => {
  it('saves the options that differ from the plugin options in the per-user settings', async () => {
    const { plugin, saved, client, scope, run } = setupInDock({ toggleKeyCombo: 'control-i' });
    expect(scope).toHaveBeenCalledWith('svelte-inspector');
    const current = await servedOptions(plugin);
    expect(current.toggleKeyCombo).toBe('control-i');
    expect(current.__internal.defaults).toEqual({ ...defaults, toggleKeyCombo: 'control-i' });

    const result = await run('save', { ...form(current), holdMode: false, escapeKeys: ['Escape'] });
    expect(result).toEqual({ ok: true, status: 'Saved. Reloading…' });
    expect(saved.get('options')).toEqual({ holdMode: false, escapeKeys: ['Escape'] });
    expect(await servedOptions(plugin)).toMatchObject({
      toggleKeyCombo: 'control-i',
      holdMode: false,
      escapeKeys: ['Escape'],
    });
    // the next page load gets the new options
    expect(client.moduleGraph.invalidateModule).toHaveBeenCalledOnce();
    expect(client.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });

    expect(await run('reset')).toEqual({ ok: true, status: 'Reset to defaults. Reloading…' });
    expect(saved.has('options')).toBe(false);
    expect((await servedOptions(plugin)).holdMode).toBe(true);
  });

  it('serves the saved settings in every project', async () => {
    const saved = new Map<string, unknown>();
    const first = setupInDock(undefined, saved);
    await first.run('save', { ...form(await servedOptions(first.plugin)), openKey: 'o' });
    const other = setupInDock({ holdMode: false }, saved);
    expect(await servedOptions(other.plugin)).toMatchObject({ openKey: 'o', holdMode: false });
  });

  it('keeps what another project saved when its defaults differ', async () => {
    const saved = new Map<string, unknown>();
    // in a project whose default shortcut is control-i, the user saves alt-x
    const b = setupInDock({ toggleKeyCombo: 'control-i' }, saved);
    await b.run('save', { ...form(await servedOptions(b.plugin)), toggleKeyCombo: 'alt-x' });
    expect(saved.get('options')).toEqual({ toggleKeyCombo: 'alt-x' });

    // in a project whose default is alt-x, the user changes only the open key
    const a = setupInDock(undefined, saved);
    await a.run('save', { ...form(await servedOptions(a.plugin)), openKey: 'o' });
    expect(saved.get('options')).toEqual({ toggleKeyCombo: 'alt-x', openKey: 'o' });
    expect(
      (await servedOptions(setupInDock({ toggleKeyCombo: 'control-i' }, saved).plugin))
        .toggleKeyCombo,
    ).toBe('alt-x');
  });

  it('serves the defaults when the saved settings cannot be read', async () => {
    const { plugin, ctx } = setupInDock();
    ctx.scope.mockReturnValue({
      settings: {
        global: {
          get: () => Promise.reject(new Error('EACCES')),
          set: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
      },
    });
    plugin.devtools.setup(ctx as never);
    expect((await servedOptions(plugin)).openKey).toBe('Enter');
  });

  it('reports invalid input instead of saving', async () => {
    const { plugin, saved, run } = setupInDock();
    const result = await run('save', { ...form(await servedOptions(plugin)), openKey: '  ' });
    expect(result).toEqual({ ok: false, status: 'Open in editor needs a key' });
    expect(saved.size).toBe(0);
  });

  it('removes the saved settings when they match the defaults', async () => {
    const saved = new Map<string, unknown>([['options', { openKey: 'o' }]]);
    const { plugin, run } = setupInDock(undefined, saved);
    const result = await run('save', form({ ...(await servedOptions(plugin)), openKey: 'Enter' }));
    expect(result.status).toBe('Same as the defaults, nothing to save. Reloading…');
    expect(saved.has('options')).toBe(false);
  });

  it('asks for a reload when Vite does not reload the page', async () => {
    const plugin = setup();
    const { ctx, run } = fakeDevtools(new Map(), { hmr: false });
    plugin.devtools.setup(ctx as never);
    expect((await run('reset')).status).toBe('Reset to defaults. Reload the page to apply.');
  });

  it('reports settings that cannot be saved', async () => {
    const { plugin, ctx, run } = setupInDock();
    const store = ctx.scope('svelte-inspector').settings.global;
    ctx.scope.mockReturnValue({
      settings: {
        global: {
          ...store,
          set: () => Promise.reject(new Error('EACCES')),
        },
      },
    });
    plugin.devtools.setup(ctx as never);
    const result = await run('save', { ...form(await servedOptions(plugin)), openKey: 'o' });
    expect(result).toEqual({ ok: false, status: "Couldn't save: EACCES" });
  });

  it('keeps vite-plugin-svelte variables as the defaults, and the saved settings over them', async () => {
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '{"holdMode":false,"openKey":"o"}');
    const { plugin, saved, run } = setupInDock();
    const current = await servedOptions(plugin);
    expect(current).toMatchObject({ holdMode: false, openKey: 'o' });
    expect(current.__internal.defaults).toMatchObject({ holdMode: false, openKey: 'o' });

    await run('save', { ...form(current), openKey: 'p' });
    expect(saved.get('options')).toEqual({ openKey: 'p' });
    expect(await servedOptions(plugin)).toMatchObject({ holdMode: false, openKey: 'p' });

    await run('reset');
    expect(await servedOptions(plugin)).toMatchObject({ holdMode: false, openKey: 'o' });
  });

  it('applies a toggle variable again after a reset', async () => {
    vi.stubEnv('SVELTE_INSPECTOR_TOGGLE', 'alt-y');
    const { plugin, run } = setupInDock();
    const current = await servedOptions(plugin);
    expect(current.__internal.defaults.toggleKeyCombo).toBe('alt-y');
    await run('save', { ...form(current), toggleKeyCombo: 'meta-k' });
    expect((await servedOptions(plugin)).toggleKeyCombo).toBe('meta-k');
    await run('reset');
    expect((await servedOptions(plugin)).toggleKeyCombo).toBe('alt-y');
  });

  it('ignores invalid saved settings', async () => {
    const saved = new Map<string, unknown>([
      ['options', { openKey: 3, navKeys: { parent: 'w', up: 'x' } }],
    ]);
    const { plugin } = setupInDock(undefined, saved);
    expect(await servedOptions(plugin)).toMatchObject({
      openKey: 'Enter',
      navKeys: { ...defaults.navKeys, parent: 'w' },
    });
  });

  it('serves the options before Vite DevTools sets the plugin up', async () => {
    expect((await servedOptions(setup())).toggleKeyCombo).toBe('alt-x');
  });
});

describe('settings helpers', () => {
  it('accepts the default options', () => {
    expect(validateSettings(structuredClone(defaultInspectorOptions))).toEqual({
      options: defaultInspectorOptions,
    });
  });

  it.each([
    [withDefaults({ toggleKeyCombo: '' }), 'Shortcut needs a key'],
    [withDefaults({ toggleKeyCombo: 'alt--' }), 'Shortcut needs a key'],
    [withDefaults({ openKey: '  ' }), 'Open in editor needs a key'],
    [withDefaults({ escapeKeys: [] }), 'Stop picking needs at least one key'],
    [withDefaults({ navKeys: { parent: 'w' } }), 'First child needs a key'],
    [null, 'No settings to save'],
    [{}, 'Shortcut needs a key'],
  ] as const)('rejects %j', (input, error) => {
    expect(validateSettings(input)).toEqual({ error });
  });

  it('keeps a single space as a key, alone or in the shortcut', () => {
    const result = validateSettings(withDefaults({ openMenuKey: ' ', toggleKeyCombo: 'alt- ' }));
    expect(result).toHaveProperty('options.openMenuKey', ' ');
    expect(result).toHaveProperty('options.toggleKeyCombo', 'alt- ');
    expect(pickOptions({ toggleKeyCombo: 'alt- ' }).options).toEqual({ toggleKeyCombo: 'alt- ' });
  });

  it('saves only what changed, whatever the key order of navKeys', () => {
    const { parent, child, next, prev } = defaults.navKeys;
    expect(
      updateSaved(
        {},
        { ...defaults, holdMode: false, navKeys: { prev, next, child, parent } },
        defaults,
      ),
    ).toEqual({ holdMode: false });
    expect(
      updateSaved({}, { ...defaults, navKeys: { ...defaults.navKeys, next: 'l' } }, defaults),
    ).toEqual({ navKeys: { ...defaults.navKeys, next: 'l' } });
  });

  it('keeps saved options the form left alone, and removes the ones set back to the defaults', () => {
    const saved = { toggleKeyCombo: 'alt-x', openKey: 'o' };
    // a project whose default shortcut is control-i runs with the saved alt-x
    const base = { ...defaults, toggleKeyCombo: 'control-i' };
    const running = mergeOptions(base, saved);
    expect(updateSaved(saved, { ...running, holdMode: false }, base)).toEqual({
      ...saved,
      holdMode: false,
    });
    expect(updateSaved(saved, { ...running, openKey: 'Enter' }, base)).toEqual({
      toggleKeyCombo: 'alt-x',
    });
  });

  it('picks the valid options and names the others', () => {
    expect(
      pickOptions({
        toggleKeyCombo: 'meta-k',
        openKey: '',
        holdMode: 'yes',
        escapeKeys: ['Escape', 1],
        navKeys: { parent: 'w', up: 'x' },
      }),
    ).toEqual({
      options: { toggleKeyCombo: 'meta-k', navKeys: { parent: 'w' } },
      invalid: ['openKey', 'holdMode', 'escapeKeys', 'navKeys.up'],
    });
    expect(pickOptions({ navKeys: 'w' })).toEqual({ options: {}, invalid: ['navKeys'] });
    expect(pickOptions(true)).toEqual({ options: {}, invalid: [] });
  });

  it('merges navKeys key by key', () => {
    expect(mergeOptions(defaults, undefined, { navKeys: { parent: 'w' } }).navKeys).toEqual({
      ...defaults.navKeys,
      parent: 'w',
    });
  });

  it('compares values whatever the key order of objects', () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(same([1, 2], [2, 1])).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
    expect(same(null, {})).toBe(false);
  });
});
