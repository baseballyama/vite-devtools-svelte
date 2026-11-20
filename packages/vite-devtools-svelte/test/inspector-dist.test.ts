import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url)).replaceAll('\\', '/');
const entry = `${dist}index.mjs`;
const chunk = `${dist}inspector/index.mjs`;

// CI builds before it tests, so a missing build fails there; a plain `pnpm test` without a build
// skips these
describe.skipIf(!fs.existsSync(entry) && !process.env.CI)('the built inspector', () => {
  it('serves its runtime from next to its chunk', async () => {
    const { svelteDevtools } = (await import(entry)) as { svelteDevtools: () => Plugin[] };
    const inspector = svelteDevtools().find(p => p.name === 'vite-devtools-svelte-inspector');
    const resolveId = inspector?.resolveId as { handler: (id: string) => string | null };
    for (const file of ['devtools-action.ts', 'settings-view.ts', 'Inspector.svelte']) {
      const resolved = resolveId.handler(`virtual:vite-devtools-svelte-inspector-path:${file}`);
      expect(resolved).toBe(`${dist}inspector/runtime/${file}`);
      expect(fs.existsSync(resolved!)).toBe(true);
    }
    const copied = fs.readdirSync(`${dist}inspector/runtime`);
    expect(copied.filter(file => file.endsWith('.d.ts'))).toEqual([]);
  });

  it('leaves browser-only code out of the plugin chunk', () => {
    const code = fs.readFileSync(chunk, 'utf8');
    // the page's cursor icon, used by the runtime only
    expect(code).not.toContain('svelte-inspector-logo');
    // a browser debug logger, which reads localStorage on import
    expect(code).not.toContain('localStorage');
  });
});
