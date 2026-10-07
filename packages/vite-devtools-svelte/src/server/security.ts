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

  const hostname = parsed.hostname
  // Block IPv6 loopback
  if (hostname === '::1' || hostname === '[::1]') {
    throw new Error('Blocked: loopback address')
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked: private IP address ${hostname}`)
    }
  } else {
    // For domain names, block common internal hostnames
    const lower = hostname.toLowerCase()
    if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
      throw new Error(`Blocked: internal hostname ${hostname}`)
    }
  }
  return parsed
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
 * rejects names that point at private / loopback addresses (DNS-based SSRF).
 * Exact dev-server origins in `allowedOrigins` bypass the private checks.
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
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(hostname)) return parsed
  const addresses = await dns.lookup(hostname, { all: true }).catch(() => [])
  for (const { address } of addresses) {
    if (isPrivateIP(address)) throw new Error(`Blocked: ${hostname} resolves to private address`)
  }
  return parsed
}

export function isPrivateIP(ip: string): boolean {
  if (ip.includes(':')) return isPrivateIPv6(ip)
  const parts = ip.split('.').map(Number)
  if (parts.length === 4) {
    // 127.0.0.0/8
    if (parts[0] === 127) return true
    // 10.0.0.0/8
    if (parts[0] === 10) return true
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.0.0.0
    if (parts.every(p => p === 0)) return true
  }
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  // IPv4-mapped / -compatible (::ffff:127.0.0.1, ::127.0.0.1)
  const v4 = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) return isPrivateIP(v4[1])
  if (lower === '::' || lower === '::1') return true
  // fc00::/7 unique local, fe80::/10 link-local
  return /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower)
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
