import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { PassThrough, pipeline, Writable } from 'node:stream';
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

// Like browsers (and undici): a body cut short or missing its trailer still
// yields what arrived, and an empty compressed body is an empty body.
const ZLIB = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
const BROTLI = {
  flush: zlib.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
};

/** Undoes one content coding: the decoded stream of `source`; a failure of either reaches its reader. */
type Decoder = (source: Readable) => Readable;

/**
 * `deflate` as servers really send it: zlib-wrapped as the spec says, or
 * raw. The first byte tells them apart (a zlib header's low nibble is 8,
 * the deflate method).
 */
const inflate: Decoder = source => {
  const output = new PassThrough();
  let inner: zlib.Inflate | zlib.InflateRaw | undefined;
  const input = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!inner) {
        inner =
          (chunk[0]! & 0x0f) === 0x08 ? zlib.createInflate(ZLIB) : zlib.createInflateRaw(ZLIB);
        // the reader stopping (or a bad stream) ends the input, and so the source
        pipeline(inner, output, error => {
          if (error) input.destroy(error);
        });
      }
      // Takes the next chunk once this one is inflated, which waits while
      // the reader is behind: the still compressed body stays in the socket
      // instead of piling up here.
      inner.write(chunk, callback);
    },
    final(callback) {
      if (inner) inner.end();
      else output.end(); // an empty body
      callback();
    },
  });
  pipeline(source, input, error => {
    if (error) output.destroy(error);
  });
  return output;
};

const DECODERS: Partial<Record<string, Decoder>> = {
  gzip: source => pipeline(source, zlib.createGunzip(ZLIB), ignore),
  'x-gzip': source => pipeline(source, zlib.createGunzip(ZLIB), ignore),
  deflate: inflate,
  br: source => pipeline(source, zlib.createBrotliDecompress(BROTLI), ignore),
};

/**
 * The body decoded as `content-encoding` says (the codings undone last
 * to first), or an error for a coding it cannot undo: the bytes as they
 * are would only parse as a garbled page.
 */
function decoded(res: http.IncomingMessage): Readable | Error {
  const codings = (res.headers['content-encoding'] ?? '')
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(c => c !== '' && c !== 'identity');
  const decoders: Decoder[] = [];
  for (const coding of codings.toReversed()) {
    const decoder = DECODERS[coding];
    if (!decoder) return new Error(`Unsupported content-encoding: ${coding}`);
    decoders.push(decoder);
  }
  return decoders.reduce<Readable>((body, decode) => decode(body), res);
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
        const body = decoded(res);
        if (body instanceof Error) {
          res.destroy();
          reject(body);
          return;
        }
        // A body nobody reads (a redirect's) fails once the request is
        // aborted, and with no listener that failure is an uncaught
        // exception. A reader still gets it from the iteration.
        body.on('error', ignore);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
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
