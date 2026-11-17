import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/** Longest an outbound devtools request (OG preview) may take, body included. */
export const OUTBOUND_TIMEOUT_MS = 30_000;

export interface OutboundInit {
  headers?: Record<string, string>;
  /**
   * Resolves the host for the connection itself. A guard here checks the
   * very addresses the socket connects to, which a check before `fetch`
   * cannot: `fetch` resolves the name again (DNS rebinding).
   */
  lookup?: LookupFunction;
  signal?: AbortSignal;
}

/** Statuses whose response has no body (the `Response` constructor refuses one). */
const NULL_BODY = new Set([204, 205, 304]);

/** A `node:http` response as a fetch `Response`; throws when it cannot be one. */
function toResponse(res: http.IncomingMessage): Response {
  const status = res.statusCode ?? 0;
  // `Response` holds 200–599 only
  if (status < 200 || status > 599) throw new RangeError(`Unsupported HTTP status ${status}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    for (const v of Array.isArray(value) ? value : [value ?? '']) headers.append(name, v);
  }
  const empty = NULL_BODY.has(status);
  const response = new Response(
    empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
    { status, statusText: res.statusMessage, headers },
  );
  if (empty) res.resume();
  return response;
}

/**
 * At most `maxBytes` of a response body, and whether more was left
 * (the rest is cancelled, not downloaded).
 */
export async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  // Node's `Response` types its body loosely
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a stream is read chunk by chunk
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      truncated = true;
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  if (truncated) await reader.cancel().then(undefined, () => {});
  return { bytes: concat(chunks), truncated };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * A GET over `node:http(s)`, answered as a fetch `Response`. Redirects are
 * never followed. Unlike the global `fetch`, it takes a `lookup`. An object,
 * so tests can replace `get`.
 */
export const transport = {
  get(url: string, init: OutboundInit = {}): Promise<Response> {
    return new Promise((resolve, reject) => {
      const client = new URL(url).protocol === 'https:' ? https : http;
      // A fresh connection every time: a pooled keep-alive socket was
      // resolved earlier, possibly by another lookup, and would skip this one.
      const options: https.RequestOptions = {
        headers: init.headers,
        signal: init.signal,
        agent: false,
      };
      if (init.lookup) options.lookup = init.lookup;
      const req = client.get(url, options, res => {
        // This runs in an event callback: anything thrown here would be an
        // uncaught exception and take the dev server down. A remote server
        // controls the input (a status text `Response` refuses, such as one
        // containing DEL), so every failure becomes a rejection.
        try {
          resolve(toResponse(res));
        } catch (e) {
          res.destroy();
          reject(new Error(`Unreadable response: ${String(e)}`, { cause: e }));
        }
      });
      req.on('error', reject);
    });
  },
};

/**
 * GET that never follows redirects and gives up after `timeoutMs`, body
 * read (`read`) included. Without it a target that never answers left the
 * RPC pending forever. The request is aborted, and the result rejects even
 * if the transfer ignores the abort.
 */
export async function fetchWithTimeout<T>(
  url: string,
  init: Omit<OutboundInit, 'signal'>,
  read: (res: Response) => Promise<T>,
  timeoutMs = OUTBOUND_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const work = (async () => {
    const res = await transport.get(url, { ...init, signal: controller.signal });
    return read(res);
  })();
  // A late failure of the abandoned transfer must not surface as unhandled.
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
