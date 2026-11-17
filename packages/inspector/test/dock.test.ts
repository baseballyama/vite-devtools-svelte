import type { Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

import { svelteInspector } from '../src/index.js';

type Handler = (...args: unknown[]) => unknown;

/** Invoke a plugin hook declared as a function or as `{ handler }` */
const call = (hook: Plugin[keyof Plugin], ...args: unknown[]) =>
  (typeof hook === 'function' ? (hook as Handler) : (hook as { handler: Handler }).handler)(
    ...args,
  );

function setup() {
  const plugin = svelteInspector();
  call(plugin.configResolved, {
    mode: 'development',
    root: '/project',
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
  icon: string;
  toggle?: boolean;
  action?: { importFrom: string };
}

describe('the dock', () => {
  it('holds the inspector, which is never injected into the page', () => {
    const plugin = setup();
    expect(plugin.transform).toBeUndefined();

    const docks: DockEntry[] = [];
    plugin.devtools.setup({
      docks: {
        register(entry) {
          docks.push(entry as unknown as DockEntry);
        },
      },
    });
    expect(docks.map(d => [d.id, d.type])).toEqual([['svelte:inspector', 'action']]);
    const [inspector] = docks;
    expect(inspector?.toggle).toBe(true);
    expect(inspector?.action?.importFrom).toBe(
      '/@id/__x00__virtual:vite-devtools-svelte-inspector-dock',
    );
    expect(Buffer.from(String(inspector?.icon.split(',')[1]), 'base64').toString()).toContain(
      'svelte-inspector-logo',
    );
  });

  it('serves the dock client script', () => {
    const plugin = setup();
    const dock = call(plugin.resolveId, 'virtual:vite-devtools-svelte-inspector-dock');
    expect(call(plugin.load, dock)).toContain('devtools-action.ts');
  });
});
