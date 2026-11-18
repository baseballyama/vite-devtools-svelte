import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createMcpFetchHandler } from '@devframes/agentic/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHostContext } from 'devframe/node';
import type { Plugin } from 'vite';
import { describe, it, expect, vi } from 'vitest';

import { registerAgentTools } from '../src/mcp/server.js';
import { svelteDevtools } from '../src/plugin.js';
import { mcpDeps } from '../src/server/devframe.js';
import { callHook, createTestHost, resolvePlugins } from './helpers.js';

const kit = vi.hoisted(() => ({
  createPluginFromDevframe: vi.fn((def: any) => ({
    devtools: { setup: (ctx: unknown) => def.setup(ctx) },
  })),
}));
vi.mock('@vitejs/devtools-kit/node', () => kit);

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');
const ORIGIN = 'http://localhost';
const SUBSCRIPTION = 'svelte-devtools:subscription';

type Result = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** Through devframe's own MCP adapter, so names, schemas and errors are what clients see. */
async function connect() {
  const ctx = await createHostContext({
    cwd: os.tmpdir(),
    mode: 'dev',
    host: {
      mountStatic: () => {},
      resolveOrigin: () => ORIGIN,
      getStorageDir: () => os.tmpdir(),
    },
  });
  const beforeCall = vi.fn(() => Promise.resolve());
  const unregister = registerAgentTools(ctx.agent, mcpDeps(createTestHost(FIXTURES)), {
    namespace: 'svelte-devtools',
    beforeCall,
  });
  const handler = createMcpFetchHandler(ctx, {
    serverName: 'test',
    serverVersion: '0',
    exposeSharedState: false,
  });
  const transport = new StreamableHTTPClientTransport(new URL('/__mcp', ORIGIN), {
    fetch: (url, init) => {
      const req = new Request(url, init);
      req.headers.set('origin', ORIGIN);
      return handler.fetch(req);
    },
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name: `svelte-devtools_${name}`, arguments: args })) as Result;
  return { client, call, beforeCall, unregister };
}

describe("the tools on devframe's MCP route", () => {
  it('lists the 20 tools under the svelte-devtools prefix, with flat object inputs', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(20);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^svelte-devtools_[a-z_]+$/);
      expect(tool.inputSchema.type).toBe('object');
    }
    const byName = new Map(tools.map(t => [t.name, t]));
    expect(byName.get('svelte-devtools_get_routes')!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('svelte-devtools_delete_session')!.annotations?.destructiveHint).toBe(true);
  });

  it('answers with the same text as the HTTP endpoint, after the lease', async () => {
    const { call, beforeCall } = await connect();
    const result = await call('get_routes');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).length).toBeGreaterThan(0);
    expect(beforeCall).toHaveBeenCalledOnce();
  });

  it('rejects invalid input before the lease, and reports tool errors', async () => {
    const { call, beforeCall } = await connect();
    expect((await call('get_render_profile', { file: 42 })).isError).toBe(true);
    expect(beforeCall).not.toHaveBeenCalled();
    const missing = await call('load_session', { id: 's_abc_123456' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toMatch('Session not found: s_abc_123456');
  });

  it('unregisters every tool', async () => {
    const { client, unregister } = await connect();
    unregister();
    expect((await client.listTools()).tools).toEqual([]);
  });
});

function setUpPlugin() {
  const plugins: Plugin[] = svelteDevtools();
  resolvePlugins(plugins, { root: FIXTURES, plugins: [{ name: 'vite:devtools' }] });
  const listeners = new Map<string, (payload: unknown) => void>();
  const server = {
    hot: {
      on: (event: string, fn: (payload: unknown) => void) => listeners.set(event, fn),
      off: vi.fn(),
      send: vi.fn(),
    },
    middlewares: { use: vi.fn() },
    // an unlistened http.Server: the plugin only reads its events and address
    httpServer: Object.assign(http.createServer(), { address: () => null }),
    watcher: { on: vi.fn() },
    config: { server: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    environments: {},
  };
  callHook(plugins[0]!.configureServer, server);
  const tools = new Map<string, { handler: (args: unknown) => Promise<unknown> }>();
  const unregistered: string[] = [];
  const ctx = {
    scope: () => ({ rpc: { register: () => {}, broadcast: () => Promise.resolve() } }),
    agent: {
      registerTool: (tool: { id: string; handler: (args: unknown) => Promise<unknown> }) => {
        tools.set(tool.id, tool);
        return { unregister: () => unregistered.push(tool.id) };
      },
    },
  };
  return {
    tools,
    unregistered,
    runSetup: () => (plugins[0]!.devtools as any).setup(ctx),
    subscriptions: () => server.hot.send.mock.calls.filter(([event]) => event === SUBSCRIPTION),
    /** The runtime's activation snapshot ends with a `reset: true` timeline. */
    sendSnapshot: () =>
      listeners.get('svelte-devtools:state-timeline')!({ epoch: 'e1', reset: true, changes: [] }),
  };
}

describe('the devframe setup registers them', () => {
  it('a second setup (dev-server restart) unregisters the previous tools first', async () => {
    const s = setUpPlugin();
    await s.runSetup();
    expect(s.tools.size).toBe(20);
    expect(s.unregistered).toEqual([]);
    await s.runSetup();
    expect(s.unregistered.toSorted()).toEqual([...s.tools.keys()].toSorted());
  });

  it('the first call leases the runtime and awaits its snapshot', async () => {
    const s = setUpPlugin();
    await s.runSetup();
    const call = () => s.tools.get('svelte-devtools:get_project_info')!.handler({});
    let snapshotSent = false;
    const first = call().then(res => {
      expect(snapshotSent).toBe(true);
      return res;
    });
    await vi.waitFor(() =>
      expect(s.subscriptions()).toEqual([[SUBSCRIPTION, { active: true, componentDeltas: true }]]),
    );
    snapshotSent = true;
    s.sendSnapshot();
    await first;
    // already leased: a second call is answered without waiting for a snapshot
    await call();
    expect(s.subscriptions()).toHaveLength(1);
  });
});
