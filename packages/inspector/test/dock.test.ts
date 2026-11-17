import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { svelteInspector } from '../src/index.js';
import { defaultInspectorOptions } from '../src/options.js';
import { changedOptions, validateSettings, writeSettings } from '../src/settings.js';
import type { InspectorOptions } from '../src/types.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vds-inspector-dock-'));
  delete process.env.SVELTE_INSPECTOR_OPTIONS;
  delete process.env.SVELTE_INSPECTOR_TOGGLE;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = () => fs.readFileSync(path.join(dir, '.env.local'), 'utf-8');

type Handler = (...args: unknown[]) => unknown;

/** Invoke a plugin hook declared as a function or as `{ handler }` */
const call = (hook: Plugin[keyof Plugin], ...args: unknown[]) =>
  (typeof hook === 'function' ? (hook as Handler) : (hook as { handler: Handler }).handler)(
    ...args,
  );

function setup(
  options?: InspectorOptions,
  { devtools = true, envDir = dir }: { devtools?: boolean; envDir?: string | false } = {},
) {
  const plugin = svelteInspector(options);
  call(plugin.configResolved, {
    mode: 'development',
    root: dir,
    envDir,
    base: '/',
    plugins: devtools ? [{ name: 'vite:devtools' }, { name: 'vite:devtools:injection' }] : [],
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

type ActionResult = { ok: boolean; status: string };

/** A fake Vite DevTools node context: records docks and rpc functions */
function fakeDevtools() {
  const docks: DockEntry[] = [];
  const actions = new Map<string, (params?: unknown) => Promise<ActionResult>>();
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
  };
  return { ctx, docks, actions };
}

/** The options the browser gets */
async function servedOptions(plugin: Plugin) {
  const code = await call(plugin.load, 'virtual:vite-devtools-svelte-inspector-options');
  return JSON.parse(String(code).replace(/^export default /, ''));
}

/** what the settings view sends: the full options, without the internal ones */
const form = (options: Record<string, unknown>) => {
  const { __internal: _, ...rest } = structuredClone(options);
  return rest;
};

const injects = (plugin: Plugin) =>
  call(plugin.transform, 'export {}', '/node_modules/vite/dist/client/client.mjs') !== null;

const withDefaults = (patch: Record<string, unknown>) => ({
  ...structuredClone(defaultInspectorOptions),
  ...patch,
});

describe('with Vite DevTools', () => {
  it('lives in the dock instead of injecting itself into the page', () => {
    const plugin = setup();
    expect(injects(plugin)).toBe(false);

    const { ctx, docks } = fakeDevtools();
    plugin.devtools.setup(ctx);
    expect(docks.map(d => [d.id, d.type, d.groupId])).toEqual([
      ['svelte', 'group', undefined],
      // the picker stays on the bar, one click away
      ['svelte:inspector', 'action', undefined],
      // settings live in the Svelte group
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

  it('serves the dock and settings client scripts', () => {
    const plugin = setup();
    const dock = call(plugin.resolveId, 'virtual:vite-devtools-svelte-inspector-dock');
    expect(call(plugin.load, dock)).toContain('devtools-action.ts');
    const settings = call(plugin.resolveId, 'virtual:vite-devtools-svelte-inspector-settings');
    expect(call(plugin.load, settings)).toContain('settings-view.ts');
  });

  it('keeps a Svelte group another plugin registered first', () => {
    const plugin = setup();
    const { ctx, docks } = fakeDevtools();
    // the group is registered first, and that registration fails
    ctx.docks.register.mockImplementationOnce(() => {
      throw new Error('Dock with id "svelte" is already registered');
    });
    plugin.devtools.setup(ctx);
    expect(docks.map(d => d.id)).toEqual(['svelte:inspector', 'svelte:inspector-settings']);
  });
});

describe('without Vite DevTools', () => {
  it('injects itself into the page and adds nothing to a dock', () => {
    const plugin = setup(undefined, { devtools: false });
    expect(injects(plugin)).toBe(true);
    const { ctx, docks } = fakeDevtools();
    plugin.devtools.setup(ctx);
    expect(docks).toEqual([]);
  });
});

describe('settings view', () => {
  it('saves the options that differ from the plugin options to .env.local', async () => {
    const plugin = setup({ toggleKeyCombo: 'control-i' });
    const { ctx, actions } = fakeDevtools();
    plugin.devtools.setup(ctx);
    const current = await servedOptions(plugin);
    expect(current.toggleKeyCombo).toBe('control-i');
    // "Reset to defaults" returns to the plugin options, not .env.local
    expect(current.__internal.defaults).toEqual({
      ...defaultInspectorOptions,
      toggleKeyCombo: 'control-i',
    });

    const saved = await actions.get('svelte:inspector:save-settings')?.({
      ...form(current),
      holdMode: false,
      escapeKeys: ['Escape'],
    });
    expect(read()).toBe(
      'SVELTE_INSPECTOR_OPTIONS=\'{"holdMode":false,"escapeKeys":["Escape"]}\'\n',
    );
    expect(saved).toEqual({ ok: true, status: 'Saved to .env.local. Restarting…' });

    const reset = await actions.get('svelte:inspector:reset-settings')?.();
    expect(fs.existsSync(path.join(dir, '.env.local'))).toBe(false);
    expect(reset?.status).toMatch(/^Reset/);
  });

  it('reports invalid input instead of saving', async () => {
    const plugin = setup();
    const { ctx, actions } = fakeDevtools();
    plugin.devtools.setup(ctx);
    const result = await actions.get('svelte:inspector:save-settings')?.({
      ...form(await servedOptions(plugin)),
      openKey: '  ',
    });
    expect(result).toEqual({ ok: false, status: 'Open in editor needs a key' });
    expect(fs.existsSync(path.join(dir, '.env.local'))).toBe(false);
  });

  it('says when an env file of the mode overrides the saved settings', async () => {
    fs.writeFileSync(path.join(dir, '.env.development'), "SVELTE_INSPECTOR_OPTIONS='{}'\n");
    const plugin = setup();
    const { ctx, actions } = fakeDevtools();
    plugin.devtools.setup(ctx);
    const saved = await actions.get('svelte:inspector:save-settings')?.({
      ...form(await servedOptions(plugin)),
      toggleKeyCombo: 'meta-k',
    });
    expect(saved?.status).toContain(
      'SVELTE_INSPECTOR_OPTIONS is also set in .env.development, which takes precedence.',
    );
  });

  it('does not save when Vite loads no env files', async () => {
    const plugin = setup(undefined, { envDir: false });
    const { ctx, actions } = fakeDevtools();
    plugin.devtools.setup(ctx);
    const saved = await actions.get('svelte:inspector:save-settings')?.({
      ...form(await servedOptions(plugin)),
      toggleKeyCombo: 'meta-k',
    });
    expect(saved?.ok).toBe(false);
    expect(saved?.status).toMatch(/envDir: false/);
  });

  it('serves the saved settings on the next start', async () => {
    const plugin = setup();
    const { ctx, actions } = fakeDevtools();
    plugin.devtools.setup(ctx);
    await actions.get('svelte:inspector:save-settings')?.({
      ...form(await servedOptions(plugin)),
      toggleKeyCombo: 'meta-k',
    });
    expect((await servedOptions(setup())).toggleKeyCombo).toBe('meta-k');
  });
});

describe('settings helpers', () => {
  it('accepts the default options without the toggle button ones', () => {
    const { showToggleButton: _, toggleButtonPos: __, ...expected } = defaultInspectorOptions;
    expect(validateSettings(structuredClone(defaultInspectorOptions))).toEqual({
      options: expected,
    });
  });

  it.each([
    [withDefaults({ toggleKeyCombo: '' }), 'Shortcut needs a key'],
    [withDefaults({ openKey: "'" }), "Open in editor can't be '"],
    [withDefaults({ escapeKeys: [] }), 'Stop picking needs at least one key'],
    [null, 'No settings to save'],
  ] as const)('rejects %j', (input, error) => {
    expect(validateSettings(input)).toEqual({ error });
  });

  it('lists only changed options', () => {
    expect(
      changedOptions(
        {
          ...defaultInspectorOptions,
          holdMode: false,
          navKeys: structuredClone(defaultInspectorOptions.navKeys),
        },
        defaultInspectorOptions,
      ),
    ).toEqual({ holdMode: false });
  });

  it('keeps other variables in .env.local', () => {
    fs.writeFileSync(path.join(dir, '.env.local'), 'A=1\nSVELTE_INSPECTOR_OPTIONS=old\nB=2\n');
    writeSettings(dir, { holdMode: false });
    expect(read()).toBe('A=1\nB=2\nSVELTE_INSPECTOR_OPTIONS=\'{"holdMode":false}\'\n');
    writeSettings(dir, null);
    expect(read()).toBe('A=1\nB=2\n');
  });

  it('does not create .env.local just to remove the variable', () => {
    writeSettings(dir, null);
    expect(fs.existsSync(path.join(dir, '.env.local'))).toBe(false);
  });
});
