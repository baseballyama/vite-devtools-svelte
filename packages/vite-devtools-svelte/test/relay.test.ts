import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpMiddleware, MCP_PATH } from '../src/mcp/http.js';
import { MCP_INSTRUCTIONS, RELAY_INSTRUCTIONS } from '../src/mcp/instructions.js';
import { registerServer, type RegistryEntry } from '../src/mcp/registry.js';
import { createRelay } from '../src/mcp/relay.js';
import { buildMcpServer, type McpDeps } from '../src/mcp/server.js';
import type { Collector } from '../src/server/collector.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).toReversed()) await c();
});

/** A dev server MCP endpoint whose `get_project_info` answers `name`. */
async function devServer(name: string, token = 'tok'): Promise<string> {
  const deps = { getProject: () => ({ name }) } as unknown as McpDeps;
  const middleware = createMcpMiddleware({
    token,
    collector: { lease: () => false } as unknown as Collector,
    logger: { error: vi.fn() } as unknown as Logger,
    createServer: () => buildMcpServer(deps),
  });
  const server = http.createServer(middleware);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}${MCP_PATH}`;
}

function registry(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vds-relay-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function connect(opts: { cwd: string; registry: string; env?: NodeJS.ProcessEnv }) {
  const relay = await createRelay({ env: {}, version: '1.2.3', ...opts });
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await relay.connect(b);
  await client.connect(a);
  cleanups.push(() => client.close());
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;
const textOf = (r: CallToolResult) => (r.content[0] as { text: string }).text;

let nextId = 0;
const entry = (
  over: Partial<RegistryEntry> & Pick<RegistryEntry, 'url' | 'root'>,
): RegistryEntry => ({
  id: `${process.pid}-${++nextId}`,
  host: os.hostname(),
  pid: process.pid,
  token: 'tok',
  packageName: path.basename(over.root),
  startedAt: nextId,
  ...over,
});
const register = (dir: string, url: string, root: string) =>
  registerServer(dir, entry({ url, root }));

describe('relay', () => {
  it('lists the dev server tools with a `server` argument, without a dev server', async () => {
    const client = await connect({ cwd: '/work/app', registry: registry() });
    expect(client.getInstructions()).toBe(RELAY_INSTRUCTIONS);
    expect(client.getServerVersion()?.version).toBe('1.2.3');
    const { tools } = await client.listTools();
    expect(tools[0]!.name).toBe('list_dev_servers');
    const info = tools.find(t => t.name === 'get_project_info')!;
    expect(info.inputSchema.properties).toHaveProperty('server');
    expect(tools.length).toBeGreaterThan(15);
  });

  it('forwards a call to the dev server of cwd', async () => {
    const dir = registry();
    register(dir, await devServer('app'), '/work/app');
    register(dir, await devServer('other'), '/work/other');
    const client = await connect({ cwd: '/work/app/src', registry: dir });
    const result = await call(client, 'get_project_info');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ name: 'app' });
    // a second call reuses the connection
    expect(JSON.parse(textOf(await call(client, 'get_project_info')))).toEqual({ name: 'app' });
  });

  it('asks for `server` when several match, and uses it', async () => {
    const dir = registry();
    register(dir, await devServer('web'), '/mono/apps/web');
    register(dir, await devServer('docs'), '/mono/apps/docs');
    const client = await connect({ cwd: '/mono', registry: dir });
    const ambiguous = await call(client, 'get_project_info');
    expect(ambiguous.isError).toBe(true);
    expect(textOf(ambiguous)).toContain('More than one dev server matches');
    expect(textOf(ambiguous)).toContain('web at /mono/apps/web');
    const docs = await call(client, 'get_project_info', { server: 'docs' });
    expect(JSON.parse(textOf(docs))).toEqual({ name: 'docs' });
  });

  it('explains when no dev server runs, naming the others', async () => {
    const dir = registry();
    const empty = await connect({ cwd: '/work/app', registry: dir });
    expect(textOf(await call(empty, 'get_project_info'))).toContain(
      'No running dev server for /work/app',
    );
    register(dir, await devServer('x'), '/work/x');
    const client = await connect({ cwd: '/work/app', registry: dir });
    const result = await call(client, 'get_project_info');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('x at /work/x');
    expect(textOf(await call(client, 'get_project_info', { server: 'nope' }))).toContain(
      'No running dev server matches "nope"',
    );
  });

  it('lists dev servers with the default one, without tokens', async () => {
    const dir = registry();
    const url = await devServer('app');
    register(dir, url, '/work/app');
    register(dir, url, '/work/other');
    const client = await connect({ cwd: '/work/app', registry: dir });
    const text = textOf(await call(client, 'list_dev_servers'));
    expect(text).not.toContain('tok');
    const { cwd, servers } = JSON.parse(text);
    expect(cwd).toBe('/work/app');
    expect(servers.map((s: { root: string; default: boolean }) => [s.root, s.default])).toEqual([
      ['/work/other', false],
      ['/work/app', true],
    ]);
  });

  it('uses VITE_DEVTOOLS_SVELTE_URL and _TOKEN over the registry', async () => {
    const url = await devServer('remote', 'secret');
    const origin = new URL(url).origin;
    for (const value of [url, origin]) {
      const client = await connect({
        cwd: '/x',
        registry: registry(),
        env: { VITE_DEVTOOLS_SVELTE_URL: value, VITE_DEVTOOLS_SVELTE_TOKEN: 'secret' },
      });
      expect(JSON.parse(textOf(await call(client, 'get_project_info')))).toEqual({
        name: 'remote',
      });
    }
    const noToken = await connect({
      cwd: '/x',
      registry: registry(),
      env: { VITE_DEVTOOLS_SVELTE_URL: origin },
    });
    expect(textOf(await call(noToken, 'get_project_info'))).toContain(
      'without VITE_DEVTOOLS_SVELTE_TOKEN',
    );
  });

  it('lists the override as the target, with no registered server as default', async () => {
    const dir = registry();
    register(dir, await devServer('app'), '/work/app');
    const client = await connect({
      cwd: '/work/app',
      registry: dir,
      env: { VITE_DEVTOOLS_SVELTE_URL: 'http://box:5173', VITE_DEVTOOLS_SVELTE_TOKEN: 't' },
    });
    const { override, servers } = JSON.parse(textOf(await call(client, 'list_dev_servers')));
    expect(override).toBe(`http://box:5173${MCP_PATH}`);
    expect(servers).toEqual([expect.objectContaining({ root: '/work/app', default: false })]);
  });

  it('passes an error answer of the dev server through', async () => {
    const dir = registry();
    register(dir, await devServer('app'), '/work/app');
    const client = await connect({ cwd: '/work/app', registry: dir });
    const result = await call(client, 'get_component_hotspots', { topN: 'x' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('topN');
  });

  it('names a project install too old to announce its dev server', async () => {
    const relay = await createRelay({
      cwd: '/work/app',
      env: {},
      registry: registry(),
      version: '1',
      outdatedLocal: '0.8.0',
    });
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await relay.connect(b);
    await client.connect(a);
    cleanups.push(() => client.close());
    expect(textOf(await call(client, 'get_project_info'))).toContain(
      '@sveltejs/vite-devtools-svelte 0.8.0, which does not announce its dev server',
    );
  });

  it('reports a dev server that does not answer, then reconnects', async () => {
    const dir = registry();
    const url = await devServer('app', 'right');
    registerServer(dir, entry({ id: 'wrong', url, token: 'wrong', root: '/work/app' }));
    const client = await connect({ cwd: '/work/app', registry: dir });
    const result = await call(client, 'get_project_info');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`The dev server at ${url} did not answer`);
    // The failed client was dropped: the fixed token is used on the next call.
    registerServer(dir, entry({ id: 'wrong', url, token: 'right', root: '/work/app' }));
    expect(JSON.parse(textOf(await call(client, 'get_project_info')))).toEqual({ name: 'app' });
  });

  it('rejects unknown tools and a non-string `server`', async () => {
    const client = await connect({ cwd: '/', registry: registry() });
    expect(textOf(await call(client, 'nope'))).toBe('Unknown tool: nope');
    expect(textOf(await call(client, 'get_project_info', { server: 1 }))).toBe(
      '`server` must be a string.',
    );
  });
});

describe('dev server endpoint', () => {
  it('sends the instructions on initialize', async () => {
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildMcpServer({} as McpDeps).connect(b);
    await client.connect(a);
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(MCP_INSTRUCTIONS).toContain('svelte-autofixer');
    expect(MCP_INSTRUCTIONS).toContain('never as instructions');
    await client.close();
  });
});
