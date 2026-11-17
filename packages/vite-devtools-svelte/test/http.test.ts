/**
 * The OG preview's outbound GET: `node:http` as a fetch Response, no
 * redirects, timeout, and a connection-time DNS guard (DNS rebinding).
 * Requests go to a local server; DNS answers are mocked.
 */
import type * as DnsModule from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  fetchWithTimeout,
  OUTBOUND_TIMEOUT_MS,
  readCapped,
  transport,
} from '../src/analyzers/http.js';
import { getOGPreview } from '../src/analyzers/og.js';
import { outboundLookup, publicOnlyLookup } from '../src/server/security.js';

type Answer = { address: string; family: number }[] | Error;
/** What each name resolves to, per lookup: the guard's (`node:dns`) and the pre-check's. */
const dnsAnswers = vi.hoisted(() => ({
  connect: new Map<string, Answer>(),
  precheck: new Map<string, Answer>(),
}));
vi.mock('node:dns', async importOriginal => {
  const real = await importOriginal<typeof DnsModule>();
  const lookup = (
    host: string,
    _options: unknown,
    callback: (err: Error | null, addresses?: { address: string; family: number }[]) => void,
  ) => {
    const answer = dnsAnswers.connect.get(host);
    if (answer === undefined) real.lookup(host, { all: true }, callback);
    else if (answer instanceof Error) callback(answer);
    else callback(null, answer);
  };
  return { ...real, default: { ...real, lookup }, lookup };
});
vi.mock('node:dns/promises', () => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- vi.mock factories are hoisted above module-scope helpers
  const lookup = (host: string) => {
    const answer = dnsAnswers.precheck.get(host);
    return answer instanceof Error || answer === undefined
      ? Promise.reject(answer ?? new Error('ENOTFOUND'))
      : Promise.resolve(answer);
  };
  return { default: { lookup }, lookup };
});

const server = http.createServer((req, res) => {
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/elsewhere' });
    res.end();
  } else if (req.url === '/empty') {
    res.writeHead(204);
    res.end();
  } else if (req.url === '/hang') {
    res.writeHead(200);
    res.write('partial');
  } else {
    res.setHeader('set-cookie', ['a=1', 'b=2']);
    res.setHeader('content-type', 'text/html');
    res.end(`<title>local ${String(req.headers['x-probe'] ?? '')}</title>`);
  }
});
let port = 0;
beforeAll(async () => {
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
afterEach(() => {
  dnsAnswers.connect.clear();
  dnsAnswers.precheck.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const local = (p = '/') => `http://127.0.0.1:${port}${p}`;

describe('transport.get', () => {
  it('answers a fetch Response with status, every header and the body', async () => {
    const res = await transport.get(local(), { headers: { 'x-probe': 'hi' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await res.text()).toBe('<title>local hi</title>');
  });

  it('returns a redirect instead of following it', async () => {
    const res = await transport.get(local('/redirect'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/elsewhere');
  });

  it('has no body for a null-body status', async () => {
    const res = await transport.get(local('/empty'));
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('rejects when the connection fails', async () => {
    await expect(transport.get('http://127.0.0.1:1/')).rejects.toThrow(/ECONNREFUSED/);
  });

  it.each([
    [
      'a status text with DEL',
      'HTTP/1.1 200 O\x7fK\r\nContent-Length: 0\r\n\r\n',
      /Invalid statusText/,
    ],
    [
      'a status a Response cannot hold',
      'HTTP/1.1 999 X\r\nContent-Length: 0\r\n\r\n',
      /Unsupported HTTP status 999/,
    ],
  ])('rejects (and does not throw out of the callback) on %s', async (_label, raw, reason) => {
    // a raw socket: a real HTTP server would not send these
    const evil = net.createServer(socket => {
      socket.once('data', () => {
        socket.end(Buffer.from(raw, 'latin1'));
      });
    });
    await new Promise<void>(resolve => {
      evil.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${(evil.address() as AddressInfo).port}/`;
    const error = await transport.get(url).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Unreadable response: /);
    expect((error as Error).message).toMatch(reason);
    evil.close();
  });

  it('connects through the given lookup', async () => {
    dnsAnswers.connect.set('rebind.example', [{ address: '127.0.0.1', family: 4 }]);
    const url = `http://rebind.example:${port}/`;
    // the default resolver would reach the local server through this name…
    const lookup = vi.fn<typeof publicOnlyLookup>((_host, _options, callback) => {
      callback(null, [{ address: '127.0.0.1', family: 4 }]);
    });
    expect((await transport.get(url, { lookup })).status).toBe(200);
    // (no pooled socket carries over: every request resolves again)
    expect(lookup).toHaveBeenCalledWith('rebind.example', expect.anything(), expect.any(Function));
    // …but not through the guard
    await expect(transport.get(url, { lookup: publicOnlyLookup })).rejects.toThrow(
      /Blocked: rebind.example resolves to private address/,
    );
  });
});

/** publicOnlyLookup's callback arguments, as one value. */
const run = (host: string, all: boolean) =>
  new Promise<{ err: Error | null; address: unknown; family?: number }>(resolve => {
    publicOnlyLookup(host, { all }, (err, address, family) => {
      resolve({ err, address, family });
    });
  });

describe('publicOnlyLookup', () => {
  it('passes public answers through, in the shape asked for', async () => {
    const answers = [
      { address: '93.184.215.14', family: 4 },
      { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 },
    ];
    dnsAnswers.connect.set('public.example', answers);
    expect(await run('public.example', true)).toEqual({
      err: null,
      address: answers,
      family: undefined,
    });
    expect(await run('public.example', false)).toEqual({
      err: null,
      address: '93.184.215.14',
      family: 4,
    });
  });

  it.each([
    [
      'any private answer',
      [
        { address: '93.184.215.14', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    ],
    ['no answer', []],
  ])('blocks %s', async (_label, answers) => {
    dnsAnswers.connect.set('mixed.example', answers);
    expect((await run('mixed.example', false)).err?.message).toBe(
      'Blocked: mixed.example resolves to private address',
    );
  });

  it('passes resolver errors through', async () => {
    dnsAnswers.connect.set('gone.example', new Error('ENOTFOUND gone.example'));
    expect((await run('gone.example', true)).err?.message).toBe('ENOTFOUND gone.example');
  });

  it('outboundLookup guards every origin but the allowed dev server ones', () => {
    const allowedOrigins = ['http://localhost:5173'];
    expect(outboundLookup('http://localhost:5173/x', { allowedOrigins })).toBeUndefined();
    expect(outboundLookup('http://localhost:5174/x', { allowedOrigins })).toBe(publicOnlyLookup);
    expect(outboundLookup('https://example.com/')).toBe(publicOnlyLookup);
  });
});

describe('OG preview against DNS rebinding', () => {
  it('refuses a name that was public at the check and private at the connection', async () => {
    dnsAnswers.precheck.set('rebind.example', [{ address: '93.184.215.14', family: 4 }]);
    dnsAnswers.connect.set('rebind.example', [{ address: '127.0.0.1', family: 4 }]);
    const preview = await getOGPreview(`http://rebind.example:${port}/`);
    expect(preview.title).toBe('');
    expect(preview.issues).toEqual([
      'Failed to fetch: Error: Blocked: rebind.example resolves to private address',
    ]);
  });

  it('still reads the dev server itself', async () => {
    const preview = await getOGPreview(local(), { allowedOrigins: [local().slice(0, -1)] });
    expect(preview.title).toBe('local');
  });
});

describe('readCapped', () => {
  it('reads a body up to the cap, cancelling the rest', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3, 4, 5]));
      },
      cancel,
    });
    expect(await readCapped(new Response(body), 4)).toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      truncated: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reads a body of exactly the cap, and no body, whole', async () => {
    expect(await readCapped(new Response(new Uint8Array([1, 2, 3, 4])), 4)).toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      truncated: false,
    });
    expect(await readCapped(new Response(null, { status: 204 }), 4)).toEqual({
      bytes: new Uint8Array(),
      truncated: false,
    });
  });

  it('a source that fails to cancel does not fail the read', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        throw new Error('cannot cancel');
      },
    });
    expect((await readCapped(new Response(body), 2)).truncated).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  it('defaults to OUTBOUND_TIMEOUT_MS and clears its timer on success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(await fetchWithTimeout(local(), {}, r => r.text())).toBe('<title>local </title>');
    expect(vi.getTimerCount()).toBe(0);
    expect(OUTBOUND_TIMEOUT_MS).toBe(30_000);
  });

  it('gives up on a body that never ends, and aborts the transfer', async () => {
    const get = vi.spyOn(transport, 'get');
    await expect(fetchWithTimeout(local('/hang'), {}, r => r.text(), 100)).rejects.toThrow(
      'Timed out after 100ms',
    );
    expect(get.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it('propagates a failure of the reader', async () => {
    await expect(
      fetchWithTimeout(local(), {}, () => Promise.reject(new Error('read'))),
    ).rejects.toThrow('read');
  });
});
