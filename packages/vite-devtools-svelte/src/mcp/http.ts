import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Logger } from 'vite';

import type { Collector } from '../server/collector.js';
import {
  isInitializeRequest,
  isJsonRpcMessage,
  PROTOCOL_VERSIONS,
  type McpServer,
} from './protocol.js';

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

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_BATCH = 100;

/** The body as text, or `null` when it is over `MAX_BODY_BYTES`. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) {
        chunks.push(chunk);
        return;
      }
      // Answer 413 now; the rest of the upload is drained, not awaited.
      req.off('data', onData);
      req.off('end', onEnd);
      req.resume();
      resolve(null);
    };
    // TextDecoder strips a leading BOM, which JSON.parse rejects.
    const onEnd = () => resolve(new TextDecoder().decode(Buffer.concat(chunks)));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Stateless Streamable HTTP: one JSON answer per POST, no sessions and no
 * server-initiated messages. Status codes and messages match the
 * @modelcontextprotocol/sdk transport so SDK clients interoperate.
 */
async function serve(
  server: McpServer,
  req: IncomingMessage,
  res: ServerResponse,
  log: (message: string) => void,
) {
  const refuse = (status: number, code: number, message: string) => {
    log(message);
    send(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
  };
  const accept = req.headers.accept;
  if (!accept?.includes('application/json') || !accept.includes('text/event-stream')) {
    refuse(
      406,
      -32_000,
      'Not Acceptable: Client must accept both application/json and text/event-stream',
    );
    return;
  }
  const type = req.headers['content-type']?.split(';', 1)[0]!.trim().toLowerCase();
  if (type !== 'application/json') {
    refuse(415, -32_000, 'Unsupported Media Type: Content-Type must be application/json');
    return;
  }
  const body = await readBody(req);
  if (body === null) {
    refuse(413, -32_000, `Payload Too Large: Request body must not exceed ${MAX_BODY_BYTES} bytes`);
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    refuse(400, -32_700, 'Parse error: Invalid JSON');
    return;
  }
  if (Array.isArray(raw) && raw.length > MAX_BATCH) {
    refuse(400, -32_600, `Invalid Request: Batch must not exceed ${MAX_BATCH} messages`);
    return;
  }
  const messages: unknown[] = Array.isArray(raw) ? raw : [raw];
  if (!messages.every(isJsonRpcMessage)) {
    refuse(400, -32_700, 'Parse error: Invalid JSON-RPC message');
    return;
  }
  if (messages.some(isInitializeRequest)) {
    if (messages.length > 1) {
      refuse(400, -32_600, 'Invalid Request: Only one initialization request is allowed');
      return;
    }
  } else {
    const version = req.headers['mcp-protocol-version'];
    if (typeof version === 'string' && !PROTOCOL_VERSIONS.includes(version)) {
      refuse(
        400,
        -32_000,
        `Bad Request: Unsupported protocol version: ${version} (supported versions: ${PROTOCOL_VERSIONS.join(', ')})`,
      );
      return;
    }
  }
  const answers = await Promise.all(messages.map(m => server.handle(m)));
  const responses = answers.filter(a => a !== null);
  if (responses.length === 0) send(res, 202);
  else send(res, 200, responses.length === 1 ? responses[0] : responses);
}

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
    send(res, 500, { error: String(e) });
  };
  const logRefusal = (message: string) => {
    logger.error(`[svelte-devtools] MCP transport error: ${message}`);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!isValidMcpToken(req.headers['x-svelte-devtools-token'], token)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    // No server-initiated messages, so no GET SSE stream. Clients take 405 as "no stream".
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      send(res, 405);
      return;
    }
    // Keep the runtime sampling; if this request woke it up, wait for its
    // activation snapshot so the first answer isn't stale.
    if (collector.lease('mcp', 60_000)) await collector.waitForSnapshot(1000);
    await serve(opts.createServer(), req, res, logRefusal);
  };

  // Connect ignores the returned promise: answer on rejection instead of leaving the client hanging.
  return (req, res) => {
    handle(req, res).catch((e: unknown) => fail(res, e));
  };
}
