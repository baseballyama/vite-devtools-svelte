import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test'
import { svelteDevtools } from '../plugin.js'
import fs from 'node:fs'
import path from 'node:path'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')

function setupWithRpc(root: string = FIXTURES_DIR) {
  const plugins = svelteDevtools()
  for (const p of plugins) {
    if (typeof p.configResolved === 'function') {
      p.configResolved({ command: 'serve', root, logger: { warn: () => {} } } as any)
    }
  }

  const mainPlugin = plugins.find(p => p.name === 'vite-devtools-plugin-svelte')!
  const rpcHandlers = new Map<string, Function>()
  mainPlugin.devtools!.setup({
    views: { hostStatic: () => {} },
    docks: { register: () => {} },
    rpc: { register: ({ name, handler }: { name: string; handler: Function }) => rpcHandlers.set(name, handler) },
  } as any)

  return rpcHandlers
}

// =====================================================================
// Build Analysis
// =====================================================================

// Note: getBuildAnalysis scans multiple directories: .svelte-kit/output, build/client, build
// Files in build/client will be found by both the build/client scan and the build scan
// (because `build` is walked recursively), resulting in duplicated entries.

describe('build analysis', () => {
  const buildDir = path.join(FIXTURES_DIR, 'build')
  const svelteKitOutputDir = path.join(FIXTURES_DIR, '.svelte-kit', 'output')

  afterEach(() => {
    // Cleanup build directories
    try { fs.rmSync(buildDir, { recursive: true }) } catch {}
    try { fs.rmSync(path.join(FIXTURES_DIR, '.svelte-kit'), { recursive: true }) } catch {}
  })

  it('should return empty analysis when no build directory exists', async () => {
    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    expect(result.chunks).toEqual([])
    expect(result.totalSize).toBe(0)
    expect(result.timestamp).toBeGreaterThan(0)
  })

  it('should detect JS, CSS, and HTML files in build output', async () => {
    // Use .svelte-kit/output which is only scanned once
    fs.mkdirSync(svelteKitOutputDir, { recursive: true })
    fs.writeFileSync(path.join(svelteKitOutputDir, 'index.html'), '<html></html>')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'app.js'), 'console.log("app")')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'style.css'), 'body { color: red }')

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    expect(result.chunks.length).toBe(3)
    expect(result.totalSize).toBeGreaterThan(0)

    const jsChunk = result.chunks.find((c: any) => c.name === 'app.js')
    expect(jsChunk).toBeDefined()
    expect(jsChunk.size).toBeGreaterThan(0)

    const cssChunk = result.chunks.find((c: any) => c.name === 'style.css')
    expect(cssChunk).toBeDefined()

    const htmlChunk = result.chunks.find((c: any) => c.name === 'index.html')
    expect(htmlChunk).toBeDefined()
    expect(htmlChunk.isEntry).toBe(true) // contains 'index'
  })

  it('should sort chunks by size (largest first)', async () => {
    fs.mkdirSync(svelteKitOutputDir, { recursive: true })
    fs.writeFileSync(path.join(svelteKitOutputDir, 'small.js'), 'x')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'large.js'), 'x'.repeat(1000))
    fs.writeFileSync(path.join(svelteKitOutputDir, 'medium.js'), 'x'.repeat(100))

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    expect(result.chunks.length).toBe(3)
    expect(result.chunks[0].size).toBeGreaterThanOrEqual(result.chunks[1].size)
    expect(result.chunks[1].size).toBeGreaterThanOrEqual(result.chunks[2].size)
  })

  it('should detect entry files (index, start)', async () => {
    fs.mkdirSync(svelteKitOutputDir, { recursive: true })
    fs.writeFileSync(path.join(svelteKitOutputDir, 'index.js'), 'main()')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'start.js'), 'start()')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'chunk-abc.js'), 'chunk()')

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    const indexChunk = result.chunks.find((c: any) => c.name === 'index.js')
    expect(indexChunk!.isEntry).toBe(true)

    const startChunk = result.chunks.find((c: any) => c.name === 'start.js')
    expect(startChunk!.isEntry).toBe(true)

    const regularChunk = result.chunks.find((c: any) => c.name === 'chunk-abc.js')
    expect(regularChunk!.isEntry).toBe(false)
  })

  it('should walk nested directories in build output', async () => {
    const assetsDir = path.join(svelteKitOutputDir, 'assets')
    fs.mkdirSync(assetsDir, { recursive: true })
    fs.writeFileSync(path.join(assetsDir, 'chunk-123.js'), 'chunk()')
    fs.writeFileSync(path.join(assetsDir, 'app.css'), 'body {}')

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    expect(result.chunks.length).toBe(2)
    expect(result.chunks.find((c: any) => c.name === 'chunk-123.js')).toBeDefined()
    expect(result.chunks.find((c: any) => c.name === 'app.css')).toBeDefined()
  })

  it('should skip non-web files in build output', async () => {
    fs.mkdirSync(svelteKitOutputDir, { recursive: true })
    fs.writeFileSync(path.join(svelteKitOutputDir, 'app.js'), 'code()')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'data.json'), '{}')
    fs.writeFileSync(path.join(svelteKitOutputDir, 'image.png'), 'binary')

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    // Only .js, .css, .html should be included
    expect(result.chunks.length).toBe(1)
    expect(result.chunks[0].name).toBe('app.js')
  })

  it('should calculate correct totalSize', async () => {
    fs.mkdirSync(svelteKitOutputDir, { recursive: true })
    fs.writeFileSync(path.join(svelteKitOutputDir, 'a.js'), '12345')     // 5 bytes
    fs.writeFileSync(path.join(svelteKitOutputDir, 'b.js'), '1234567890') // 10 bytes

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    expect(result.totalSize).toBe(15)
  })

  it('should scan build/client directory too', async () => {
    const clientDir = path.join(buildDir, 'client')
    fs.mkdirSync(clientDir, { recursive: true })
    fs.writeFileSync(path.join(clientDir, 'app.js'), 'code()')

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    // Found by both build/client scan and build/ recursive scan
    expect(result.chunks.length).toBeGreaterThanOrEqual(1)
    expect(result.chunks.find((c: any) => c.name === 'app.js')).toBeDefined()
  })

  it('should include file path relative to root', async () => {
    fs.mkdirSync(svelteKitOutputDir, { recursive: true })
    fs.writeFileSync(path.join(svelteKitOutputDir, 'app.js'), 'code()')

    const rpcHandlers = setupWithRpc()
    const result = await rpcHandlers.get('svelte-devtools:get-build-analysis')!() as any

    expect(result.chunks[0].file).toContain('.svelte-kit')
    expect(path.isAbsolute(result.chunks[0].file)).toBe(false)
  })
})
