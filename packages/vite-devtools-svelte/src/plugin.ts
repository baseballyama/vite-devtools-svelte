import crypto from 'node:crypto'
import path from 'node:path'

import { launchEditor } from 'devframe/utils/launch-editor'
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'

import { analyzeComponents } from './analyzers/components.js'
import type { GraphModuleLike } from './analyzers/module-graph.js'
import { analyzeProject } from './analyzers/project.js'
import { analyzeRoutes } from './analyzers/routes.js'
import { createMcpMiddleware, MCP_PATH } from './mcp/http.js'
import { buildMcpServer } from './mcp/server.js'
import { SessionStore } from './mcp/sessions.js'
import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from './runtime/index.js'
import {
  injectComponentTracking,
  injectModuleTracking,
  SVELTE_MODULE_RE,
} from './runtime/transform.js'
import { Collector } from './server/collector.js'
import { captureCompilerWarnings } from './server/compiler-warnings.js'
import { createSvelteDevframe, DEVFRAME_BASE } from './server/devframe.js'
import type { SvelteDevtoolsHost } from './server/devframe.js'
import { LOAD_RECORDER, profileLoad } from './server/load-profile.js'
import { mountStandalone, urlHost } from './server/mount.js'
import { sveltekitTemplateInjector } from './server/template-injector.js'
import type { LoadProfile } from './types.js'

export interface SvelteDevtoolsOptions {
  /**
   * Enable component tracking via code injection.
   * @default true
   */
  componentTracking?: boolean
  /**
   * Require the one-time code before a browser can use the standalone
   * DevTools (`/.svelte-devtools/`). Set `false` to skip it on a trusted,
   * single-user machine.
   *
   * Beware: without it, any page or device that can reach the dev server
   * can read files in your project through the DevTools (including other
   * devices when the dev server listens on a LAN address, `--host`).
   * Inside the Vite DevTools dock this option has no effect: use
   * `DevTools({ clientAuth: false })` from `@vitejs/devtools` instead.
   * The MCP endpoint keeps its own token either way.
   * @default true
   */
  clientAuth?: boolean
}

/** Name of `@vitejs/devtools`' config plugin; its presence means the hub will call our `devtools.setup`. */
const VITE_DEVTOOLS_PLUGIN = 'vite:devtools'

// Shared by every plugin instance in the process: a config-file restart
// builds a *new* plugin instance for the new server, so only a process-wide
// counter tells the old instance that a newer server exists.
let serverGeneration = 0

/** Collect every module the dev server knows, across Vite 8 environments (legacy graph as fallback). */
function collectModules(server: ViteDevServer): GraphModuleLike[] {
  type WithGraph = { moduleGraph?: { idToModuleMap?: Map<string, GraphModuleLike> } }
  const modules: GraphModuleLike[] = []
  for (const env of Object.values(server.environments ?? {})) {
    const graph = (env as WithGraph).moduleGraph
    if (graph?.idToModuleMap) modules.push(...graph.idToModuleMap.values())
  }
  if (modules.length === 0) {
    const legacy = (server as WithGraph).moduleGraph
    if (legacy?.idToModuleMap) modules.push(...legacy.idToModuleMap.values())
  }
  return modules
}

export function svelteDevtools(options: SvelteDevtoolsOptions = {}): Plugin[] {
  const { componentTracking = true, clientAuth = true } = options

  let config: ResolvedConfig
  let server: ViteDevServer | undefined
  let root: string
  // When `@vitejs/devtools` is installed the hub mounts the devframe through
  // our `devtools` hook; otherwise we mount it ourselves. Never both: they
  // would claim the same base.
  let hostedByViteDevtools = false
  // Plugins are `apply: 'serve'`, but a hook can still be reached outside dev
  // (a plugin list reused by another tool): every hook is inert unless serving.
  const serving = () => config?.command === 'serve'
  // Per-process token for the MCP endpoint (MCP clients are local processes,
  // not browser tabs, so they cannot use devframe's browser auth handshake).
  const mcpToken = crypto.randomUUID()

  // Session store for AI-driven measurement workflows. Built lazily after
  // `root` is resolved.
  let sessions: SessionStore | null = null
  function getSessions(): SessionStore {
    sessions ??= new SessionStore({
      persistDir: path.join(root, 'node_modules', '.vite-devtools-svelte', 'sessions'),
      getters: {
        getRenderProfiles: () => collector.renderProfiles,
        getLoadProfiles: () => collector.loadProfiles,
        getFpsSamples: () => collector.fpsSamples,
      },
    })
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
        const dispose = mountStandalone(devServer, devframe, { auth: clientAuth })
        if (dispose) middlewareModeMounts.push({ generation, dispose })
      }

      // Print a one-line `claude mcp add` snippet once the dev server is
      // actually listening — that's when we know the resolved port.
      devServer.httpServer?.once('listening', () => {
        const addr = devServer.httpServer?.address()
        if (!addr || typeof addr === 'string') return
        const proto = devServer.config.server?.https ? 'https' : 'http'
        const url = `${proto}://${urlHost(addr.address)}:${addr.port}${MCP_PATH}`
        const { logger } = devServer.config
        logger.info('')
        logger.info(`  svelte-devtools MCP ready — register with Claude Code:`)
        logger.info(
          `    claude mcp add --transport http svelte ${url} --header x-svelte-devtools-token:${mcpToken}`,
        )
        logger.info('')
      })

      devServer.middlewares.use(
        MCP_PATH,
        createMcpMiddleware({
          token: mcpToken,
          collector,
          logger: devServer.config.logger,
          createServer: () =>
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
            }),
        }),
      )
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
    resolveId(id, importer) {
      if (!serving()) return null
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
      return null
    },

    load(id) {
      if (!serving()) return null
      if (id === RESOLVED_RUNTIME_ID) return runtimeCode
      if (id === WRAPPER_MODULE_ID) return wrapperCode
      return null
    },

    // Inject the runtime into the user's app
    // 'pre': the tag is injected before Vite's own HTML processing, which
    // rewrites the inline module's bare `virtual:` import to a URL the browser
    // can load (as a normal-order hook, the browser requested
    // 'virtual:svelte-devtools-runtime' itself and failed with a CORS error).
    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!serving()) return []
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `import '${RUNTIME_MODULE_ID}'`,
            injectTo: 'head-prepend',
          },
        ]
      },
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

    transform(code, id, transformOptions) {
      if (!componentTracking || !serving()) return null
      if (id.includes('node_modules')) return null
      // Client modules only: the runtime is browser code, and a server
      // render has no devtools to report to.
      if (transformOptions?.ssr) return null
      const [file = id] = id.split('?')
      const modified = file.endsWith('.svelte')
        ? injectComponentTracking(code, file)
        : SVELTE_MODULE_RE.test(file)
          ? injectModuleTracking(code, file)
          : null
      return modified === null ? null : { code: modified, map: null }
    },
  }

  // SvelteKit load function profiling: the transform wraps each exported
  // `load`, and the wrapper reports to a recorder the dev server exposes.
  const loadProfilePlugin: Plugin = {
    name: 'vite-devtools-svelte:load-profile',
    enforce: 'post',
    apply: 'serve',

    configureServer() {
      ;(globalThis as Record<string, unknown>)[LOAD_RECORDER] = (
        route: string,
        file: string,
        type: LoadProfile['type'],
        duration: number,
        dataSize: number,
      ) => {
        collector.recordLoadProfile({
          route,
          file,
          type,
          duration: Math.round(duration * 100) / 100,
          dataSize,
          timestamp: Date.now(),
        })
      }
    },

    transform(code, id) {
      if (!serving()) return null
      const profiled = profileLoad(code, id, root)
      return profiled === null ? null : { code: profiled, map: null }
    },
  }

  const warningCapturePlugin: Plugin = {
    name: 'vite-devtools-svelte:warning-capture',
    enforce: 'post',
    apply: 'serve',

    configResolved(resolvedConfig) {
      if (resolvedConfig.command !== 'serve') return
      captureCompilerWarnings(resolvedConfig.plugins, w => collector.recordCompilerWarning(w))
    },
  }

  return [
    mainPlugin,
    trackingPlugin,
    loadProfilePlugin,
    warningCapturePlugin,
    sveltekitTemplateInjector(() => hostedByViteDevtools),
  ]
}
