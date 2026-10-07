/**
 * Dev-only config: the real client config + a large synthetic backend.
 *
 *   pnpm exec vite --config dev/vite.mock.config.ts
 *
 * Env:
 *   MOCK_SCALE=N          live component count (default 5000; others scale)
 *   MOCK_TRANSPORT=…      `devframe` (WS + __connection.json, the shipped
 *                         architecture) | `http` (legacy /__svelte-devtools/rpc)
 *                         | `auto` (default: follow what src/lib/rpc.ts imports)
 *   MOCK_GRAPH_SCALE=N    reactive graph with ≥ N signals (default ≈ 240)
 *   MOCK_AUTH=1           devframe only: keep the OTP auth gate on, to
 *                         exercise the "unauthorized" connection UX
 *   PORT=5190
 *
 * The mock never enters the production bundle: nothing under `src/`
 * imports `dev/`, and this file is only used via `--config`.
 */
import fs from 'node:fs'
import type { Connect, Plugin, ViteDevServer } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.js'
import { createMockBackend, MOCK_ASSET_BASE, MOCK_ASSET_SVG, rpcType } from './mock-rpc.js'

const clientRoot = new URL('..', import.meta.url).pathname
const MOUNT = '/.svelte-devtools/'

function pickTransport(): 'devframe' | 'http' {
  const env = process.env.MOCK_TRANSPORT
  if (env === 'devframe' || env === 'http') return env
  const rpc = fs.readFileSync(new URL('../src/lib/rpc.ts', import.meta.url), 'utf8')
  return rpc.includes('devframe') ? 'devframe' : 'http'
}

function mockBackend(scale: number): Plugin {
  const handlers = createMockBackend(scale)
  const transport = pickTransport()

  const assets: Connect.NextHandleFunction = (_req, res) => {
    res.setHeader('content-type', 'image/svg+xml')
    res.end(MOCK_ASSET_SVG)
  }

  const http: Connect.NextHandleFunction = (req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', async () => {
      try {
        const { method, args } = JSON.parse(body || '{}')
        const fn = handlers[method]
        if (!fn) throw new Error(`unknown method ${method}`)
        const out = await fn(...(args ?? []))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(out ?? null))
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
    })
  }

  async function mountDevframe(server: ViteDevServer) {
    // Same wire as the shipped plugin: a devframe answering the scoped
    // `svelte-devtools:*` ids, mounted with `initDevframe` on Vite's server
    // in bridge mode (Vite serves the SPA, devframe serves
    // `__connection.json` + `__ws` + `__sse` under the same base).
    const { defineDevframe, defineRpcFunction } = await import('devframe')
    const { initDevframe } = await import('devframe/initiate')
    const def = defineDevframe({
      id: 'svelte-devtools',
      name: 'Svelte DevTools (mock)',
      version: '0.0.0-mock',
      packageName: 'vite-devtools-svelte',
      importMetaUrl: import.meta.url,
      setup(ctx) {
        for (const [name, handler] of Object.entries(handlers)) {
          ctx.rpc.register(
            defineRpcFunction({ name, type: rpcType(name), jsonSerializable: true, handler }),
          )
        }
      },
    })
    const instance = initDevframe(def, {
      base: MOUNT,
      server: server.httpServer ?? undefined,
      distDir: false,
      mcp: false,
      auth: process.env.MOCK_AUTH === '1',
    })
    // Bridge mode answers 404 for everything else under the base; only hand
    // it devframe's own routes so Vite keeps serving the SPA + HMR.
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0]
      if (path.startsWith(MOUNT + '__')) instance.nodeMiddleware(req, res, next)
      else next()
    })
    server.httpServer?.once('close', () => instance.close?.())
  }

  return {
    name: 'svelte-devtools-mock-backend',
    async configureServer(server) {
      server.middlewares.use(MOCK_ASSET_BASE, assets)
      if (transport === 'http') server.middlewares.use('/__svelte-devtools/rpc', http)
      else await mountDevframe(server)
      server.config.logger.info(`  mock backend: ${transport}, scale ${scale}`)
    },
  }
}

export default mergeConfig(
  base,
  defineConfig({
    root: clientRoot,
    // Production uses a relative base (arch, docs/devframe-migration.md §6.1);
    // the dev server still needs an absolute mount to mirror the real URL.
    base: MOUNT,
    plugins: [mockBackend(Number(process.env.MOCK_SCALE) || 5000)],
    server: { port: Number(process.env.PORT) || 5190, strictPort: true },
  }),
)
