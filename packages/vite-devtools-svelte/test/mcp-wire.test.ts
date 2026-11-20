import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { Logger } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { createMcpMiddleware } from '../src/mcp/http.js';
import type { McpServer } from '../src/mcp/protocol.js';
import { createRelay } from '../src/mcp/relay.js';
import { buildMcpServer, type McpDeps } from '../src/mcp/server.js';
import { SessionStore } from '../src/mcp/sessions.js';
import { serveStdio } from '../src/mcp/stdio.js';
import type { Collector } from '../src/server/collector.js';

// The exact bytes MCP clients get, which must match the
// @modelcontextprotocol/sdk server so SDK clients interoperate.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vds-wire-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const deps: McpDeps = {
  getProject: () => ({ name: 'app' }) as never,
  getRoutes: () => {
    throw new Error('routes failed');
  },
  getLiveSnapshot: () => ({ epoch: 'e1', total: 1, components: [] }),
  getComponentRelations: () => [],
  getRenderProfiles: () => [],
  getReactiveGraph: () => Promise.resolve({ nodes: [], edges: [] }),
  getLoadProfiles: () => [],
  getFpsSamples: () => [],
  sessions: new SessionStore({
    persistDir: path.join(dir, 'sessions'),
    getters: { getRenderProfiles: () => [], getLoadProfiles: () => [], getFpsSamples: () => [] },
  }),
  getReactiveSummary: () => Promise.resolve({} as never),
  getReactiveScope: () => Promise.resolve({} as never),
  getStateTimelineDelta: () => ({ cursor: 0, reset: false, changes: [] }),
  getCaptureInfo: () => ({}),
};

const normalize = (s: string) => s.replaceAll(`"version":"${pkg.version}"`, '"version":"<pkg>"');

/** Feeds raw messages to a server over stdio and returns the lines it writes back. */
async function exchange(server: McpServer, messages: object[]): Promise<string[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  serveStdio(server, input, output);
  const out: string[] = [];
  output.on('data', (chunk: Buffer) => {
    out.push(...chunk.toString().split('\n').filter(Boolean).map(normalize));
  });
  for (const m of messages) {
    const answered = out.length + ('id' in m && 'method' in m ? 1 : 0);
    input.write(`${JSON.stringify(m)}\n`);
    await vi.waitFor(() => {
      if (out.length < answered) throw new Error('no answer yet');
    });
  }
  return out;
}

const json = (m: object) => JSON.stringify(m);
const rpc = (id: number, method: string, params?: object) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params && { params }),
});
const callTool = (id: number, name: string, args: object = {}) =>
  rpc(id, 'tools/call', { name, arguments: args });
const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'wire', version: '1' },
};

const SESSION = [
  rpc(1, 'initialize', INIT),
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  rpc(2, 'initialize', { ...INIT, protocolVersion: '1999-01-01' }),
  rpc(3, 'ping'),
  rpc(4, 'tools/list'),
  rpc(5, 'resources/list'),
];

const MALFORMED = [
  rpc(11, 'initialize', {}),
  rpc(12, 'initialize'),
  rpc(13, 'tools/list', { cursor: 1 }),
  rpc(14, 'tools/call', {}),
  rpc(15, 'tools/call'),
  rpc(16, 'tools/call', { name: 'get_project_info', arguments: [] }),
  rpc(17, 'tools/call', { name: 'get_project_info', arguments: null }),
  rpc(18, 'notifications/cancelled', { requestId: 1 }),
  { jsonrpc: '2.0', id: 'str', method: 'ping', params: { x: 1 } },
  { jsonrpc: '2.0', id: 19, result: {} },
  { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
];

describe('dev server endpoint', () => {
  it('answers the protocol methods', async () => {
    expect(await exchange(buildMcpServer(deps), SESSION)).toMatchSnapshot();
  });

  it('answers malformed requests', async () => {
    expect(await exchange(buildMcpServer(deps), MALFORMED)).toMatchSnapshot();
  });

  it('answers tool calls', async () => {
    const out = await exchange(buildMcpServer(deps), [
      callTool(1, 'get_project_info'),
      callTool(2, 'get_component_hotspots', { topN: 'x' }),
      callTool(3, 'get_component_hotspots', { topN: 0, extra: true }),
      callTool(4, 'load_session', { id: '../x' }),
      callTool(5, 'nope'),
      callTool(6, 'get_routes'),
      callTool(7, 'get_reactive_scope', { componentId: 1 }),
      rpc(8, 'tools/call', { name: 'get_project_info' }),
      callTool(9, 'start_session', {}),
    ]);
    expect(out).toMatchSnapshot();
  });
});

describe('relay', () => {
  it('answers the protocol methods and its own tool errors', async () => {
    const relay = createRelay({
      cwd: '/work/app',
      env: {},
      registry: path.join(dir, 'registry'),
      version: '1.2.3',
    });
    const out = await exchange(relay, [
      ...SESSION,
      callTool(6, 'list_dev_servers'),
      callTool(7, 'nope'),
      callTool(8, 'get_project_info', { server: 1 }),
      callTool(9, 'get_project_info'),
      ...MALFORMED,
    ]);
    expect(out).toMatchSnapshot();
  });
});

describe('HTTP endpoint', () => {
  const TOKEN = 'tok';
  const logger = { error: vi.fn() } as unknown as Logger;
  let url: string;
  const server = http.createServer(
    createMcpMiddleware({
      token: TOKEN,
      collector: { lease: () => false } as unknown as Collector,
      logger,
      createServer: () => buildMcpServer(deps),
    }),
  );
  afterAll(
    () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );

  async function post(body: string, headers: Record<string, string> = {}) {
    url ??= await new Promise<string>(resolve => {
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`),
      );
    });
    const res = await fetch(url, {
      method: headers.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-svelte-devtools-token': TOKEN,
        ...headers,
      },
      body: headers.method === 'GET' ? undefined : body,
    });
    return {
      status: res.status,
      type: res.headers.get('content-type'),
      allow: res.headers.get('allow'),
      body: normalize(await res.text()),
    };
  }
  it('answers requests, notifications and batches', async () => {
    expect([
      await post(json(rpc(1, 'initialize', INIT))),
      await post(json({ jsonrpc: '2.0', method: 'notifications/initialized' })),
      await post(json(rpc(2, 'tools/list'))),
      await post(json(callTool(3, 'get_project_info'))),
      await post(json(callTool(4, 'nope'))),
      await post(json([rpc(5, 'ping'), rpc(6, 'resources/list')])),
      await post(json([rpc(7, 'ping')])),
      await post(json({ jsonrpc: '2.0', id: 9, result: {} })),
      await post(json(rpc(8, 'ping')), { 'mcp-protocol-version': '2025-06-18' }),
    ]).toMatchSnapshot();
  });

  it('refuses malformed requests', async () => {
    expect([
      await post(json(rpc(1, 'ping')), { accept: 'application/json' }),
      await post(json(rpc(1, 'ping')), { 'content-type': 'text/plain' }),
      await post('{not json'),
      await post(json({ id: 1 })),
      await post(json(rpc(1, 'ping')), { 'mcp-protocol-version': '1999-01-01' }),
      await post(json([rpc(1, 'initialize', INIT), rpc(2, 'ping')])),
      await post(json(Array.from({ length: 101 }, (_, i) => rpc(i, 'ping')))),
      await post('', { method: 'GET' }),
      await post('', { method: 'DELETE' }),
      await post(json(rpc(1, 'ping')), { 'x-svelte-devtools-token': 'nope' }),
    ]).toMatchSnapshot();
  });
});
