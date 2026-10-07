import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchEditor } from 'devframe/utils/launch-editor'
import { analyzeRoutes } from './analyzers/routes.js'
import { analyzeProject } from './analyzers/project.js'
import { analyzeComponents } from './analyzers/components.js'
import type { GraphModuleLike } from './analyzers/module-graph.js'
import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from './runtime.js'
import { Collector } from './collector.js'
import { createSvelteDevframe, DEVFRAME_BASE } from './devframe.js'
import type { SvelteDevtoolsHost } from './devframe.js'
import { mountStandalone } from './mount.js'
import { SessionStore } from './mcp/sessions.js'
import { buildMcpServer, StreamableHTTPServerTransport } from './mcp/server.js'
import { sveltekitTemplateInjector } from './template-injector.js'
import type { LoadProfile } from './types.js'

export interface SvelteDevtoolsOptions {
  /**
   * Enable component tracking via code injection.
   * @default true
   */
  componentTracking?: boolean
}

/** Name of `@vitejs/devtools`' config plugin; its presence means the hub will call our `devtools.setup`. */
const VITE_DEVTOOLS_PLUGIN = 'vite:devtools'
const WARN_SINK = Symbol.for('vite-devtools-svelte:warn-sink')

// Shared by every plugin instance in the process: a config-file restart
// builds a *new* plugin instance for the new server, so only a process-wide
// counter tells the old instance that a newer server exists.
let serverGeneration = 0

/** Collect every module the dev server knows, across Vite 8 environments (legacy graph as fallback). */
function collectModules(server: ViteDevServer): GraphModuleLike[] {
  const modules: GraphModuleLike[] = []
  for (const env of Object.values(server.environments ?? {})) {
    const graph = (env as { moduleGraph?: { idToModuleMap?: Map<string, GraphModuleLike> } })
      .moduleGraph
    if (graph?.idToModuleMap) modules.push(...graph.idToModuleMap.values())
  }
  if (modules.length === 0) {
    const legacy = (server as { moduleGraph?: { idToModuleMap?: Map<string, GraphModuleLike> } })
      .moduleGraph
    if (legacy?.idToModuleMap) modules.push(...legacy.idToModuleMap.values())
  }
  return modules
}

/**
 * Component-tracking transform for one compiled client `.svelte` module:
 * imports the runtime and names the file for the wrapper's next `push()`.
 * `null` when the module has no component (`$.push(`) to track.
 *
 * Nothing is inserted as a new line, so every original line keeps its
 * number (`map: null` = mappings unchanged; stack traces and the
 * compiler's sourcemap stay aligned).
 */
export function injectComponentTracking(code: string, id: string): string | null {
  if (!code.includes('$.push(')) return null
  const safeId = JSON.stringify(id)
  return (
    `import '${RUNTIME_MODULE_ID}';` +
    code.replace(
      /(\$\.push\([^)]+\);?)/,
      `if (typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__) { window.__SVELTE_DEVTOOLS__._pendingFile = ${safeId}; } $1`,
    )
  )
}

/** A Svelte module (`.svelte.js` / `.svelte.ts`, runes outside components). */
export const SVELTE_MODULE_RE = /\.svelte\.[cm]?[jt]s$/

/**
 * Module-scope transform for one client Svelte module: signals created while
 * its body runs (shared state, `export const cart = $state(...)`) are tracked
 * under a scope named after the file. The body is bracketed by enter/leave
 * calls; nothing is inserted as a new line. The bracket is plain JS, so it
 * works before or after vite-plugin-svelte compiles the module (with
 * `svelteDevtools()` listed before `sveltekit()`, a `.svelte.ts` module is
 * compiled after this transform). `null` for a server-compiled module.
 */
export function injectModuleTracking(code: string, id: string): string | null {
  if (code.includes('svelte/internal/server')) return null
  const safeId = JSON.stringify(id)
  const dt = `(typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__)`
  return (
    `import '${RUNTIME_MODULE_ID}';if (${dt}) { window.__SVELTE_DEVTOOLS__._enterModule(${safeId}); }` +
    code +
    `\n;if (${dt}) { window.__SVELTE_DEVTOOLS__._leaveModule(); }\n`
  )
}

export function svelteDevtools(options: SvelteDevtoolsOptions = {}): Plugin[] {
  const { componentTracking = true } = options

  let config: ResolvedConfig
  let server: ViteDevServer | undefined
  let root: string
  // When `@vitejs/devtools` is installed the hub mounts the devframe through
  // our `devtools` hook; otherwise we mount it ourselves. Never both: they
  // would claim the same base.
  let hostedByViteDevtools = false
  // Per-process token for the MCP endpoint (MCP clients are local processes,
  // not browser tabs, so they cannot use devframe's browser auth handshake).
  const mcpToken = crypto.randomUUID()

  // Session store for AI-driven measurement workflows. Built lazily after
  // `root` is resolved.
  let sessions: SessionStore | null = null
  function getSessions(): SessionStore {
    if (!sessions) {
      sessions = new SessionStore({
        persistDir: path.join(root, 'node_modules', '.vite-devtools-svelte', 'sessions'),
        getters: {
          getRenderProfiles: () => collector.renderProfiles,
          getLoadProfiles: () => collector.loadProfiles,
          getFpsSamples: () => collector.fpsSamples,
        },
      })
    }
    return sessions
  }

  const collector = new Collector({
    onFpsSample: sample => getSessions().recordFpsSample(sample),
    onLoadProfile: profile => getSessions().recordLoadProfile(profile),
  })

  const host: SvelteDevtoolsHost = {
    collector,
    root: () => root,
    publicBase: () => config?.base ?? '/',
    modules: () => (server ? collectModules(server) : []),
    transformRequest: file => (server ? server.transformRequest(file) : Promise.resolve(null)),
    serverOrigins: () => {
      const urls = server?.resolvedUrls
      if (!urls) return []
      return [...urls.local, ...urls.network].map(u => new URL(u).origin)
    },
    openInEditor: target => launchEditor(target),
  }
  const devframe = createSvelteDevframe(host)
  const middlewareModeMounts: Array<{ generation: number; dispose: () => Promise<void> }> = []

  const mainPlugin: Plugin = {
    name: 'vite-devtools-svelte',
    enforce: 'pre',
    apply: 'serve',

    // Surfaces the per-process MCP token for inter-plugin (and test)
    // consumption, so tests need no production-only flag.
    api: {
      getDevtoolsToken: () => mcpToken,
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig
      root = config.root
      hostedByViteDevtools = config.plugins.some(p => p.name === VITE_DEVTOOLS_PLUGIN)
    },

    configureServer(devServer) {
      server = devServer
      const generation = ++serverGeneration
      collector.attach(devServer.hot)
      devServer.httpServer?.once('close', () => {
        if (server === devServer) {
          collector.detach()
          server = undefined
        }
      })

      if (!hostedByViteDevtools) {
        const dispose = mountStandalone(devServer, devframe)
        if (dispose) middlewareModeMounts.push({ generation, dispose })
      }

      const mcpServerFactory = () =>
        buildMcpServer({
          getProject: () => analyzeProject(root),
          getRoutes: () => analyzeRoutes(analyzeProject(root).routesDir),
          getLiveComponents: () => collector.liveComponents,
          getLiveSnapshot: () => collector.liveSnapshot,
          getComponentRelations: () => analyzeComponents(root),
          getRenderProfiles: () => collector.renderProfiles,
          getReactiveGraph: () => collector.requestReactiveGraph(),
          getLoadProfiles: () => collector.loadProfiles,
          getFpsSamples: () => collector.fpsSamples,
          sessions: getSessions(),
          getReactiveSummary: req => collector.requestReactiveSummary(req),
          getReactiveScope: req => collector.requestReactiveGraph(req),
          getStateTimelineDelta: since => collector.getStateTimelineDelta(since),
          getCaptureInfo: () => collector.getCaptureInfo(),
        })

      // Print a one-line `claude mcp add` snippet once the dev server is
      // actually listening — that's when we know the resolved port.
      devServer.httpServer?.once('listening', () => {
        try {
          const addr = devServer.httpServer?.address()
          if (!addr || typeof addr === 'string') return
          const proto = devServer.config.server?.https ? 'https' : 'http'
          // For wildcard / loopback bindings prefer the literal `localhost`
          // so the printed URL parses as-is. Brackets aren't enough for `::`
          // (wildcard) and `::1` is just a more verbose form of loopback.
          const loopbackOrWildcard =
            addr.address === '::' ||
            addr.address === '0.0.0.0' ||
            addr.address === '::1' ||
            addr.address === '127.0.0.1'
          const hostName = loopbackOrWildcard
            ? 'localhost'
            : addr.family === 'IPv6'
              ? `[${addr.address}]`
              : addr.address
          const url = `${proto}://${hostName}:${addr.port}/__svelte-devtools/mcp`
          const cmd = `claude mcp add --transport http svelte ${url} --header x-svelte-devtools-token:${mcpToken}`
          devServer.config.logger.info('')
          devServer.config.logger.info(`  svelte-devtools MCP ready — register with Claude Code:`)
          devServer.config.logger.info(`    ${cmd}`)
          devServer.config.logger.info('')
        } catch {
          /* logging is best-effort */
        }
      })

      // MCP endpoint: lets AI agents (Claude Code etc.) read metrics + run
      // measurement sessions over the Streamable HTTP transport. Same-origin
      // is *not* required because MCP clients are local processes that don't
      // run inside a browser tab; the token is the gate.
      devServer.middlewares.use('/__svelte-devtools/mcp', async (req, res) => {
        const tokenHeader = req.headers['x-svelte-devtools-token']
        const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader
        if (token !== mcpToken) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        // An agent talking to us is a consumer: keep the runtime sampling. If
        // this request woke the runtime up, give it a moment to send its
        // activation snapshot so the first answer isn't stale.
        if (collector.lease('mcp', 60_000)) await collector.waitForSnapshot(1000)
        // Build a fresh server+transport per request. Stateless mode in the
        // SDK still keeps per-instance bookkeeping that gets corrupted when
        // the same transport handles multiple requests.
        const mcpServer = mcpServerFactory()
        const mcpTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        mcpTransport.onerror = err => {
          devServer.config.logger.error(
            `[svelte-devtools] MCP transport error: ${err.stack || err.message}`,
          )
        }
        try {
          await mcpServer.connect(mcpTransport)
          // The SDK consumes the request body itself; pre-reading would
          // leave the stream empty.
          await mcpTransport.handleRequest(req as any, res as any)
        } catch (e) {
          devServer.config.logger.error(
            `[svelte-devtools] MCP handler error: ${
              e instanceof Error ? e.stack || e.message : String(e)
            }`,
          )
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(e) }))
          }
        } finally {
          await mcpTransport.close().catch(() => {})
          await mcpServer.close().catch(() => {})
        }
      })
    },

    // Middleware-mode mounts have no `httpServer` close event; dispose them
    // from Vite's public `closeServer` hook (>= 8.3), which runs after the
    // server is torn down but carries no server reference. On restart Vite has
    // already configured the replacement server, so every mount older than
    // the newest server generation belongs to the server being torn down —
    // whether that server used this plugin instance (inline config) or a
    // previous one (config file, re-evaluated per restart).
    async closeServer({ reason }) {
      const doomed = middlewareModeMounts.filter(
        m => reason === 'close' || m.generation < serverGeneration,
      )
      for (const m of doomed) middlewareModeMounts.splice(middlewareModeMounts.indexOf(m), 1)
      await Promise.all(doomed.map(m => m.dispose()))
    },

    // Virtual module resolution: runtime + svelte/internal/client wrapper.
    // dev only — never resolve our virtual modules during production build.
    resolveId(id, importer) {
      if (config?.command !== 'serve') return undefined
      if (id === RUNTIME_MODULE_ID) return RESOLVED_RUNTIME_ID
      if (
        componentTracking &&
        id === 'svelte/internal/client' &&
        importer &&
        !importer.includes('node_modules') &&
        !importer.startsWith('\0')
      ) {
        return WRAPPER_MODULE_ID
      }
      return undefined
    },

    load(id) {
      if (config?.command !== 'serve') return undefined
      if (id === RESOLVED_RUNTIME_ID) return runtimeCode
      if (id === WRAPPER_MODULE_ID) return wrapperCode
      return undefined
    },

    // Inject the runtime into the user's app
    transformIndexHtml() {
      if (config.command !== 'serve') return []
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: `import '${RUNTIME_MODULE_ID}'`,
          injectTo: 'head-prepend',
        },
      ]
    },

    // Vite DevTools integration: only invoked by `@vitejs/devtools`. The kit
    // is imported lazily so apps without Vite DevTools never load it.
    devtools: {
      capabilities: { dev: true, build: false },
      async setup(ctx) {
        const { createPluginFromDevframe } = await import('@vitejs/devtools-kit/node')
        const plugin = createPluginFromDevframe(devframe, { base: DEVFRAME_BASE })
        await plugin.devtools?.setup?.(ctx)
      },
    },
  }

  // Minimal component tracking transform plugin.
  // Only injects the file path before $.push() so the runtime wrapper knows
  // which component file is being initialized. All reactive tracking (state,
  // derived, proxy, effect) is handled by the svelte/internal/client wrapper.
  const trackingPlugin: Plugin = {
    name: 'vite-devtools-svelte:tracking',
    enforce: 'post',
    apply: 'serve',

    transform(code, id, options) {
      if (!componentTracking) return null
      if (id.includes('node_modules')) return null
      if (config?.command !== 'serve') return null
      const file = id.split('?')[0]
      const modified = file.endsWith('.svelte')
        ? injectComponentTracking(code, id)
        : SVELTE_MODULE_RE.test(file) && !options?.ssr
          ? injectModuleTracking(code, file)
          : null
      return modified === null ? null : { code: modified, map: null }
    },
  }

  // Load function profiling transform plugin
  const loadProfilePlugin: Plugin = {
    name: 'vite-devtools-svelte:load-profile',
    enforce: 'post',
    apply: 'serve',

    transform(code, id) {
      if (config?.command !== 'serve') return null
      // Only transform SvelteKit load files
      const isServerLoad = /\+page\.server\.[tj]s$/.test(id) || /\+layout\.server\.[tj]s$/.test(id)
      const isUniversalLoad = /\+(page|layout)\.[tj]s$/.test(id) && !id.includes('.server.')
      if (!isServerLoad && !isUniversalLoad) return null
      if (id.includes('node_modules')) return null
      // Must have an exported load function
      if (!code.includes('export') || !code.includes('load')) return null

      const loadType = isServerLoad ? 'server' : 'universal'
      // Determine route from file path
      const routesMatch = id.match(/routes(.*)\/\+/)
      const route = routesMatch ? routesMatch[1] || '/' : '/'
      const safeRoute = JSON.stringify(route)
      const safeFile = JSON.stringify(id)
      const safeType = JSON.stringify(loadType)

      // Replace the exported load function with a profiled version.
      // Supports both `export const load = ...` and `export (async) function load(...)` patterns.
      let transformed = code.replace(/export\s+const\s+load\s*=\s*/, `const __original_load = `)

      if (transformed === code) {
        // Try `export function load` / `export async function load` pattern
        transformed = code.replace(
          /export\s+(async\s+)?function\s+load\s*\(/,
          `const __original_load = $1function __load_impl(`,
        )
      }

      if (transformed === code) return null // no match found

      const profiledExport = `
export const load = async (event) => {
  const __start = performance.now();
  const __result = await __original_load(event);
  const __duration = performance.now() - __start;
  const __dataSize = JSON.stringify(__result || {}).length;
  if (typeof globalThis.__svelte_devtools_record_load === 'function') {
    globalThis.__svelte_devtools_record_load(${safeRoute}, ${safeFile}, ${safeType}, __duration, __dataSize);
  }
  return __result;
};
`
      return { code: transformed + profiledExport, map: null }
    },
  }

  // Register load profiling hook on server
  const loadProfileServerPlugin: Plugin = {
    name: 'vite-devtools-svelte:load-profile-server',
    apply: 'serve',

    configureServer() {
      // Make the recording function available globally on the server
      ;(globalThis as Record<string, unknown>).__svelte_devtools_record_load = (
        route: string,
        file: string,
        type: string,
        duration: number,
        dataSize: number,
      ) => {
        const entry: LoadProfile = {
          route,
          file,
          type: type as 'server' | 'universal',
          duration: Math.round(duration * 100) / 100,
          dataSize,
          timestamp: Date.now(),
        }
        collector.recordLoadProfile(entry)
      }
    },
  }

  // Compiler warning capture plugin
  const warningCapturePlugin: Plugin = {
    name: 'vite-devtools-svelte:warning-capture',
    enforce: 'post',
    apply: 'serve',

    configResolved(resolvedConfig) {
      // Intercept Svelte compiler warnings from the logger. A user
      // `customLogger` survives restarts, so the wrapper is installed once and
      // forwards to whichever plugin instance configured it last.
      const logger = resolvedConfig.logger as typeof resolvedConfig.logger & {
        [WARN_SINK]?: (msg: string) => void
      }
      const wrapped = WARN_SINK in logger
      logger[WARN_SINK] = msg => {
        // Svelte compiler warnings usually contain file paths and codes
        if (!msg.includes('.svelte') || config?.command !== 'serve') return
        const fileMatch = msg.match(/(?:^|\s)((?:\/|\.\/|\w:)[^\s:]+\.svelte)(?::(\d+):(\d+))?/)
        const codeMatch = msg.match(/\(([a-z0-9_-]+)\)/)
        collector.recordCompilerWarning({
          code: codeMatch?.[1] || 'unknown',
          // oxlint-disable-next-line no-control-regex -- intentional: strip ANSI escape sequences
          message: msg.replace(/\x1b\[[0-9;]*m/g, '').trim(),
          file: fileMatch?.[1] || '',
          line: fileMatch?.[2] ? parseInt(fileMatch[2]) : undefined,
          column: fileMatch?.[3] ? parseInt(fileMatch[3]) : undefined,
        })
      }
      if (wrapped) return
      const originalWarn = logger.warn
      logger.warn = (msg: string, options?: { timestamp?: boolean }) => {
        logger[WARN_SINK]?.(msg)
        originalWarn(msg, options)
      }
    },
  }

  return [
    mainPlugin,
    trackingPlugin,
    loadProfilePlugin,
    loadProfileServerPlugin,
    warningCapturePlugin,
    sveltekitTemplateInjector(() => hostedByViteDevtools),
  ]
}
