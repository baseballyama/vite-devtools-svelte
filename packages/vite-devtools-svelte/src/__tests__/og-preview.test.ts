import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test'
import { svelteDevtools } from '../plugin.js'
import path from 'node:path'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')

function setupWithRpc() {
  const plugins = svelteDevtools()
  for (const p of plugins) {
    if (typeof p.configResolved === 'function') {
      p.configResolved({ command: 'serve', root: FIXTURES_DIR, logger: { warn: () => {} } } as any)
    }
  }

  const mainPlugin = plugins.find(p => p.name === 'vite-devtools-svelte')!
  const rpcHandlers = new Map<string, Function>()
  mainPlugin.devtools!.setup({
    views: { hostStatic: () => {} },
    docks: { register: () => {} },
    rpc: { register: ({ name, handler }: { name: string; handler: Function }) => rpcHandlers.set(name, handler) },
  } as any)

  return rpcHandlers
}

// =====================================================================
// OG Preview Tests (with fetch mocking)
// =====================================================================

describe('OG Preview', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should parse og:title, og:description, og:image from HTML', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(`
        <html>
          <head>
            <meta property="og:title" content="Test Page" />
            <meta property="og:description" content="A test description" />
            <meta property="og:image" content="https://example.com/image.png" />
            <meta property="og:url" content="https://example.com" />
            <meta property="og:type" content="website" />
          </head>
          <body></body>
        </html>
      `),
    })

    const rpcHandlers = setupWithRpc()
    const handler = rpcHandlers.get('svelte-devtools:get-og-preview')!
    const result = await handler('https://example.com') as any

    expect(result.title).toBe('Test Page')
    expect(result.description).toBe('A test description')
    expect(result.image).toBe('https://example.com/image.png')
    expect(result.tags.length).toBe(5)
    expect(result.issues.length).toBe(0)
  })

  it('should fallback to <title> when og:title is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(`
        <html>
          <head>
            <title>Fallback Title</title>
            <meta property="og:description" content="desc" />
            <meta property="og:image" content="https://example.com/img.png" />
            <meta property="og:url" content="https://example.com" />
            <meta property="og:type" content="website" />
          </head>
        </html>
      `),
    })

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com') as any

    expect(result.title).toBe('Fallback Title')
    expect(result.issues.length).toBe(0)
  })

  it('should fallback to meta description when og:description is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(`
        <html>
          <head>
            <meta property="og:title" content="Title" />
            <meta name="description" content="Meta description fallback" />
            <meta property="og:image" content="https://example.com/img.png" />
            <meta property="og:url" content="https://example.com" />
            <meta property="og:type" content="website" />
          </head>
        </html>
      `),
    })

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com') as any

    expect(result.description).toBe('Meta description fallback')
    expect(result.issues.length).toBe(0)
  })

  it('should report issues for missing required OG tags', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(`
        <html><head></head><body></body></html>
      `),
    })

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com') as any

    expect(result.issues).toContain('Missing og:title or <title>')
    expect(result.issues).toContain('Missing og:description or meta description')
    expect(result.issues).toContain('Missing og:image')
    expect(result.issues).toContain('Missing og:url')
    expect(result.issues).toContain('Missing og:type')
  })

  it('should handle fetch errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com') as any

    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toContain('Failed to fetch')
    expect(result.issues[0]).toContain('Network error')
  })

  it('should reject SSRF attempts', async () => {
    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('http://169.254.169.254/metadata') as any

    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toContain('Blocked')
  })

  it('should reject invalid URLs', async () => {
    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('not-a-url') as any

    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toContain('Failed to fetch')
  })

  it('should handle meta tags with reversed attribute order', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(`
        <html>
          <head>
            <meta content="Reversed Title" property="og:title" />
            <meta content="Reversed Desc" property="og:description" />
            <meta content="https://example.com/img.png" property="og:image" />
            <meta content="https://example.com" property="og:url" />
            <meta content="website" property="og:type" />
          </head>
        </html>
      `),
    })

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com') as any

    expect(result.title).toBe('Reversed Title')
    expect(result.description).toBe('Reversed Desc')
    expect(result.image).toBe('https://example.com/img.png')
  })

  it('should handle self-closing meta tags', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(`
        <html>
          <head>
            <meta property="og:title" content="Self Close"/>
            <meta property="og:url" content="https://example.com"/>
            <meta property="og:type" content="website"/>
          </head>
        </html>
      `),
    })

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com') as any

    expect(result.title).toBe('Self Close')
  })

  it('should include the requested URL in the result', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve('<html></html>'),
    })

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-og-preview')!('https://example.com/page') as any

    expect(result.url).toBe('https://example.com/page')
  })
})
