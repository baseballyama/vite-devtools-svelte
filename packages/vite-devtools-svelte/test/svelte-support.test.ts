import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { svelteSupport } from '../src/svelte-support.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-support-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** An app at `<tmp>/<name>` with Svelte's `package.json` installed. */
function app(name: string, manifest: object): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const dir = path.join(root, 'node_modules', 'svelte');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  return root;
}

const exportsOf = (...subpaths: string[]) => ({
  './package.json': './package.json',
  ...Object.fromEntries(subpaths.map(s => [s, './x.js'])),
});

describe('svelteSupport', () => {
  it('finds the devtools events by the `svelte/internal/devtools` export', () => {
    const root = app('new', {
      version: '5.99.0',
      exports: exportsOf('./internal/client', './internal/devtools'),
    });
    expect(svelteSupport(root)).toEqual({ version: '5.99.0', devtoolsEvents: true });
  });

  it('a Svelte without that export has none', () => {
    const root = app('old', { version: '5.57.3', exports: exportsOf('./internal/client') });
    expect(svelteSupport(root)).toEqual({ version: '5.57.3', devtoolsEvents: false });
  });

  it('none when svelte/package.json cannot be resolved', () => {
    // (a missing Svelte cannot be tested here: pnpm's bin shim puts the
    // repository's hoisted packages on NODE_PATH, the lookup's last resort)
    const root = app('unresolvable', { version: '5.0.0', exports: { '.': './x.js' } });
    expect(svelteSupport(root)).toEqual({ version: undefined, devtoolsEvents: false });
  });

  it("the repository's own Svelte has them", () => {
    expect(svelteSupport(process.cwd()).devtoolsEvents).toBe(true);
  });
});
