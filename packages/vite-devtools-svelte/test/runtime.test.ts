import fs from 'node:fs';
import path from 'node:path';

import * as devtools from 'svelte/internal/devtools';
import { describe, it, expect } from 'vitest';

import { HOOKS_FILE, HOOKS_MODULE_ID } from '../src/runtime/index.js';

describe('module ids', () => {
  it('HOOKS_MODULE_ID', () => {
    expect(HOOKS_MODULE_ID).toBe('virtual:svelte-devtools-hooks');
  });
});

const RUNTIME_FILE = path.join(path.dirname(HOOKS_FILE), 'runtime.js');

describe('runtime file', () => {
  it('imports nothing and exports only the store factory and the HMR wiring', async () => {
    // the browser globals it uses come in through createStore(env)
    const source = fs.readFileSync(RUNTIME_FILE, 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    const runtime = (await import(RUNTIME_FILE)) as Record<string, unknown>;
    expect(Object.keys(runtime).toSorted()).toEqual(['connectHot', 'createStore']);
  });
});

// The hooks are the only code that talks to Svelte: they import the runtime
// next to them and only what svelte/internal/devtools exports.
describe('hooks file', () => {
  const source = fs.readFileSync(HOOKS_FILE, 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?'([^']+)'/gm)];

  it('imports svelte/internal/devtools and the runtime next to it (a real file), and nothing else', () => {
    // no virtual module: a dependency prebundle may carry the hooks
    expect(imports.map(m => m[2])).toEqual(['svelte/internal/devtools', './runtime.js']);
  });

  it('uses only names svelte/internal/devtools exports (as functions)', () => {
    const names = imports
      .find(m => m[2] === 'svelte/internal/devtools')![1]!
      .split(',')
      .map(name => name.trim())
      .filter(name => name !== '');
    expect(names.length).toBeGreaterThan(5);
    const exported = devtools as Record<string, unknown>;
    expect(names.filter(name => typeof exported[name] !== 'function')).toEqual([]);
  });

  it('exports nothing (a side-effect module the compiler imports)', () => {
    expect(source).not.toMatch(/^export\b/m);
  });
});
