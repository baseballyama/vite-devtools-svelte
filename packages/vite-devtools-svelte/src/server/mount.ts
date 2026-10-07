import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'

import type { DevframeDefinition } from 'devframe'
import { initDevframe } from 'devframe/initiate'
import type { DevframeInstance } from 'devframe/initiate'
import type { ViteDevServer } from 'vite'

import { DEVFRAME_BASE } from './devframe.js'

const WILDCARD = new Set(['0.0.0.0', '::'])
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

function formatHost(address: string): string {
  return address.includes(':') ? `[${address}]` : address
}

/**
 * Origins a browser may load the DevTools from when the dev server is
 * reachable beyond loopback (`server.host`). devframe accepts loopback
 * origins by default and rejects every other WS `Origin` unless listed.
 */
function networkOrigins(address: AddressInfo, proto: string): string[] {
  if (LOOPBACK.has(address.address)) return []
  const hosts = WILDCARD.has(address.address)
    ? Object.values(os.networkInterfaces())
        .flat()
        .filter(i => i && !i.internal)
        .map(i => i!.address)
    : [address.address]
  return hosts.map(h => `${proto}://${formatHost(h)}:${address.port}`)
}

/**
 * Serve the devframe standalone on this dev server: SPA, discovery,
 * WebSocket RPC on Vite's own HTTP server at `<base>__ws`, auth gate.
 *
 * The instance is created per server and closed by *that* server's `close`
 * event, so a restart (which builds the new server before closing the old
 * one) can never tear down the new instance.
 */
export function mountStandalone(
  server: ViteDevServer,
  def: DevframeDefinition,
  { auth = true }: { auth?: boolean } = {},
): (() => Promise<void>) | undefined {
  let instance: DevframeInstance | undefined
  let closed = false
  const httpServer = server.httpServer

  server.middlewares.use((req, res, next) => {
    if (instance) return instance.nodeMiddleware(req, res, next)
    if (req.url?.startsWith(DEVFRAME_BASE)) {
      // Not listening yet (or already closed): don't let the app's SPA
      // fallback answer for the DevTools.
      res.statusCode = 503
      res.end('Svelte DevTools is starting')
      return
    }
    next()
  })

  if (!httpServer) {
    // Middleware mode: no server to share the upgrade with, so devframe
    // serves its SSE transport through the same middleware. There is no
    // `close` event either: the caller disposes via Vite's `closeServer` hook.
    const created = initDevframe(def, {
      base: DEVFRAME_BASE,
      ws: false,
      sse: true,
      mcp: false,
      auth,
    })
    instance = created
    return async () => {
      instance = undefined
      await created.close().catch(() => {})
    }
  }

  httpServer.once('listening', () => {
    const address = httpServer.address()
    if (closed || !address || typeof address === 'string') return
    const proto = server.config.server.https ? 'https' : 'http'
    const local = `${proto}://localhost:${address.port}`
    instance = initDevframe(def, {
      base: DEVFRAME_BASE,
      // Vite's https server is an HTTP/2 server with HTTP/1 fallback; it emits
      // the same `upgrade` events devframe listens for.
      server: httpServer as Server,
      mcp: false,
      auth,
      // The auth banner's magic link is built from `origin`; point it at the
      // SPA so opening it authenticates (the app root has no devframe client).
      origin: `${local}${DEVFRAME_BASE}`,
      allowedOrigins: networkOrigins(address, proto),
    })
    server.config.logger.info(`  ➜  Svelte DevTools: ${local}${DEVFRAME_BASE}`)
  })

  httpServer.once('close', () => {
    closed = true
    const current = instance
    instance = undefined
    current?.close().catch(() => {})
  })
  return undefined
}
