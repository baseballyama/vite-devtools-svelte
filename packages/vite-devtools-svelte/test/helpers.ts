import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Plugin } from 'vite';

import { SessionStore } from '../src/mcp/sessions.js';
import { Collector } from '../src/server/collector.js';
import { createRpcFunctions, DEVFRAME_ID } from '../src/server/devframe.js';
import type { SvelteDevtoolsHost } from '../src/server/devframe.js';

export interface TestHost extends SvelteDevtoolsHost {
  opened: string[];
}

/** SvelteKit's setup plugin as the plugin reads it, with `files.routes` resolved to `routes`. */
export const kitSetup = (routes: string) => ({
  name: 'vite-plugin-sveltekit-setup',
  api: { options: { files: { routes } } },
});

export function createTestHost(
  root: string,
  overrides: Partial<SvelteDevtoolsHost> = {},
): TestHost {
  const opened: string[] = [];
  const collector = new Collector();
  let sessions: SessionStore | undefined;
  return {
    collector,
    root: () => root,
    routesDir: () => path.join(root, 'src/routes'),
    publicBase: () => '/',
    modules: () => [],
    serverOrigins: () => [],
    openInEditor: target => {
      opened.push(target);
    },
    sessions: () =>
      (sessions ??= new SessionStore({
        persistDir: path.join(root, 'node_modules/.vite-devtools-svelte/sessions'),
        getters: {
          getRenderProfiles: () => collector.renderProfiles,
          getLoadProfiles: () => collector.loadProfiles,
          getFpsSamples: () => collector.fpsSamples,
        },
      })),
    opened,
    ...overrides,
  };
}

export function rpcHandlers(host: SvelteDevtoolsHost): Map<string, (...args: any[]) => any> {
  const map = new Map<string, (...args: any[]) => any>();
  for (const fn of createRpcFunctions(host)) {
    map.set(`${DEVFRAME_ID}:${fn.name}`, (fn as { handler: (...args: any[]) => any }).handler);
  }
  return map;
}

type AnyFn = (...args: any[]) => any;

export function callHook(hook: unknown, ...args: unknown[]): any {
  const fn = typeof hook === 'function' ? hook : (hook as { handler: unknown }).handler;
  return (fn as AnyFn)(...args);
}

export function resolvePlugins(plugins: Plugin[], config: Record<string, unknown> = {}) {
  const resolved = {
    command: 'serve',
    root: '/test',
    base: '/',
    plugins: [],
    logger: { warn: () => {} },
    ...config,
  };
  for (const p of plugins) if (p.configResolved) callHook(p.configResolved, resolved);
  return resolved;
}

export function codeOf(result: unknown): string {
  return typeof result === 'string' ? result : (result as { code: string }).code;
}

/** Integration tests wait on observable state, never for a fixed time. */
export async function waitFor<T>(
  read: () => T | Promise<T>,
  ok: (value: T) => boolean = Boolean,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end)
      throw new Error(`timed out; last value: ${JSON.stringify(value)?.slice(0, 300)}`);
    await sleep(20);
  }
}

/**
 * Whether devframe has written a trusted client's auth token (as stored by
 * the shimmed `localStorage`) to its store under `home`. devframe persists
 * with a debounce; a restart before that would forget the client.
 */
export function authTokenPersisted(home: string, localStore: Map<string, string>): boolean {
  const tokens = [...localStore.values()].filter(v => v.length >= 16);
  if (tokens.length === 0) return false;
  return fs
    .readdirSync(home, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .some(e => {
      const text = fs.readFileSync(path.join(e.parentPath, e.name), 'utf8');
      return tokens.some(t => text.includes(t));
    });
}
