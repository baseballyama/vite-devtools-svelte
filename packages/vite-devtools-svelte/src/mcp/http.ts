import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Logger } from 'vite';

import type { Collector } from '../server/collector.js';

export const MCP_PATH = '/__svelte-devtools/mcp';

/**
 * Constant-time for equal lengths (the length is not secret: every token is a
 * UUID). A repeated header (string array) is never accepted.
 */
export function isValidMcpToken(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== 'string') return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const describe = (e: unknown) => (e instanceof Error ? (e.stack ?? e.message) : String(e));

/** Same-origin is not required: MCP clients are local processes, not browser tabs; the token is the gate. */
export function createMcpMiddleware(opts: {
  token: string;
  collector: Collector;
  logger: Logger;
  createServer: () => McpServer;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const { token, collector, logger } = opts;
  const fail = (res: ServerResponse, e: unknown) => {
    logger.error(`[svelte-devtools] MCP handler error: ${describe(e)}`);
    if (res.headersSent) return;
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(e) }));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!isValidMcpToken(req.headers['x-svelte-devtools-token'], token)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    // Keep the runtime sampling; if this request woke it up, wait for its
    // activation snapshot so the first answer isn't stale.
    if (collector.lease('mcp', 60_000)) await collector.waitForSnapshot(1000);
    // Stateless mode in the SDK still keeps per-instance bookkeeping that gets
    // corrupted when one transport handles multiple requests.
    const server = opts.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the MCP transport is not an EventTarget; `onerror` is its only error hook
    transport.onerror = err => {
      logger.error(`[svelte-devtools] MCP transport error: ${describe(err)}`);
    };
    try {
      await server.connect(transport);
      // The SDK consumes the request body itself; pre-reading would leave it empty.
      await transport.handleRequest(req, res);
    } catch (e) {
      fail(res, e);
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };

  // Connect ignores the returned promise: answer on rejection instead of leaving the client hanging.
  return (req, res) => {
    handle(req, res).catch((e: unknown) => fail(res, e));
  };
}
