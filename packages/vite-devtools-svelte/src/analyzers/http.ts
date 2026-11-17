import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { pipeline } from 'node:stream';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

/** Longest an outbound devtools request (OG preview) may take, body included. */
export const OUTBOUND_TIMEOUT_MS = 30_000;

export interface OutboundInit {
  headers?: Record<string, string>;
  /**
   * Resolves the host for the connection itself. A guard here checks the
   * very addresses the socket connects to, which a check before connecting
   * cannot: the connection would resolve the name again (DNS rebinding).
   */
  lookup?: LookupFunction;
  signal?: AbortSignal;
}

/**
 * What a GET answered. Deliberately not a fetch `Response`: that one
 * refuses statuses outside 200–599, some status texts and bodies on 204,
 * and a remote server decides all of those.
 */
export interface OutboundResponse {
  status: number;
  /** Lowercase names, as `node:http` gives them. */
  headers: http.IncomingHttpHeaders;
  /** The body, decompressed when it came gzip, deflate or brotli encoded. */
  body: Readable;
}

type Decoder = () => zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress;

/** Decoders for the `content-encoding`s a response may carry (servers send them unasked, too). */
const DECODERS: Partial<Record<string, Decoder>> = {
  gzip: () => zlib.createGunzip(),
  'x-gzip': () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

function decoded(res: http.IncomingMessage): Readable {
  const decoder = DECODERS[res.headers['content-encoding']?.trim().toLowerCase() ?? ''];
  // `pipeline` passes a failure of either stream on to the decoder's reader.
  return decoder ? pipeline(res, decoder(), ignore) : res;
}

function ignore(): void {}

/**
 * At most `maxBytes` of a body, and whether more was left (the rest is not
 * downloaded: the stream is destroyed). A body that fails midway rejects.
 */
export async function readCapped(
  body: Readable,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    if (size + chunk.byteLength > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - size));
      truncated = true;
      break; // leaving the loop destroys the stream
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  }
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
 * A GET over `node:http(s)`. Redirects are never followed. Unlike the
 * global `fetch`, it takes a `lookup`. An object, so tests can replace `get`.
 */
export const transport = {
  get(url: string, init: OutboundInit = {}): Promise<OutboundResponse> {
    return new Promise((resolve, reject) => {
      const client = new URL(url).protocol === 'https:' ? https : http;
      // A fresh connection every time: a pooled keep-alive socket was
      // resolved earlier, possibly by another lookup, and would skip this one.
      // (Without an agent, no proxy from the environment applies either.)
      const options: https.RequestOptions = {
        headers: init.headers,
        signal: init.signal,
        agent: false,
      };
      if (init.lookup) options.lookup = init.lookup;
      // Nothing here throws: a remote server controls the response, and a
      // throw in this event callback would take the dev server down.
      const req = client.get(url, options, res => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: decoded(res) });
      });
      // 101 Switching Protocols never becomes a response: without this the
      // request would wait for the timeout.
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        reject(new Error('Unexpected protocol upgrade'));
      });
      req.on('error', reject);
    });
  },
};

/**
 * GET that never follows redirects and gives up after `timeoutMs`, body
 * read (`read`) included. Without it a target that never answers left the
 * RPC pending forever. The request is aborted once `read` settles or the
 * time is up, so the rest of a body `read` left (a redirect's, say) is not
 * downloaded and its socket closes; the result rejects on time even if the
 * transfer ignores the abort.
 */
export async function fetchWithTimeout<T>(
  url: string,
  init: Omit<OutboundInit, 'signal'>,
  read: (res: OutboundResponse) => Promise<T>,
  timeoutMs = OUTBOUND_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const work = (async () => {
    const res = await transport.get(url, { ...init, signal: controller.signal });
    return read(res);
  })();
  // A late failure of the abandoned transfer must not surface as unhandled.
  work.catch(ignore);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
