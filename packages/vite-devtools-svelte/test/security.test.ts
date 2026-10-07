import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertOutboundUrl,
  isPrivateIP,
  resolveWithinRoot,
  validateExternalUrl,
} from '../src/server/security.js'

const PUBLIC_ANSWER = [{ address: '93.184.215.14', family: 4 }]
const lookup = vi.hoisted(() =>
  vi.fn<(host: string, options: object) => Promise<{ address: string; family: number }[]>>(),
)
vi.mock('node:dns/promises', () => ({ default: { lookup } }))

beforeEach(() => {
  lookup.mockReset()
  lookup.mockResolvedValue(PUBLIC_ANSWER)
})

// Addresses no outbound request may reach, by range. Boundaries of each
// range are included so an off-by-one in a prefix length shows up.
const PRIVATE_IPS = [
  // IPv4
  ['0.0.0.0', 'this network'],
  ['0.1.2.3', 'this network'],
  ['10.0.0.0', 'private'],
  ['10.255.255.255', 'private'],
  ['100.64.0.0', 'carrier-grade NAT'],
  ['100.127.255.255', 'carrier-grade NAT'],
  ['127.0.0.1', 'loopback'],
  ['127.255.255.255', 'loopback'],
  ['169.254.169.254', 'link-local / cloud metadata'],
  ['172.16.0.0', 'private'],
  ['172.31.255.255', 'private'],
  ['192.0.0.1', 'IETF protocol assignments'],
  ['192.0.2.1', 'documentation'],
  ['192.168.0.0', 'private'],
  ['192.168.255.255', 'private'],
  ['198.18.0.1', 'benchmarking'],
  ['198.19.255.255', 'benchmarking'],
  ['198.51.100.7', 'documentation'],
  ['203.0.113.7', 'documentation'],
  ['224.0.0.1', 'multicast'],
  ['239.255.255.255', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.255', 'broadcast'],
  // IPv6
  ['::', 'unspecified'],
  ['::1', 'loopback'],
  ['0:0:0:0:0:0:0:1', 'loopback, uncompressed'],
  ['[::1]', 'loopback, bracketed'],
  ['::2', 'reserved ::/96'],
  ['100::1', 'discard-only'],
  ['2001:db8::1', 'documentation'],
  ['fc00::1', 'unique local'],
  ['fdff:ffff::1', 'unique local'],
  ['fe80::1', 'link-local'],
  ['febf::1', 'link-local'],
  ['fec0::1', 'site-local'],
  ['ff02::1', 'multicast'],
  ['FD00::1', 'unique local, uppercase'],
  // IPv6 forms that embed an IPv4 address
  ['::ffff:127.0.0.1', 'IPv4-mapped, dotted'],
  ['::ffff:7f00:1', 'IPv4-mapped, hex (as URL normalises it)'],
  ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata address'],
  ['::127.0.0.1', 'IPv4-compatible'],
  ['64:ff9b::a00:1', 'NAT64 of 10.0.0.1'],
  ['2002:7f00:1::', '6to4 of 127.0.0.1'],
  ['2002:c0a8:101::1', '6to4 of 192.168.1.1'],
  // not an IP literal at all: fail closed
  ['', 'empty'],
  ['not-an-ip', 'a name'],
  ['127.1', 'shorthand (not a literal net.isIP accepts)'],
] as const

const PUBLIC_IPS = [
  ['1.1.1.1', 'public'],
  ['8.8.8.8', 'public'],
  ['9.255.255.255', 'below 10/8'],
  ['11.0.0.0', 'above 10/8'],
  ['100.63.255.255', 'below 100.64/10'],
  ['100.128.0.0', 'above 100.64/10'],
  ['126.255.255.255', 'below 127/8'],
  ['128.0.0.0', 'above 127/8'],
  ['169.253.255.255', 'below 169.254/16'],
  ['172.15.255.255', 'below 172.16/12'],
  ['172.32.0.0', 'above 172.16/12'],
  ['192.167.255.255', 'below 192.168/16'],
  ['192.169.0.0', 'above 192.168/16'],
  ['198.17.255.255', 'below 198.18/15'],
  ['198.20.0.0', 'above 198.18/15'],
  ['223.255.255.255', 'below 224/4'],
  ['2606:4700::1111', 'public IPv6'],
  ['[2001:4860:4860::8888]', 'public IPv6, bracketed'],
  ['::ffff:8.8.8.8', 'IPv4-mapped public'],
  ['::ffff:808:808', 'IPv4-mapped public, hex'],
  ['64:ff9b::808:808', 'NAT64 of a public address'],
  ['2002:808:808::1', '6to4 of a public address'],
] as const

describe('isPrivateIP', () => {
  it.each(PRIVATE_IPS)('%s is private (%s)', ip => {
    expect(isPrivateIP(ip)).toBe(true)
  })

  it.each(PUBLIC_IPS)('%s is public (%s)', ip => {
    expect(isPrivateIP(ip)).toBe(false)
  })
})

describe('validateExternalUrl', () => {
  it.each([
    ['not a url', /Invalid URL/],
    ['', /Invalid URL/],
    ['file:///etc/passwd', /scheme/],
    ['ftp://example.com/', /scheme/],
    ['javascript:alert(1)', /scheme/],
    ['data:text/html,x', /scheme/],
    ['gopher://example.com/', /scheme/],
  ])('rejects %j', (url, error) => {
    expect(() => validateExternalUrl(url)).toThrow(error)
  })

  it.each([
    'http://localhost/',
    'http://LOCALHOST:3000/',
    'http://localhost./',
    'http://app.localhost/',
    'http://printer.local/',
    'http://db.internal:5432/',
    'http://metadata.google.internal/',
  ])('rejects the internal hostname %s', url => {
    expect(() => validateExternalUrl(url)).toThrow(/internal hostname/)
  })

  // Literal addresses in every spelling the URL parser accepts.
  it.each([
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://0.0.0.0:8080/',
    'http://0/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[::]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::]/',
  ])('rejects the private address in %s', url => {
    expect(() => validateExternalUrl(url)).toThrow(/private IP/)
  })

  it.each([
    'http://example.com',
    'https://example.com',
    'https://api.github.com/repos',
    'http://example.com:8080/x?y=1#z',
    'https://sub.domain.example.com/',
    'http://8.8.8.8/',
    'http://[2606:4700::1111]/',
    'http://localhost.example.com/',
    'http://internal.example.com/',
  ])('allows %s', url => {
    expect(() => validateExternalUrl(url)).not.toThrow()
  })
})

describe('assertOutboundUrl', () => {
  it('allows exactly the dev server origins it is given', async () => {
    const allowedOrigins = ['http://localhost:5173']
    await expect(
      assertOutboundUrl('http://localhost:5173/api/hello', { allowedOrigins }),
    ).resolves.toBeInstanceOf(URL)
    for (const url of [
      'http://localhost:6379/',
      'http://127.0.0.1:5173/',
      'https://localhost:5173/',
      'http://[::1]:5173/',
    ]) {
      await expect(assertOutboundUrl(url, { allowedOrigins })).rejects.toThrow(/Blocked/)
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each([
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://0.1.2.3/',
    'http://169.254.169.254/latest',
    'http://localhost./',
  ])('rejects the literal %s without a DNS lookup', async url => {
    await expect(assertOutboundUrl(url)).rejects.toThrow(/Blocked/)
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each([
    [[{ address: '10.0.0.5', family: 4 }]],
    [[{ address: 'fd00::5', family: 6 }]],
    [[{ address: '::ffff:127.0.0.1', family: 6 }]],
    // one private answer among public ones is enough (the client may pick it)
    [
      [
        { address: '93.184.215.14', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    ],
  ])('rejects a name that resolves to %j', async answer => {
    lookup.mockResolvedValueOnce(answer)
    await expect(assertOutboundUrl('https://intranet.example.com/')).rejects.toThrow(
      /resolves to private/,
    )
    expect(lookup).toHaveBeenCalledWith('intranet.example.com', { all: true })
  })

  it('rejects a name that does not resolve (fails closed)', async () => {
    lookup.mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
    await expect(assertOutboundUrl('https://nowhere.example/')).rejects.toThrow(/does not resolve/)
  })

  it('accepts names and literals that resolve to public addresses', async () => {
    await expect(assertOutboundUrl('https://example.com/')).resolves.toBeInstanceOf(URL)
    await expect(assertOutboundUrl('https://example.com./')).resolves.toBeInstanceOf(URL)
    expect(lookup).toHaveBeenLastCalledWith('example.com', { all: true })
    await expect(assertOutboundUrl('http://8.8.8.8/')).resolves.toBeInstanceOf(URL)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('rejects bad schemes before anything else', async () => {
    await expect(assertOutboundUrl('file:///etc/passwd')).rejects.toThrow(/scheme/)
    await expect(assertOutboundUrl('nope')).rejects.toThrow(/Invalid URL/)
  })
})

describe('resolveWithinRoot', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-root-')))
  const root = path.join(base, 'project')
  const sibling = path.join(base, 'project-evil')
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(sibling)
  fs.writeFileSync(path.join(root, 'src/App.svelte'), '<h1>hi</h1>')
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret')
  fs.writeFileSync(path.join(base, 'outside.txt'), 'outside')
  fs.symlinkSync(path.join(root, 'src/App.svelte'), path.join(root, 'inside-link'))
  fs.symlinkSync(path.join(base, 'outside.txt'), path.join(root, 'escape-link'))
  fs.symlinkSync(base, path.join(root, 'escape-dir'))
  const linkedRoot = path.join(base, 'linked-root')
  fs.symlinkSync(root, linkedRoot)

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

  it.each([
    ['src/App.svelte', 'src/App.svelte'],
    ['./src/../src/App.svelte', 'src/App.svelte'],
    ['inside-link', 'src/App.svelte'],
    ['.', ''],
  ])('resolves %j inside the root', (input, expected) => {
    expect(resolveWithinRoot(root, input)).toBe(path.join(root, expected))
  })

  it('accepts an absolute path inside the root', () => {
    const file = path.join(root, 'src/App.svelte')
    expect(resolveWithinRoot(root, file)).toBe(file)
  })

  it('works when the root itself is reached through a symlink', () => {
    expect(resolveWithinRoot(linkedRoot, 'src/App.svelte')).toBe(path.join(root, 'src/App.svelte'))
  })

  it.each([
    ['../outside.txt', 'relative traversal'],
    ['src/../../outside.txt', 'traversal through a subdirectory'],
    ['../project-evil/secret.txt', 'a sibling whose name starts with the root name'],
    ['escape-link', 'a symlinked file pointing outside'],
    ['escape-dir/outside.txt', 'a symlinked directory pointing outside'],
  ])('forbids %j (%s)', input => {
    expect(() => resolveWithinRoot(root, input)).toThrow(/Forbidden/)
  })

  it('forbids absolute paths outside the root', () => {
    expect(() => resolveWithinRoot(root, path.join(base, 'outside.txt'))).toThrow(/Forbidden/)
    expect(() => resolveWithinRoot(root, path.join(sibling, 'secret.txt'))).toThrow(/Forbidden/)
  })

  it('reports missing files without revealing whether they are outside', () => {
    expect(() => resolveWithinRoot(root, 'src/missing.svelte')).toThrow('File not found')
    expect(() => resolveWithinRoot(root, '../missing.txt')).toThrow('File not found')
  })

  it.each([[''], [undefined], [null], [42]])('rejects the non-path %j', input => {
    expect(() => resolveWithinRoot(root, input as unknown as string)).toThrow('Invalid file path')
  })

  it('rejects a NUL byte', () => {
    expect(() => resolveWithinRoot(root, 'src/App.svelte\0.txt')).toThrow('File not found')
  })
})
