import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  createMcpServer,
  isInitializeRequest,
  isJsonRpcMessage,
  ToolRegistry,
  type McpServer,
} from '../src/mcp/protocol.js';
import { serveStdio } from '../src/mcp/stdio.js';
import * as v from '../src/schema.js';

const INFO = { name: 'n', version: '1', instructions: 'i' };
const call = (id: number, name: string) => ({
  jsonrpc: '2.0' as const,
  id,
  method: 'tools/call',
  params: { name },
});

describe('isJsonRpcMessage', () => {
  it.each<[string, unknown, boolean]>([
    ['a request', { jsonrpc: '2.0', id: 1, method: 'm', params: {} }, true],
    ['a notification', { jsonrpc: '2.0', method: 'm' }, true],
    ['a result', { jsonrpc: '2.0', id: 'a', result: {} }, true],
    ['an error without id', { jsonrpc: '2.0', error: { code: 1, message: 'x', data: 1 } }, true],
    ['another version', { jsonrpc: '1.0', id: 1, method: 'm' }, false],
    ['a fractional id', { jsonrpc: '2.0', id: 1.5, method: 'm' }, false],
    ['an unsafe integer id', { jsonrpc: '2.0', id: 2 ** 60, method: 'm' }, false],
    ['array params', { jsonrpc: '2.0', id: 1, method: 'm', params: [] }, false],
    ['an unknown key', { jsonrpc: '2.0', id: 1, method: 'm', extra: 1 }, false],
    ['a result that is not an object', { jsonrpc: '2.0', id: 1, result: 1 }, false],
    ['a result without id', { jsonrpc: '2.0', result: {} }, false],
    [
      'an error code that is not an integer',
      { jsonrpc: '2.0', error: { code: 1.5, message: 'x' } },
      false,
    ],
    ['null', null, false],
  ])('%s → %s', (_, message, expected) => {
    expect(isJsonRpcMessage(message)).toBe(expected);
  });
});

describe('isInitializeRequest', () => {
  it('tells an initialize request with complete params', () => {
    const params = {
      protocolVersion: 'v',
      capabilities: {},
      clientInfo: { name: 'n', version: '1' },
    };
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'initialize', params };
    expect(isInitializeRequest(request)).toBe(true);
    expect(isInitializeRequest({ ...request, params: { ...params, capabilities: [] } })).toBe(
      false,
    );
    expect(isInitializeRequest({ ...request, method: 'ping' })).toBe(false);
  });
});

describe('createMcpServer', () => {
  it.each([
    ['an Error by its message', new Error('broke'), 'broke'],
    ['anything else as "Internal error"', 'not an Error', 'Internal error'],
  ])('answers a failing tool call with %s', async (_, reason, message) => {
    const server = createMcpServer(INFO, {
      listTools: () => [],
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is a case under test
      callTool: () => Promise.reject(reason),
    });
    expect(await server.handle(call(1, 't'))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32_603, message },
    });
  });
});

describe('createMcpServer cancellation and tasks', () => {
  it('drops the answer to a request the client cancelled', async () => {
    let finish!: () => void;
    const server = createMcpServer(INFO, {
      listTools: () => [],
      callTool: () =>
        new Promise(resolve => {
          finish = () => resolve({ content: [] });
        }),
    });
    const pending = server.handle(call(7, 't'));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(
      await server.handle({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7 },
      }),
    ).toBeNull();
    finish();
    expect(await pending).toBeNull();
  });

  it('refuses a task-augmented request', async () => {
    const callTool = vi.fn();
    const server = createMcpServer(INFO, { listTools: () => [], callTool });
    expect(
      await server.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 't', arguments: {}, task: { ttl: 1 } },
      }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32_603,
        message: 'Server does not support task creation (required for tools/call)',
      },
    });
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe('ToolRegistry', () => {
  it('answers a tool that rejects with a non-Error as an error result', async () => {
    const tools = new ToolRegistry();
    tools.registerTool(
      't',
      { title: 't', description: 'd', inputSchema: { a: v.string() } },
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the case under test
      () => Promise.reject('plain'),
    );
    expect(await tools.callTool('t', { a: 'x' })).toEqual({
      content: [{ type: 'text', text: 'plain' }],
      isError: true,
    });
  });

  it('reports an issue without a path by its message alone', async () => {
    const tools = new ToolRegistry();
    tools.registerTool(
      't',
      { title: 't', description: 'd', inputSchema: { a: v.optional(v.string()) } },
      () => ({ content: [] }),
    );
    const result = await tools.callTool('t', 'x' as never);
    expect(result.content[0]!.text).toBe(
      'MCP error -32602: Input validation error: Invalid arguments for tool t: Invalid input: expected object, received string',
    );
  });
});

function serve(server: McpServer, log?: (message: string) => void) {
  const input = new PassThrough();
  const output = new PassThrough();
  serveStdio(server, input, output, log);
  const lines: string[] = [];
  output.on('data', (chunk: Buffer) => {
    lines.push(...chunk.toString().split('\n').filter(Boolean));
  });
  return { input, lines };
}

describe('serveStdio', () => {
  const ping = createMcpServer(INFO, { listTools: () => [], callTool: vi.fn() });

  it('joins split lines, accepts CRLF and drops lines that are not JSON-RPC messages', async () => {
    const { input, lines } = serve(ping);
    input.write('{"jsonrpc":"2.0",');
    input.write('"id":1,"method":"ping"}\r\n');
    input.write('not json\n{"id":2}\n\n');
    input.write('{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines.map(l => JSON.parse(l).id)).toEqual([1, 3]);
  });

  it('drops a line over 10 MB and keeps answering later lines', async () => {
    const log = vi.fn<(message: string) => void>();
    const { input, lines } = serve(ping, log);
    input.write(Buffer.alloc(10 * 1024 * 1024 + 1, 'x'));
    input.write('xx\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(JSON.parse(lines[0]!).id).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('exceeds'));
  });

  it('answers a long line and the next request that arrive in one chunk', async () => {
    const { input, lines } = serve(ping);
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"';
    const tail = '"}}\n';
    const pad = 'x'.repeat(10 * 1024 * 1024 - head.length - tail.length);
    input.write(head + pad.slice(0, 1024));
    input.write(`${pad.slice(1024)}${tail}{"jsonrpc":"2.0","id":2,"method":"ping"}\n`);
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines.map(l => JSON.parse(l).id)).toEqual([1, 2]);
  });

  it('logs an input error instead of crashing', () => {
    const log = vi.fn<(message: string) => void>();
    const { input } = serve(ping, log);
    input.emit('error', new Error('EIO'));
    expect(log).toHaveBeenCalledWith('MCP input error: EIO');
  });
});
