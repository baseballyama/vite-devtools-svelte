import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build, createServer } from 'vite';
import type { Plugin } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

const packageDir = path.resolve(import.meta.dirname, '..');
// Inside the package, so the bundle resolves `vite` and `obug` from its node_modules.
const cacheDir = path.join(packageDir, 'node_modules/.cache');
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(path.join(cacheDir, 'dist-test-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('the built package', () => {
  // A full build (bundle + d.ts), next to the other packages' suites in CI.
  it('serves the runtime copied next to the bundle', { timeout: 60_000 }, async () => {
    await build({
      root: packageDir,
      configFile: path.join(packageDir, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir },
    });
    const entry = path.join(outDir, 'index.mjs');
    const { svelteInspector } = (await import(pathToFileURL(entry).href)) as {
      svelteInspector: () => Plugin;
    };

    const server = await createServer({
      root: outDir,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      plugins: [svelteInspector()],
    });
    try {
      const env = server.environments.client;
      for (const file of ['devtools-action.ts', 'Inspector.svelte']) {
        const resolved = await env.pluginContainer.resolveId(
          `virtual:vite-devtools-svelte-inspector-path:${file}`,
        );
        expect(resolved?.id).toBe(path.join(outDir, 'runtime', file).replaceAll('\\', '/'));
        expect(existsSync(String(resolved?.id))).toBe(true);
      }
    } finally {
      await server.close();
    }
  });
});
