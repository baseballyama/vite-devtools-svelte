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
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const v of Array.isArray(value) ? value : [value ?? '']) headers.append(name, v);
        }
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          // a status a `Response` cannot hold
          res.destroy();
          reject(new RangeError(`Unsupported HTTP status ${status}`));
          return;
        }
        const empty = NULL_BODY.has(status);
        if (empty) res.resume();
        const body = empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, statusText: res.statusMessage, headers }));
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
