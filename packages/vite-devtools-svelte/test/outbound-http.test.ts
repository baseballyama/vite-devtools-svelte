import type * as DnsModule from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { getOGPreview } from '../src/analyzers/og.js';
import {
  fetchWithTimeout,
  OUTBOUND_TIMEOUT_MS,
  readCapped,
  transport,
} from '../src/analyzers/outbound-http.js';
import type { OutboundResponse } from '../src/analyzers/outbound-http.js';
import { publicOnlyLookup } from '../src/security.js';

type Address = { address: string; family: number };
/** What each name resolves to for the guard (`node:dns`); unknown names use the real resolver. */
const dnsAnswers = vi.hoisted(() => new Map<string, Address[] | Error>());
vi.mock('node:dns', async importOriginal => {
  const real = await importOriginal<typeof DnsModule>();
  // like dns.lookup: an array with `all`, else the first address and its family
  const lookup = (
    host: string,
    options: { all?: boolean },
    callback: (err: Error | null, address?: string | Address[], family?: number) => void,
  ) => {
    const answer = dnsAnswers.get(host);
    if (answer === undefined) real.lookup(host, options, callback as never);
    else if (answer instanceof Error) callback(answer);
    else if (options.all) callback(null, answer);
    else callback(null, answer[0]?.address, answer[0]?.family);
  };
  return { ...real, default: { ...real, lookup }, lookup };
});

/** 64 MB of zeros, deflated to about 64 KB. */
const deflateBomb = zlib.deflateRawSync(Buffer.alloc(64 * 1024 * 1024));
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
  } else if (req.url === '/gzip') {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' });
    res.end(zlib.gzipSync('<title>zipped</title>'));
  } else if (req.url === '/deflate') {
    res.writeHead(200, { 'content-encoding': 'deflate' });
    res.end(zlib.deflateSync('<title>deflated</title>'));
  } else if (req.url === '/x-gzip') {
    res.writeHead(200, { 'content-encoding': ' X-Gzip ' });
    res.end(zlib.gzipSync('<title>x-zipped</title>'));
  } else if (req.url === '/br') {
    res.writeHead(200, { 'content-encoding': 'br' });
    res.end(zlib.brotliCompressSync('<title>brotli</title>'));
  } else if (req.url === '/deflate-raw') {
    res.writeHead(200, { 'content-encoding': 'deflate' });
    res.end(zlib.deflateRawSync('<title>raw</title>'));
  } else if (req.url === '/gzip-then-br') {
    // codings in the order applied: gzip first, then br
    res.writeHead(200, { 'content-encoding': 'gzip, br' });
    res.end(zlib.brotliCompressSync(zlib.gzipSync('<title>both</title>')));
  } else if (req.url === '/empty-gzip') {
    res.writeHead(404, { 'content-encoding': 'gzip', 'content-length': '0' });
    res.end();
  } else if (req.url === '/empty-deflate') {
    res.writeHead(200, { 'content-encoding': 'deflate' });
    res.end();
  } else if (req.url === '/deflate-bomb') {
    res.writeHead(200, { 'content-encoding': 'deflate' });
    res.end(deflateBomb);
  } else if (req.url === '/redirect-deflate') {
    // headers out, body never: nobody reads a redirect's body
    res.writeHead(302, { location: '/elsewhere', 'content-encoding': 'deflate' });
    res.flushHeaders();
  } else if (req.url === '/deflate-twice-partial') {
    res.writeHead(302, { location: '/elsewhere', 'content-encoding': 'deflate, deflate' });
    res.write(zlib.deflateSync(zlib.deflateSync('<title>twice</title>')).subarray(0, 4));
  } else if (req.url === '/deflate-cut') {
    res.writeHead(200, { 'content-encoding': 'deflate' });
    res.write(deflateBomb.subarray(0, 1024), () => {
      res.socket?.destroy();
    });
  } else if (req.url === '/gzip-identity') {
    res.writeHead(200, { 'content-encoding': 'gzip, identity' });
    res.end(zlib.gzipSync('<title>plain enough</title>'));
  } else if (req.url === '/no-trailer') {
    const zipped = zlib.gzipSync('<title>cut</title>');
    res.writeHead(200, { 'content-encoding': 'gzip' });
    res.end(zipped.subarray(0, -8));
  } else if (req.url === '/compress') {
    res.writeHead(200, { 'content-encoding': 'compress' });
    res.end('compressed');
  } else if (req.url === '/not-modified') {
    res.writeHead(304, { 'content-encoding': 'gzip' });
    res.end();
  } else if (req.url === '/bad-gzip') {
    res.writeHead(200, { 'content-encoding': 'gzip' });
    res.end('not gzip at all');
  } else if (req.url === '/echo-headers') {
    const h = req.headers;
    res.end(`<title>${h['user-agent']} | ${h.accept} | ${h['accept-encoding']}</title>`);
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
  dnsAnswers.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const local = (p = '/') => `http://127.0.0.1:${port}${p}`;
/** The local server by name, as the dev server's own origin would be. */
const origin = () => `http://localhost:${port}`;
const text = async (res: OutboundResponse) =>
  new TextDecoder().decode((await readCapped(res.body, 1024 * 1024)).bytes);

async function rawServer(raw: string): Promise<string> {
  const evil = net.createServer(socket => {
    socket.once('data', () => {
      socket.end(Buffer.from(raw, 'latin1'));
    });
  });
  await new Promise<void>(resolve => {
    evil.listen(0, '127.0.0.1', resolve);
  });
  onTestFinished(() => {
    evil.close();
  });
  return `http://127.0.0.1:${(evil.address() as AddressInfo).port}/`;
}

describe('transport.get', () => {
  it('answers the status, every header and the body', async () => {
    const res = await transport.get(local(), { headers: { 'x-probe': 'hi' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.headers['set-cookie']).toEqual(['a=1', 'b=2']);
    expect(await text(res)).toBe('<title>local hi</title>');
  });

  it('returns a redirect instead of following it', async () => {
    const res = await transport.get(local('/redirect'));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/elsewhere');
  });

  it('has an empty body for a null-body status', async () => {
    const res = await transport.get(local('/empty'));
    expect(res.status).toBe(204);
    expect(await text(res)).toBe('');
  });

  it.each([
    ['gzip', '/gzip', '<title>zipped</title>'],
    ['brotli', '/br', '<title>brotli</title>'],
    ['deflate', '/deflate', '<title>deflated</title>'],
    ['x-gzip (any case and padding)', '/x-gzip', '<title>x-zipped</title>'],
    ['raw deflate (no zlib header)', '/deflate-raw', '<title>raw</title>'],
    ['gzip then brotli', '/gzip-then-br', '<title>both</title>'],
    ['gzip missing its trailer', '/no-trailer', '<title>cut</title>'],
    ['empty gzip', '/empty-gzip', ''],
    ['empty deflate', '/empty-deflate', ''],
    ['304 that claims gzip', '/not-modified', ''],
    ['gzip with identity', '/gzip-identity', '<title>plain enough</title>'],
  ])('decompresses a %s body', async (_label, p, body) => {
    expect(await text(await transport.get(local(p)))).toBe(body);
  });

  it('inflates a body larger than its buffers in full when it is all read', async () => {
    const res = await transport.get(local('/deflate-bomb'));
    const { bytes, truncated } = await readCapped(res.body, 64 * 1024 * 1024);
    expect(truncated).toBe(false);
    expect(bytes.byteLength).toBe(64 * 1024 * 1024);
  });

  it('inflates only as far as the body is read', async () => {
    const res = await transport.get(local('/deflate-bomb'));
    expect(await readCapped(res.body, 1024 * 1024)).toMatchObject({ truncated: true });
    await vi.waitFor(() => {
      expect(res.body.destroyed).toBe(true);
    });
  });

  it('fails the read of a deflated body cut off midway', async () => {
    const res = await transport.get(local('/deflate-cut'));
    await expect(readCapped(res.body, 64 * 1024 * 1024)).rejects.toThrow('aborted');
  });

  it.each([
    ['a deflated redirect whose body never came', '/redirect-deflate'],
    ['a twice-deflated redirect cut short', '/deflate-twice-partial'],
  ])('leaves %s unread without crashing', async (_label, p) => {
    // the preview aborts the unread body; a stream erroring with no listener
    // would be an uncaught exception (vitest fails the run on one)
    const allowedOrigins = [origin()];
    expect((await getOGPreview(`${origin()}${p}`, { allowedOrigins })).issues).toEqual([
      'Redirects to /elsewhere (not followed)',
    ]);
    // give the aborted body's failure time to surface
    await new Promise(resolve => {
      setTimeout(resolve, 50);
    });
  });

  it('refuses a coding it cannot undo instead of reading garbled bytes', async () => {
    await expect(transport.get(local('/compress'))).rejects.toThrow(
      'Unsupported content-encoding: compress',
    );
  });

  it('fails the read of a body that does not decompress', async () => {
    await expect(text(await transport.get(local('/bad-gzip')))).rejects.toThrow(/header/);
  });

  it('rejects when the connection fails', async () => {
    await expect(transport.get('http://127.0.0.1:1/')).rejects.toThrow(/ECONNREFUSED/);
  });

  it.each([
    ['a status text with DEL', 'HTTP/1.1 200 O\u007FK\r\nContent-Length: 2\r\n\r\nok', 200],
    ['a status a fetch Response cannot hold', 'HTTP/1.1 999 X\r\nContent-Length: 2\r\n\r\nok', 999],
  ])('reads %s instead of throwing out of the callback', async (_label, raw, status) => {
    // a raw socket: a real HTTP server would not send these
    const res = await transport.get(await rawServer(raw));
    expect(res.status).toBe(status);
    expect(await text(res)).toBe('ok');
  });

  it('rejects a protocol upgrade instead of waiting for the timeout', async () => {
    const url = await rawServer(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: x\r\nConnection: upgrade\r\n\r\n',
    );
    await expect(transport.get(url)).rejects.toThrow('Unexpected protocol upgrade');
  });

  it('connects through the given lookup, on a fresh connection every time', async () => {
    dnsAnswers.set('rebind.example', [{ address: '127.0.0.1', family: 4 }]);
    const url = `http://rebind.example:${port}/`;
    // the first request reaches the local server through this name and is
    // read to its end, so a keep-alive socket would now be free for reuse…
    const lookup = vi.fn<typeof publicOnlyLookup>((_host, _options, callback) => {
      callback(null, [{ address: '127.0.0.1', family: 4 }]);
    });
    expect(await text(await transport.get(url, { lookup }))).toBe('<title>local </title>');
    expect(lookup).toHaveBeenCalledWith('rebind.example', expect.anything(), expect.any(Function));
    // …but the next request resolves again, through the guard, and is refused
    await expect(transport.get(url, { lookup: publicOnlyLookup })).rejects.toThrow(
      /Blocked: rebind.example resolves to private address/,
    );
  });
});

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
    dnsAnswers.set('public.example', answers);
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
      'a private answer',
      [
        { address: '10.0.0.1', family: 4 },
        { address: '93.184.215.14', family: 4 },
      ],
    ],
    // asked for one address only, the resolver would hand over the public one
    [
      'a private answer after a public one',
      [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    ],
    ['no answer', []],
  ])('blocks %s', async (_label, answers) => {
    dnsAnswers.set('mixed.example', answers);
    expect((await run('mixed.example', false)).err?.message).toBe(
      'Blocked: mixed.example resolves to private address',
    );
  });

  it('passes resolver errors through', async () => {
    dnsAnswers.set('gone.example', new Error('ENOTFOUND gone.example'));
    expect((await run('gone.example', true)).err?.message).toBe('ENOTFOUND gone.example');
  });
});

describe('OG preview over the network', () => {
  it('refuses a name that resolves to a private address when connecting', async () => {
    dnsAnswers.set('rebind.example', [{ address: '127.0.0.1', family: 4 }]);
    const preview = await getOGPreview(`http://rebind.example:${port}/`);
    expect(preview.title).toBe('');
    expect(preview.issues).toEqual([
      'Failed to fetch: Error: Blocked: rebind.example resolves to private address',
    ]);
  });

  it('still reads the dev server itself by name', async () => {
    // `localhost` is refused but for the allow list
    const preview = await getOGPreview(`${origin()}/`, { allowedOrigins: [origin()] });
    expect(preview.title).toBe('local');
  });

  it('asks as a browser would, and reads a compressed page', async () => {
    const allowedOrigins = [origin()];
    expect((await getOGPreview(`${origin()}/echo-headers`, { allowedOrigins })).title).toBe(
      'Mozilla/5.0 (compatible; vite-devtools-svelte OG preview) | text/html,application/xhtml+xml;q=0.9,*/*;q=0.8 | gzip, deflate, br',
    );
    expect((await getOGPreview(`${origin()}/gzip`, { allowedOrigins })).title).toBe('zipped');
  });
});

describe('readCapped', () => {
  it('reads a body up to the cap, and nothing after it', async () => {
    let pulled = 0;
    const body = Readable.from(
      (function* () {
        for (; pulled < 1000;) {
          pulled++;
          yield new Uint8Array([pulled, pulled]);
        }
      })(),
    );
    expect(await readCapped(body, 3)).toEqual({
      bytes: new Uint8Array([1, 1, 2]),
      truncated: true,
    });
    expect(body.destroyed).toBe(true);
    // only what the stream buffered ahead was pulled, not all 1000 chunks
    expect(pulled).toBeLessThan(100);
  });

  it('reads a body of exactly the cap, and no body, whole', async () => {
    expect(await readCapped(Readable.from([new Uint8Array([1, 2, 3, 4])]), 4)).toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      truncated: false,
    });
    expect(await readCapped(Readable.from([]), 4)).toEqual({
      bytes: new Uint8Array(),
      truncated: false,
    });
  });

  it('rejects a body that fails midway', async () => {
    const body = new Readable({
      read() {
        this.destroy(new Error('reset'));
      },
    });
    await expect(readCapped(body, 4)).rejects.toThrow('reset');
  });
});

describe('fetchWithTimeout', () => {
  it('defaults to OUTBOUND_TIMEOUT_MS and clears its timer on success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(await fetchWithTimeout(local(), {}, text)).toBe('<title>local </title>');
    expect(vi.getTimerCount()).toBe(0);
    expect(OUTBOUND_TIMEOUT_MS).toBe(30_000);
  });

  it('gives up on a body that never ends, and aborts the transfer', async () => {
    const get = vi.spyOn(transport, 'get');
    await expect(fetchWithTimeout(local('/hang'), {}, text, 100)).rejects.toThrow(
      'Timed out after 100ms',
    );
    expect(get.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it('aborts the transfer of a body left unread, so its socket closes', async () => {
    const get = vi.spyOn(transport, 'get');
    let body: OutboundResponse['body'] | undefined;
    const status = await fetchWithTimeout(local('/hang'), {}, res => {
      body = res.body;
      return Promise.resolve(res.status);
    });
    expect(status).toBe(200);
    expect(get.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(body!.destroyed).toBe(true);
    });
  });

  it('propagates a failure of the reader', async () => {
    await expect(
      fetchWithTimeout(local(), {}, () => Promise.reject(new Error('read'))),
    ).rejects.toThrow('read');
  });
});
