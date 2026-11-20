/**
 * vite-plugin-svelte prints dev warnings with `console.log`, never through
 * Vite's logger, so they have to be taken from its `onwarn`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { svelteDevtools } from '../src/plugin.js';
import { devtoolsContext } from './helpers.js';

// Inside the package, so the compiled component resolves `svelte`.
const root = fs.mkdtempSync(path.join(import.meta.dirname, '.tmp-warn-'));
fs.writeFileSync(path.join(root, 'App.svelte'), '<p>hi</p>\n<img src="a.png">\n');
let server: ViteDevServer | undefined;

afterAll(async () => {
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('compiler warnings from vite-plugin-svelte', () => {
  it('records each warning of a dev compile once, file and position included', async () => {
    const devtools = svelteDevtools();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false },
      plugins: [svelte({ configFile: false }), devtools],
    });
    // Compiled for the client and for SSR: warned twice, recorded once.
    await server.transformRequest('/App.svelte');
    await server.environments.ssr.transformRequest('/App.svelte');
    vi.restoreAllMocks();

    const handlers = new Map<string, (...args: any[]) => any>();
    await (devtools[0] as any).devtools.setup(
      devtoolsContext({
        scope: (id: string) => ({
          rpc: { register: (fn: any) => handlers.set(`${id}:${fn.name}`, fn.handler) },
        }),
        docks: { register: vi.fn() },
      }),
    );
    const warnings = await handlers.get('svelte-devtools:get-compiler-warnings')!();
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'a11y_missing_attribute',
        file: path.join(root, 'App.svelte'),
        line: 2,
      }),
    ]);
  }, 30_000);
});
