import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/**
 * Validate that a URL does not target private/internal network addresses (SSRF prevention).
 * Allows only http/https schemes and blocks private IP ranges.
 */
export function validateExternalUrl(urlStr: string): URL {
  const parsed = parseUrl(urlStr)
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

function parseUrl(urlStr: string): URL {
  try {
    return new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * The URL's host as an address or a name: IPv6 without brackets, lowercase,
 * without the trailing dot of a fully qualified name (`localhost.`).
 */
function hostOf(url: URL): string {
  const host = stripBrackets(url.hostname).toLowerCase()
  return host.endsWith('.') ? host.slice(0, -1) : host
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
  const parsed = parseUrl(urlStr)
  if (options.allowedOrigins?.includes(parsed.origin)) return parsed
  validateExternalUrl(urlStr)
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
const BLOCKED = new net.BlockList()
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
  BLOCKED.addSubnet(prefix, bits, 'ipv4')
  // IPv6 forms that embed an IPv4 address are judged by that address:
  // mapped (::ffff:a.b.c.d), compatible (::a.b.c.d, deprecated; its
  // 0.0.0.0/8 covers `::` and `::1`), NAT64 (64:ff9b::a.b.c.d) and 6to4
  // (2002:aabb:ccdd::/48).
  for (const embedding of ['::ffff:', '::', '64:ff9b::']) {
    BLOCKED.addSubnet(embedding + prefix, 96 + bits, 'ipv6')
  }
  const [a, b, c, d] = prefix.split('.').map(Number) as [number, number, number, number]
  const sixToFour = `2002:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}::`
  BLOCKED.addSubnet(sixToFour, 16 + bits, 'ipv6')
}
for (const [prefix, bits] of [
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(prefix, bits, 'ipv6')
}

/**
 * Whether `ip` (an IPv4 or IPv6 literal, IPv6 optionally in brackets) is a
 * private, loopback or otherwise non-public address. IPv6 forms that embed
 * an IPv4 address (mapped, compatible, NAT64, 6to4) are judged by that
 * address. Anything that is not a valid IP literal counts as private, so a
 * malformed value is never let through.
 */
export function isPrivateIP(ip: string): boolean {
  const host = stripBrackets(ip).toLowerCase()
  const version = net.isIP(host)
  return version === 0 || BLOCKED.check(host, version === 4 ? 'ipv4' : 'ipv6')
}

/** Whether `file` lies inside `dir` (`..foo/x` does; `dir` itself, `../x` and other drives do not). */
export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
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
  if (real !== realRoot && !isInside(realRoot, real)) {
    throw new Error('Forbidden: path outside project root')
  }
  return real
}
