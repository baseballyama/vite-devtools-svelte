import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Plugin } from 'vite';

import type { McpServer } from '../src/mcp/protocol.js';
import { Collector } from '../src/server/collector.js';
import { createRpcFunctions, DEVFRAME_ID } from '../src/server/devframe.js';
import type { DevframeDeps } from '../src/server/devframe.js';

export interface TestDeps extends DevframeDeps {
  opened: string[];
}

/** SvelteKit's setup plugin as the plugin reads it, with `files.routes` resolved to `routes`. */
export const kitSetup = (routes: string) => ({
  name: 'vite-plugin-sveltekit-setup',
  api: { options: { files: { routes } } },
});

export function createTestDeps(root: string, overrides: Partial<DevframeDeps> = {}): TestDeps {
  const opened: string[] = [];
  return {
    collector: new Collector(),
    root: () => root,
    routesDir: () => path.join(root, 'src/routes'),
    publicBase: () => '/',
    modules: () => [],
    serverOrigins: () => [],
    openInEditor: target => {
      opened.push(target);
    },
    opened,
    ...overrides,
  };
}

export function rpcHandlers(deps: DevframeDeps): Map<string, (...args: any[]) => any> {
  const map = new Map<string, (...args: any[]) => any>();
  for (const fn of createRpcFunctions(deps)) {
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

/** The real SDK client, connected in process to one of our MCP servers. */
export async function connectMcpClient(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const answer = async (message: JSONRPCMessage) => {
    const response = await server.handle(message);
    if (response) await serverSide.send(response as JSONRPCMessage);
  };
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the SDK transport is not an EventTarget
  serverSide.onmessage = message => {
    void answer(message);
  };
  await serverSide.start();
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}
