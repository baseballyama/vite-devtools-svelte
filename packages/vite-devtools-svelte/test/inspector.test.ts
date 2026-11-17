import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer } from 'vite';
import type { DevEnvironment, ViteDevServer } from 'vite';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import type { InspectorOptions as ForkOptions } from '../../inspector/src/index.js';
import type { InspectorOptions } from '../src/inspector.js';
import { svelteDevtools } from '../src/plugin.js';
import type { SvelteDevtoolsOptions } from '../src/plugin.js';

const OPTIONS_ID = 'virtual:vite-devtools-svelte-inspector-options';

const servers: ViteDevServer[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function start(options?: SvelteDevtoolsOptions): Promise<DevEnvironment> {
  const root = mkdtempSync(path.join(tmpdir(), 'vds-inspector-'));
  dirs.push(root);
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    plugins: [svelteDevtools(options), svelte({ inspector: true, configFile: false })],
  });
  servers.push(server);
  return server.environments.client;
}

async function inspectorOptions(env: DevEnvironment) {
  const resolved = await env.pluginContainer.resolveId(OPTIONS_ID);
  const loaded = await env.pluginContainer.load(resolved!.id);
  const code = typeof loaded === 'string' ? loaded : loaded?.code;
  return JSON.parse(String(code).replace('export default ', ''));
}

const names = (env: DevEnvironment) => env.plugins.map(p => p.name);

describe('the inspector inside svelteDevtools()', () => {
  it("is on by default, in place of vite-plugin-svelte's built-in inspector", async () => {
    const env = await start();
    expect(names(env)).toContain('vite-devtools-svelte-inspector');
    expect(names(env)).not.toContain('vite-plugin-svelte-inspector');
    expect(await inspectorOptions(env)).toMatchObject({ toggleKeyCombo: 'alt-x' });
  });

  it('passes `inspector` options through', async () => {
    const env = await start({ inspector: { toggleKeyCombo: 'control-o', holdMode: false } });
    expect(await inspectorOptions(env)).toMatchObject({
      toggleKeyCombo: 'control-o',
      holdMode: false,
      openKey: 'Enter',
    });
  });

  it('with `inspector: false`, leaves it out and the built-in inspector alone', async () => {
    const env = await start({ inspector: false });
    expect(names(env)).not.toContain('vite-devtools-svelte-inspector');
    expect(names(env)).toContain('vite-plugin-svelte-inspector');
  });

  it("declares the fork's public options (the published types cannot import it)", () => {
    expectTypeOf<InspectorOptions>().toEqualTypeOf<Omit<ForkOptions, '__internal'>>();
  });
});
