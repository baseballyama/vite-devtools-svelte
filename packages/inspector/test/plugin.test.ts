import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createLogger, createServer } from 'vite';
import type { DevEnvironment, InlineConfig, PluginOption, ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { svelteInspector } from '../src/index.js';
import type { InspectorOptions } from '../src/index.js';

const OPTIONS_ID = 'virtual:vite-devtools-svelte-inspector-options';

/** what marks Vite DevTools (`@vitejs/devtools`) as installed */
const VITE_DEVTOOLS = { name: 'vite:devtools' };

const servers: ViteDevServer[] = [];
const dirs: string[] = [];

// Inspector variables set in the shell would otherwise leak into every server.
beforeEach(() => {
  vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '');
  vi.stubEnv('SVELTE_INSPECTOR_TOGGLE', '');
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** `plugins` are added before the inspector. */
async function start(
  options?: InspectorOptions,
  plugins: PluginOption[] = [],
  config: InlineConfig = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), 'vds-inspector-'));
  dirs.push(root);
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    plugins: [...plugins, svelteInspector(options)],
    ...config,
  });
  servers.push(server);
  return server.environments.client;
}

async function loadOptions(env: DevEnvironment): Promise<Record<string, unknown> | null> {
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

  it('names the variables in the error when they switch the built-in inspector on', async () => {
    vi.stubEnv('SVELTE_INSPECTOR_TOGGLE', 'meta-i');
    await expect(start({}, [VITE_DEVTOOLS, svelte()])).rejects.toThrow(
      /SVELTE_INSPECTOR_OPTIONS or SVELTE_INSPECTOR_TOGGLE in the shell or an env file switches it on too/,
    );
  });

  it("refuses to start in the dock when vite-plugin-svelte's built-in inspector is on", async () => {
    await expect(start({}, [VITE_DEVTOOLS, svelte({ inspector: true })])).rejects.toThrow(
      /vite-plugin-svelte's own inspector is enabled as well\. Turn that one off/,
    );
  });

  it('starts in the dock when the built-in inspector is off', async () => {
    const env = await start({}, [VITE_DEVTOOLS, svelte()]);
    const names = env.plugins.map(p => p.name);
    expect(names).toContain('vite-devtools-svelte-inspector');
    expect(names).not.toContain('vite-plugin-svelte-inspector');
  });

  it('leaves the built-in inspector alone without Vite DevTools, where this one does nothing', async () => {
    const env = await start({}, [svelte({ inspector: true })]);
    const names = env.plugins.map(p => p.name);
    expect(names).toContain('vite-devtools-svelte-inspector');
    expect(names).toContain('vite-plugin-svelte-inspector');
  });

  it('resolves runtime files next to the plugin and refuses path traversal', async () => {
    const env = await start();
    const resolved = await env.pluginContainer.resolveId(
      'virtual:vite-devtools-svelte-inspector-path:devtools-action.ts',
    );
    expect(resolved?.id).toBe(
      path.resolve(import.meta.dirname, '../src/runtime/devtools-action.ts').replaceAll('\\', '/'),
    );
    expect(
      await env.pluginContainer.resolveId(
        'virtual:vite-devtools-svelte-inspector-path:../plugin.js',
      ),
    ).toBeNull();
  });

  it('drops unknown keys of the environment options with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '{"holdMode":false,"nope":1}');
    const options = await loadOptions(await start());
    expect(options).toMatchObject({ holdMode: false });
    expect(options).not.toHaveProperty('nope');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignoring unknown options'));
  });

  it.each(['[1]', 'null', '{oops'])(
    'logs an error and keeps the plugin options when the environment has %s',
    async value => {
      vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', value);
      const errors: string[] = [];
      const customLogger = createLogger('silent');
      customLogger.error = message => {
        errors.push(message);
      };
      const options = await loadOptions(await start({ openKey: 'o' }, [], { customLogger }));
      expect(options).toMatchObject({ openKey: 'o' });
      expect(errors).toEqual([expect.stringContaining('failed to parse inspector options')]);
    },
  );

  it('ignores environment options that are neither an object nor a boolean', async () => {
    vi.stubEnv('SVELTE_INSPECTOR_OPTIONS', '42');
    expect(await loadOptions(await start({ openKey: 'o' }))).toMatchObject({ openKey: 'o' });
  });

  it('passes the base without its trailing slash', async () => {
    const options = await loadOptions(await start({}, [], { base: '/app/' }));
    expect(options).toMatchObject({ __internal: { base: '/app' } });
  });

  it("injects the runtime loader into Vite's client, including Vite+'s layout", () => {
    // Called directly: through the plugin container, Vite's dep optimizer claims
    // node_modules ids before this hook runs.
    const transform = svelteInspector().transform as {
      filter: { id: RegExp };
      handler: (code: string) => { code: string };
    };
    const matches = (id: string) => transform.filter.id.test(id);
    expect(matches('/app/node_modules/vite/dist/client/client.mjs')).toBe(true);
    expect(matches('/app/node_modules/vite/dist/vite/client/client.mjs?v=1')).toBe(true);
    expect(matches('/app/node_modules/vite-plus-core/dist/vite/client/client.mjs')).toBe(true);
    expect(matches('/app/node_modules/vite/dist/client/env.mjs')).toBe(false);

    expect(transform.handler('console.log(1)').code).toBe(
      "console.log(1)\nimport('virtual:vite-devtools-svelte-inspector-path:load-inspector.ts')",
    );
  });
});
