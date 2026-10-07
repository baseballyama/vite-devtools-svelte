import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/**
 * Validate that a URL does not target private/internal network addresses (SSRF prevention).
 * Allows only http/https schemes and blocks private IP ranges.
 */
export function validateExternalUrl(urlStr: string): void {
  parseExternalUrl(urlStr)
}

function parseExternalUrl(urlStr: string): URL {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`)
  }

  const host = hostOf(parsed)
  if (net.isIP(host)) {
    if (isPrivateIP(host)) throw new Error(`Blocked: private IP address ${host}`)
  } else if (isInternalHostname(host)) {
    throw new Error(`Blocked: internal hostname ${host}`)
  }
  return parsed
}

/**
 * The URL's host as an address or a name: IPv6 without brackets, lowercase,
 * without the trailing dot of a fully qualified name (`localhost.`).
 */
function hostOf(url: URL): string {
  return url.hostname
    .replaceAll(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '')
}

function isInternalHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
}

export interface OutboundUrlOptions {
  /**
   * Origins that may be fetched even though they are local — the dev
   * server's own resolved URLs, so the API playground can call the app.
   */
  allowedOrigins?: readonly string[]
}

/**
 * Like {@link validateExternalUrl}, but also resolves the hostname and
 * rejects names that point at private / loopback addresses (DNS-based SSRF),
 * or that do not resolve at all. Exact dev-server origins in
 * `allowedOrigins` bypass the private checks.
 * Callers must also fetch with `redirect: 'manual'` so a public URL cannot
 * bounce the request to a private one.
 */
export async function assertOutboundUrl(
  urlStr: string,
  options: OutboundUrlOptions = {},
): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }
  if (options.allowedOrigins?.includes(parsed.origin)) return parsed
  parseExternalUrl(urlStr)
  const host = hostOf(parsed)
  if (net.isIP(host)) return parsed
  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(host, { all: true })
  } catch {
    throw new Error(`Blocked: ${host} does not resolve`)
  }
  for (const { address } of addresses) {
    if (isPrivateIP(address)) throw new Error(`Blocked: ${host} resolves to private address`)
  }
  return parsed
}

/**
 * Addresses an outbound request must not reach: this host, the local
 * network, and ranges that are not globally routable (RFC 6890 special
 * purpose registries, plus multicast and broadcast).
 */
const BLOCKED_V4 = new net.BlockList()
for (const [prefix, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata endpoints)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. 255.255.255.255 broadcast
] as const) {
  BLOCKED_V4.addSubnet(prefix, bits, 'ipv4')
}

const BLOCKED_V6 = new net.BlockList()
for (const [prefix, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible / reserved (embedded IPv4 is judged first)
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED_V6.addSubnet(prefix, bits, 'ipv6')
}

/**
 * Whether `ip` (an IPv4 or IPv6 literal, IPv6 optionally in brackets) is a
 * private, loopback or otherwise non-public address. IPv6 forms that embed
 * an IPv4 address (mapped, compatible, NAT64, 6to4) are judged by that
 * address. Anything that is not a valid IP literal counts as private, so a
 * malformed value is never let through.
 */
export function isPrivateIP(ip: string): boolean {
  const host = ip.replaceAll(/^\[|\]$/g, '').toLowerCase()
  const version = net.isIP(host)
  if (version === 4) return BLOCKED_V4.check(host, 'ipv4')
  if (version !== 6) return true
  const words = ipv6Words(host)
  const embedded = embeddedIPv4(words)
  if (embedded !== null) return BLOCKED_V4.check(embedded, 'ipv4')
  return BLOCKED_V6.check(host, 'ipv6')
}

/** The eight 16-bit words of a valid IPv6 literal (`::` and dotted tails expanded). */
function ipv6Words(ip: string): number[] {
  let text = ip
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number]
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = text.split('::') as [string, string | undefined]
  if (tail === undefined) return hexWords(head)
  const left = hexWords(head)
  const right = hexWords(tail)
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right]
}

function hexWords(part: string): number[] {
  return part === '' ? [] : part.split(':').map(w => Number.parseInt(w, 16))
}

function dottedQuad(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
}

function embeddedIPv4(words: number[]): string | null {
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const zeroPrefix = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, deprecated)
  if (zeroPrefix && (w5 === 0xffff || w5 === 0) && (w6 !== 0 || w5 === 0xffff))
    return dottedQuad(w6, w7)
  // 64:ff9b::a.b.c.d (NAT64 well-known prefix)
  if (w0 === 0x64 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
    return dottedQuad(w6, w7)
  }
  // 2002:aabb:ccdd::/48 (6to4)
  if (w0 === 0x2002) return dottedQuad(w1, w2)
  return null
}

/**
 * Resolve a user-supplied file path strictly under `root`. Symlinks are
 * followed via realpathSync so that symlinks inside the project cannot be
 * used to escape the root sandbox. Throws if the real path is outside.
 */
export function resolveWithinRoot(root: string, input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Invalid file path')
  }
  const realRoot = fs.realpathSync(root)
  const candidate = path.isAbsolute(input) ? input : path.resolve(root, input)
  let real: string
  try {
    real = fs.realpathSync(candidate)
  } catch {
    throw new Error('File not found')
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error('Forbidden: path outside project root')
  }
  return real
}
