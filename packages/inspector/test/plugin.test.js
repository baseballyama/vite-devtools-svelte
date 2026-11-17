import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { svelteInspector } from '../src/index.js';

const OPTIONS_ID = 'virtual:vite-devtools-svelte-inspector-options';

/** @type {import('vite').ViteDevServer[]} */
const servers = [];
/** @type {string[]} */
const dirs = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/**
 * @param {Parameters<typeof svelteInspector>[0]} [options]
 * @param {import('vite').PluginOption[]} [plugins] plugins added before the inspector
 */
async function start(options, plugins = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'vds-inspector-'));
  dirs.push(root);
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    plugins: [...plugins, svelteInspector(options)],
  });
  servers.push(server);
  return server.environments.client;
}

/** @param {import('vite').DevEnvironment} env */
async function loadOptions(env) {
  const resolved = await env.pluginContainer.resolveId(OPTIONS_ID);
  if (!resolved) return null;
  const loaded = await env.pluginContainer.load(resolved.id);
  const code = typeof loaded === 'string' ? loaded : loaded?.code;
  return JSON.parse(String(code).replace('export default ', ''));
}

describe('svelteInspector', () => {
  it('serves the default options when enabled without arguments', async () => {
    const options = await loadOptions(await start());
    expect(options).toMatchObject({
      toggleKeyCombo: 'alt-x',
      holdMode: true,
      __internal: { base: '' },
    });
  });

  it('merges the options passed to the plugin over the defaults', async () => {
    const options = await loadOptions(
      await start({ toggleKeyCombo: 'control-o', holdMode: false }),
    );
    expect(options).toMatchObject({
      toggleKeyCombo: 'control-o',
      holdMode: false,
      openKey: 'Enter',
    });
  });

  it('stays enabled when the environment says false or true', async () => {
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', 'false');
    expect(await loadOptions(await start({ openKey: 'o' }))).toMatchObject({ openKey: 'o' });
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', 'true');
    expect(await loadOptions(await start({ openKey: 'o' }))).toMatchObject({ openKey: 'o' });
  });

  it('still applies option objects and the toggle from the environment', async () => {
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '{"holdMode":false}');
    expect(await loadOptions(await start({ holdMode: true }))).toMatchObject({ holdMode: false });
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '');
    vi.stubEnv('SVELTE_INSPECTOR_TOGGLE', 'meta-i');
    expect(await loadOptions(await start())).toMatchObject({ toggleKeyCombo: 'meta-i' });
  });

  it("turns off vite-plugin-svelte's built-in inspector", async () => {
    const env = await start({}, [svelte({ inspector: true })]);
    const names = env.plugins.map(p => p.name);
    expect(names).toContain('vite-devtools-svelte-inspector');
    expect(names).not.toContain('vite-plugin-svelte-inspector');
  });

  it('leaves the built-in inspector in place when this plugin is not added', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vds-inspector-'));
    dirs.push(root);
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      plugins: [svelte({ inspector: true })],
    });
    servers.push(server);
    expect(server.environments.client.plugins.map(p => p.name)).toContain(
      'vite-plugin-svelte-inspector',
    );
  });

  it('resolves runtime files next to the plugin and refuses path traversal', async () => {
    const env = await start();
    const resolved = await env.pluginContainer.resolveId(
      'virtual:vite-devtools-svelte-inspector-path:load-inspector.js',
    );
    expect(resolved?.id).toBe(
      path.resolve(import.meta.dirname, '../src/runtime/load-inspector.js').replaceAll('\\', '/'),
    );
    expect(
      await env.pluginContainer.resolveId(
        'virtual:vite-devtools-svelte-inspector-path:../plugin.js',
      ),
    ).toBeNull();
  });
});
