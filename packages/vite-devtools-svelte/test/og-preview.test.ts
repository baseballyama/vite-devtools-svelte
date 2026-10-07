import path from 'node:path'

/**
 * OG preview: tag parsing, charset and entity decoding, relative og:image,
 * redirects / HTTP errors / timeouts, SSRF guard. Offline: fetch and DNS are
 * mocked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { decodeBody, decodeEntities, getOGPreview, parseMetaTags } from '../src/analyzers/og.js'
import { createTestHost, rpcHandlers } from './helpers.js'

vi.mock('node:dns/promises', () => ({
  default: { lookup: () => Promise.resolve([{ address: '93.184.215.14', family: 4 }]) },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const PAGE = 'https://example.com/blog/post'

function serve(body: ConstructorParameters<typeof Response>[0], init: ResponseInit = {}) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(body, init)))
}

const COMPLETE = `
  <meta property="og:url" content="${PAGE}">
  <meta property="og:type" content="article">`

describe('parseMetaTags', () => {
  it.each<[label: string, html: string, tags: Array<[string, string]>]>([
    ['property first', '<meta property="og:title" content="T">', [['og:title', 'T']]],
    ['content first', '<meta content="T" property="og:title" />', [['og:title', 'T']]],
    ['name attribute', '<meta name="description" content="D">', [['description', 'D']]],
    ['single quotes', "<meta property='og:title' content='T'>", [['og:title', 'T']]],
    ['unquoted', '<meta property=og:title content=T>', [['og:title', 'T']]],
    [
      'apostrophe in a double-quoted value',
      `<meta property="og:title" content="It's here">`,
      [['og:title', "It's here"]],
    ],
    [
      'quote in a single-quoted value',
      `<meta property='og:title' content='say "hi"'>`,
      [['og:title', 'say "hi"']],
    ],
    ['> inside a value', '<meta property="og:title" content="a > b">', [['og:title', 'a > b']]],
    [
      'entities decoded',
      '<meta property="og:title" content="Tom &amp; Jerry &#8212; &#x41;&lt;3&gt; &quot;q&quot; &apos;">',
      [['og:title', 'Tom & Jerry — A<3> "q" \'']],
    ],
    ['empty content kept', '<meta property="og:title" content="">', [['og:title', '']]],
    ['uppercase tag and attributes', '<META PROPERTY="og:title" CONTENT="T">', [['og:title', 'T']]],
    ['whitespace around =', '<meta property = "og:title" content = "T">', [['og:title', 'T']]],
    ['multi-line tag', '<meta\n  property="og:title"\n  content="T"\n>', [['og:title', 'T']]],
    [
      'first duplicate attribute wins',
      '<meta property="og:title" property="x" content="T">',
      [['og:title', 'T']],
    ],
    [
      'property preferred over name',
      '<meta name="n" property="og:title" content="T">',
      [['og:title', 'T']],
    ],
    // not matched
    ['data-content is not content', '<meta property="og:title" data-content="T">', []],
    ['data-property is not property', '<meta data-property="og:title" content="T">', []],
    ['no content', '<meta property="og:title">', []],
    ['charset meta', '<meta charset="utf-8">', []],
    ['metadata is not meta', '<metadata property="og:title" content="T">', []],
    [
      'several, in document order',
      '<meta property="a" content="1"><p><meta name="b" content="2">',
      [
        ['a', '1'],
        ['b', '2'],
      ],
    ],
  ])('%s', (_label, html, tags) => {
    expect(parseMetaTags(html).map(t => [t.property, t.content])).toEqual(tags)
  })
})

describe('decodeEntities', () => {
  it.each([
    ['&amp;amp;', '&amp;'],
    ['&unknown;', '&unknown;'],
    ['&#0;', '&#0;'],
    ['&#x110000;', '&#x110000;'],
    ['&#128512;', '😀'],
    ['&AMP;', '&'],
    ['&nbsp;', ' '],
    ['no entities', 'no entities'],
    ['& alone', '& alone'],
  ])('%j → %j', (input, output) => {
    expect(decodeEntities(input)).toBe(output)
  })
})

const utf8 = (s: string) => new TextEncoder().encode(s)

describe('decodeBody (charset)', () => {
  const sjis = new Uint8Array([0x82, 0xa0, 0x82, 0xa2]) // あい
  const join = (prefix: string, bytes: Uint8Array) => new Uint8Array([...utf8(prefix), ...bytes])
  const httpEquiv = '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">'

  it.each<[label: string, bytes: Uint8Array, contentType: string | null, text: string]>([
    ['utf-8 default', utf8('あい'), null, 'あい'],
    ['Content-Type charset', sjis, 'text/html; charset=Shift_JIS', 'あい'],
    ['quoted Content-Type charset', sjis, 'text/html; charset="shift_jis"', 'あい'],
    [
      '<meta charset>',
      join('<meta charset="shift_jis">', sjis),
      null,
      '<meta charset="shift_jis">あい',
    ],
    ['http-equiv meta', join(httpEquiv, new Uint8Array([0xe9])), 'text/html', `${httpEquiv}é`],
    [
      'header wins over meta',
      join('<meta charset="shift_jis">', utf8('é')),
      'text/html; charset=utf-8',
      '<meta charset="shift_jis">é',
    ],
    ['unknown label falls back to utf-8', utf8('é'), 'text/html; charset=nope-42', 'é'],
  ])('%s', (_label, bytes, contentType, text) => {
    expect(decodeBody(bytes, contentType)).toBe(text)
  })
})

describe('getOGPreview', () => {
  it('reads title, description and image from the first og tags', async () => {
    serve(`<html><head>
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">
      <meta property="og:description" content="Desc">
      <meta property="og:image" content="https://cdn.example/a.png">
      <meta property="og:image" content="https://cdn.example/b.png">
      ${COMPLETE}
    </head></html>`)
    const r = await getOGPreview(PAGE)
    expect(r).toMatchObject({
      url: PAGE,
      title: 'First',
      description: 'Desc',
      image: 'https://cdn.example/a.png',
      issues: [],
    })
    expect(r.tags).toHaveLength(7)
  })

  it.each([
    ['/og.png', 'https://example.com/og.png'],
    ['og.png', 'https://example.com/blog/og.png'],
    ['../og.png', 'https://example.com/og.png'],
    ['//cdn.example/og.png', 'https://cdn.example/og.png'],
    ['https://cdn.example/og.png', 'https://cdn.example/og.png'],
    ['/og image.png?a=1&amp;b=2', 'https://example.com/og%20image.png?a=1&b=2'],
  ])('resolves og:image %j against the page URL', async (content, image) => {
    serve(`<meta property="og:image" content="${content}">`)
    expect((await getOGPreview(PAGE)).image).toBe(image)
  })

  it('keeps og:image as is when it cannot be resolved', async () => {
    serve('<meta property="og:image" content="http://[bad">')
    expect((await getOGPreview(PAGE)).image).toBe('http://[bad')
  })

  it('falls back to <title> and meta description, decoded and trimmed', async () => {
    serve(
      `<title data-x="1">\n  A &amp; B\n  page </title><meta name="description" content="d &lt;3">`,
    )
    const r = await getOGPreview(PAGE)
    expect(r).toMatchObject({ title: 'A & B page', description: 'd <3' })
  })

  it('og tags take precedence over <title> and meta description', async () => {
    serve(
      '<title>T</title><meta name="description" content="d"><meta property="og:title" content="OG"><meta property="og:description" content="OGD">',
    )
    expect(await getOGPreview(PAGE)).toMatchObject({ title: 'OG', description: 'OGD' })
  })

  it('an empty og:title falls back to <title>', async () => {
    serve('<meta property="og:title" content=""><title>T</title>')
    expect((await getOGPreview(PAGE)).title).toBe('T')
  })

  it.each<[label: string, html: string, issues: string[]]>([
    [
      'nothing',
      '<html></html>',
      [
        'Missing og:title or <title>',
        'Missing og:description or meta description',
        'Missing og:image',
        'Missing og:url',
        'Missing og:type',
      ],
    ],
    [
      'all present',
      `<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="/i.png">${COMPLETE}`,
      [],
    ],
    [
      'only og:url / og:type missing',
      '<title>t</title><meta name="description" content="d"><meta property="og:image" content="/i">',
      ['Missing og:url', 'Missing og:type'],
    ],
  ])('issues: %s', async (_label, html, issues) => {
    serve(html)
    expect((await getOGPreview(PAGE)).issues).toEqual(issues)
  })

  it('decodes a Shift_JIS page by its Content-Type', async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('<title>'),
      0x82,
      0xa0,
      ...new TextEncoder().encode('</title>'),
    ])
    serve(bytes, { headers: { 'content-type': 'text/html; charset=Shift_JIS' } })
    expect((await getOGPreview(PAGE)).title).toBe('あ')
  })

  it('reports a redirect without following it', async () => {
    const fetchMock = serve('', { status: 301, headers: { location: 'http://10.0.0.1/' } })
    const r = await getOGPreview(PAGE)
    expect(r.issues).toEqual(['Redirects to http://10.0.0.1/ (not followed)'])
    expect(r.tags).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it('reports a redirect without location', async () => {
    serve(null, { status: 307 })
    expect((await getOGPreview(PAGE)).issues).toEqual(['Redirects to (no location) (not followed)'])
  })

  it('reports an HTTP error status and still parses the body', async () => {
    serve('<title>Not found</title>', { status: 404 })
    const r = await getOGPreview(PAGE)
    expect(r.title).toBe('Not found')
    expect(r.issues[0]).toBe('Responded with HTTP 404')
  })

  it.each([
    ['http://169.254.169.254/metadata', /Blocked: private IP/],
    ['http://127.0.0.1:5173/', /Blocked: private IP/],
    ['ftp://example.com/', /Blocked URL scheme/],
    ['not-a-url', /Invalid URL/],
  ])('refuses %s without fetching', async (url, message) => {
    const fetchMock = serve('')
    const r = await getOGPreview(url)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatch(/^Failed to fetch: /)
    expect(r.issues[0]).toMatch(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the dev server origin', async () => {
    serve('<title>dev</title>')
    const r = await getOGPreview('http://localhost:5173/', {
      allowedOrigins: ['http://localhost:5173'],
    })
    expect(r.title).toBe('dev')
  })

  it('reports network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    expect((await getOGPreview(PAGE)).issues).toEqual(['Failed to fetch: Error: Network error'])
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const pending = getOGPreview(PAGE, {}, 100)
    await vi.advanceTimersByTimeAsync(100)
    expect((await pending).issues).toEqual(['Failed to fetch: Error: Timed out after 100ms'])
  })
})

describe('get-og-preview RPC', () => {
  it('passes the dev server origins as the allow list', async () => {
    serve('<title>own</title>')
    const rpc = rpcHandlers(
      createTestHost(path.resolve(import.meta.dirname, 'fixtures'), {
        serverOrigins: () => ['http://localhost:5173'],
      }),
    )
    const r = await rpc.get('svelte-devtools:get-og-preview')!({ url: 'http://localhost:5173/' })
    expect(r.title).toBe('own')
    const blocked = await rpc.get('svelte-devtools:get-og-preview')!({
      url: 'http://localhost:6000/',
    })
    expect(blocked.issues[0]).toMatch(/Blocked/)
  })
})
