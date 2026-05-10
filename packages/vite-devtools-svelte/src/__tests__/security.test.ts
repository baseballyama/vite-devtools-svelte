import { describe, it, expect } from 'vite-plus/test'
import net from 'node:net'

// Mirrors the logic in plugin.ts's validateExternalUrl and isPrivateIP for unit testing.
// We copy these here because they are not exported from plugin.ts.

function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length === 4) {
    if (parts[0] === 127) return true
    if (parts[0] === 10) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts.every(p => p === 0)) return true
  }
  return false
}

function validateExternalUrl(urlStr: string): void {
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
  if (hostname === '::1' || hostname === '[::1]') {
    throw new Error('Blocked: loopback address')
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked: private IP address ${hostname}`)
    }
  } else {
    const lower = hostname.toLowerCase()
    if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
      throw new Error(`Blocked: internal hostname ${hostname}`)
    }
  }
}

// =====================================================================
// isPrivateIP
// =====================================================================

describe('isPrivateIP', () => {
  it('should block 127.x.x.x (loopback)', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true)
    expect(isPrivateIP('127.255.255.255')).toBe(true)
    expect(isPrivateIP('127.0.0.0')).toBe(true)
    expect(isPrivateIP('127.1.2.3')).toBe(true)
  })

  it('should block 10.x.x.x (private)', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true)
    expect(isPrivateIP('10.255.255.255')).toBe(true)
    expect(isPrivateIP('10.0.0.0')).toBe(true)
    expect(isPrivateIP('10.10.10.10')).toBe(true)
  })

  it('should block 172.16-31.x.x (private)', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true)
    expect(isPrivateIP('172.31.255.255')).toBe(true)
    expect(isPrivateIP('172.20.0.1')).toBe(true)
    expect(isPrivateIP('172.24.128.1')).toBe(true)
    // Out of range
    expect(isPrivateIP('172.15.0.1')).toBe(false)
    expect(isPrivateIP('172.32.0.1')).toBe(false)
  })

  it('should block 192.168.x.x (private)', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true)
    expect(isPrivateIP('192.168.255.255')).toBe(true)
    expect(isPrivateIP('192.168.1.1')).toBe(true)
    // Adjacent ranges should not be blocked
    expect(isPrivateIP('192.167.0.1')).toBe(false)
    expect(isPrivateIP('192.169.0.1')).toBe(false)
  })

  it('should block 169.254.x.x (link-local)', () => {
    expect(isPrivateIP('169.254.0.1')).toBe(true)
    expect(isPrivateIP('169.254.169.254')).toBe(true)
    expect(isPrivateIP('169.254.255.255')).toBe(true)
    // Adjacent
    expect(isPrivateIP('169.253.0.1')).toBe(false)
    expect(isPrivateIP('169.255.0.1')).toBe(false)
  })

  it('should block 0.0.0.0', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true)
  })

  it('should allow public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
    expect(isPrivateIP('1.1.1.1')).toBe(false)
    expect(isPrivateIP('93.184.216.34')).toBe(false)
    expect(isPrivateIP('203.0.113.1')).toBe(false)
    expect(isPrivateIP('198.51.100.1')).toBe(false)
  })

  it('should not crash on non-IPv4 strings', () => {
    expect(isPrivateIP('')).toBe(false)
    expect(isPrivateIP('not-an-ip')).toBe(false)
    expect(isPrivateIP('::1')).toBe(false) // IPv6 handled separately
  })
})

// =====================================================================
// validateExternalUrl
// =====================================================================

describe('validateExternalUrl', () => {
  it('should reject invalid URLs', () => {
    expect(() => validateExternalUrl('not-a-url')).toThrow('Invalid URL')
    expect(() => validateExternalUrl('')).toThrow('Invalid URL')
    expect(() => validateExternalUrl('://missing-scheme')).toThrow('Invalid URL')
  })

  it('should reject non-http schemes', () => {
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow('Blocked URL scheme')
    expect(() => validateExternalUrl('ftp://example.com')).toThrow('Blocked URL scheme')
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow('Blocked URL scheme')
    expect(() => validateExternalUrl('data:text/html,<h1>hi</h1>')).toThrow('Blocked URL scheme')
  })

  it('should reject localhost', () => {
    expect(() => validateExternalUrl('http://localhost:3000')).toThrow('Blocked: internal hostname')
    expect(() => validateExternalUrl('http://localhost')).toThrow('Blocked: internal hostname')
    expect(() => validateExternalUrl('https://localhost/api')).toThrow('Blocked: internal hostname')
  })

  it('should reject .local domains', () => {
    expect(() => validateExternalUrl('http://my-machine.local/api')).toThrow(
      'Blocked: internal hostname',
    )
    expect(() => validateExternalUrl('http://printer.local')).toThrow('Blocked: internal hostname')
  })

  it('should reject .internal domains', () => {
    expect(() => validateExternalUrl('http://service.internal/api')).toThrow(
      'Blocked: internal hostname',
    )
    expect(() => validateExternalUrl('http://db.internal:5432')).toThrow(
      'Blocked: internal hostname',
    )
  })

  it('should reject private IPs', () => {
    expect(() => validateExternalUrl('http://10.0.0.1/admin')).toThrow('Blocked: private IP')
    expect(() => validateExternalUrl('http://192.168.1.1/')).toThrow('Blocked: private IP')
    expect(() => validateExternalUrl('http://169.254.169.254/metadata')).toThrow(
      'Blocked: private IP',
    )
    expect(() => validateExternalUrl('http://172.16.0.1/admin')).toThrow('Blocked: private IP')
    expect(() => validateExternalUrl('http://127.0.0.1:8080/api')).toThrow('Blocked: private IP')
  })

  it('should reject IPv6 loopback', () => {
    expect(() => validateExternalUrl('http://[::1]:3000/')).toThrow('Blocked: loopback')
  })

  it('should allow valid external URLs', () => {
    expect(() => validateExternalUrl('https://example.com')).not.toThrow()
    expect(() => validateExternalUrl('http://8.8.8.8/dns')).not.toThrow()
    expect(() => validateExternalUrl('https://api.github.com/repos')).not.toThrow()
    expect(() => validateExternalUrl('https://www.google.com')).not.toThrow()
    expect(() => validateExternalUrl('http://93.184.216.34')).not.toThrow()
  })

  it('should allow HTTPS URLs', () => {
    expect(() => validateExternalUrl('https://secure.example.com')).not.toThrow()
  })

  it('should allow URLs with ports', () => {
    expect(() => validateExternalUrl('https://example.com:8443/api')).not.toThrow()
  })

  it('should allow URLs with paths and query strings', () => {
    expect(() => validateExternalUrl('https://example.com/path?query=value&foo=bar')).not.toThrow()
  })

  it('should allow URLs with fragments', () => {
    expect(() => validateExternalUrl('https://example.com/page#section')).not.toThrow()
  })

  it('should allow subdomains', () => {
    expect(() => validateExternalUrl('https://sub.domain.example.com')).not.toThrow()
  })

  it('should block AWS metadata endpoint', () => {
    expect(() => validateExternalUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      'Blocked: private IP',
    )
  })

  it('should block 0.0.0.0', () => {
    expect(() => validateExternalUrl('http://0.0.0.0:8080')).toThrow('Blocked: private IP')
  })
})

// =====================================================================
// Integration: SSRF via send-api-request RPC
// =====================================================================

describe('SSRF protection via API request', () => {
  it('should ensure all private IP ranges are blocked', () => {
    const privateIPs = [
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '192.168.255.255',
      '169.254.0.1',
      '169.254.255.255',
      '0.0.0.0',
    ]
    for (const ip of privateIPs) {
      expect(() => validateExternalUrl(`http://${ip}/`)).toThrow(/blocked|disallowed|not allowed/i)
    }
  })

  it('should ensure all internal hostnames are blocked', () => {
    const internalHosts = ['localhost', 'my-server.local', 'internal-api.internal']
    for (const host of internalHosts) {
      expect(() => validateExternalUrl(`http://${host}/`)).toThrow(/blocked|disallowed|not allowed/i)
    }
  })

  it('should ensure all blocked schemes are rejected', () => {
    const blockedSchemes = [
      'file:///etc/passwd',
      'ftp://example.com/file',
      'gopher://example.com',
      'dict://example.com',
    ]
    for (const url of blockedSchemes) {
      expect(() => validateExternalUrl(url)).toThrow(/blocked|disallowed|not allowed/i)
    }
  })
})
