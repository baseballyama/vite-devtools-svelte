/**
 * The API playground's request, sent by the browser itself.
 *
 * The DevTools UI is served by the app's own dev server, so a request from
 * here is same-origin with the app: the browser attaches the app's cookies
 * (httpOnly ones included), and `Set-Cookie` lands in the browser like it
 * would for the app. A cross-origin URL works only where its CORS policy
 * allows it, and never carries the app's cookies.
 */

export interface ApiRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Ignored for GET and HEAD, which cannot carry a body. */
  body: string;
}

export interface ApiResponse {
  /** 0 when no response arrived (network, CORS, timeout, stopped); `statusText` then says why. */
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** Body bytes received (as sent, before decoding). */
  size: number;
  /** Milliseconds until the body was read (or reading stopped). */
  duration: number;
  /** The URL that answered: differs from the request after a redirect. */
  url: string;
  redirected: boolean;
  /**
   * Why the body stopped early, null when it was read to the end: over
   * {@link MAX_BODY_BYTES}, stopped by the user (an endless stream such as
   * SSE ends this way), or the connection failed midway.
   */
  truncated: Truncation | null;
}

export type Truncation = 'size' | 'stopped' | 'error';

/**
 * Longest wait for the response headers. The body has no time limit: it
 * streams until it ends, the caller stops it, or it reaches `maxBytes`.
 */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Body bytes kept for display; a longer (or endless) body is cut here. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface SendOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Aborting it stops the request: before the headers it fails, after them the body ends. */
  signal?: AbortSignal;
  /** Called once the headers arrive and after every body chunk, with the response so far. */
  onProgress?: (res: ApiResponse) => void;
}

export async function sendRequest(
  req: ApiRequest,
  {
    timeoutMs = REQUEST_TIMEOUT_MS,
    maxBytes = MAX_BODY_BYTES,
    signal,
    onProgress,
  }: SendOptions = {},
): Promise<ApiResponse> {
  const start = performance.now();
  const duration = () => Math.round((performance.now() - start) * 100) / 100;
  const controller = new AbortController();
  const stop = () => {
    controller.abort(new Error('Stopped'));
  };
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new Error(`No response within ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const init: RequestInit = {
      method: req.method,
      headers: req.headers,
      signal: controller.signal,
    };
    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
    let res: Response;
    try {
      res = await fetch(req.url, init);
    } catch (e) {
      return failure(req.url, reason(e, controller.signal, req.url), duration());
    } finally {
      clearTimeout(timer);
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const head: ApiResponse = {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: '',
      size: 0,
      duration: duration(),
      url: res.url || req.url,
      redirected: res.redirected,
      truncated: null,
    };
    onProgress?.(head);
    const { text, bytes, cut } = await readCapped(res, maxBytes, (body, size) => {
      onProgress?.({ ...head, body, size, duration: duration() });
    });
    return {
      ...head,
      body: text,
      size: bytes,
      duration: duration(),
      truncated: cut === 'error' && controller.signal.aborted ? 'stopped' : cut,
    };
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * The body as text, at most `maxBytes` of it, reporting the text so far
 * after every chunk. A body that fails midway (the user stopping an endless
 * stream such as SSE) keeps what arrived.
 */
async function readCapped(
  res: Response,
  maxBytes: number,
  onText: (text: string, bytes: number) => void,
): Promise<{ text: string; bytes: number; cut: Truncation | null }> {
  if (!res.body) return { text: '', bytes: 0, cut: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let cut: Truncation | null = null;
  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a stream is read chunk by chunk
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        // `stream`: a character split by the cap stays pending, then dropped below.
        text += decoder.decode(value.subarray(0, maxBytes - bytes), { stream: true });
        bytes = maxBytes;
        cut = 'size';
        break;
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      onText(text, bytes);
    }
  } catch {
    cut = 'error';
  }
  // Stop the rest of the transfer; a source that fails to cancel changes nothing here.
  if (cut === 'size') await reader.cancel().then(undefined, ignore);
  // Flush only a body read to its end; a cut one ends at its last whole character.
  return { text: cut === null ? text + decoder.decode() : text, bytes, cut };
}

function ignore(): void {}

function reason(e: unknown, signal: AbortSignal, url: string): string {
  if (signal.aborted) return (signal.reason as Error).message;
  const message = e instanceof Error ? e.message : String(e);
  return crossOrigin(url)
    ? `${message} (a cross-origin URL answers only if its CORS policy allows this origin)`
    : message;
}

function crossOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

function failure(url: string, statusText: string, duration: number): ApiResponse {
  return {
    status: 0,
    statusText,
    headers: {},
    body: '',
    size: 0,
    duration,
    url,
    redirected: false,
    truncated: null,
  };
}
