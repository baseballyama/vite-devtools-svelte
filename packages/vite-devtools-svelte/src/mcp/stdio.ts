import type { Readable, Writable } from 'node:stream';

import { isJsonRpcMessage, type JsonRpcMessage, type McpServer } from './protocol.js';

const MAX_LINE_BYTES = 10 * 1024 * 1024;

const logError = (message: string) => {
  process.stderr.write(`[vite-devtools-svelte] ${message}\n`);
};

/** Serves newline-delimited JSON-RPC; a line that is not a JSON-RPC message is dropped. */
export function serveStdio(
  server: McpServer,
  input: Readable,
  output: Writable,
  log: (message: string) => void = logError,
): void {
  const answer = async (message: JsonRpcMessage) => {
    const response = await server.handle(message);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  };
  const answerLine = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (isJsonRpcMessage(message)) void answer(message);
  };
  // The unterminated line, kept as chunks so a long line is joined once.
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  // A client that never ends a line would grow `pending` without bound, so a
  // line over the limit is discarded up to its newline.
  let skipping = false;
  input.on('data', (chunk: Buffer) => {
    let start = 0;
    for (let end = chunk.indexOf(0x0a); end !== -1; end = chunk.indexOf(0x0a, start)) {
      if (!skipping) answerLine(Buffer.concat([...pending, chunk.subarray(start, end)]).toString());
      pending = [];
      pendingBytes = 0;
      skipping = false;
      start = end + 1;
    }
    if (skipping || start === chunk.length) return;
    pendingBytes += chunk.length - start;
    if (pendingBytes > MAX_LINE_BYTES) {
      pending = [];
      pendingBytes = 0;
      skipping = true;
      log(`MCP input line exceeds ${MAX_LINE_BYTES} bytes; dropped`);
      return;
    }
    pending.push(chunk.subarray(start));
  });
  // An unhandled 'error' event would crash the relay.
  input.on('error', e => {
    log(`MCP input error: ${e.message}`);
  });
}
