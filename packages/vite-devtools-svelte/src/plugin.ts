import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { launchEditor } from 'devframe/utils/launch-editor';
import { normalizePath } from 'vite';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

import { serverResolver } from './analyzers/api.js';
import { analyzeComponents } from './analyzers/components.js';
import type { GraphModuleLike } from './analyzers/module-graph.js';
import { analyzeProject } from './analyzers/project.js';
import { analyzeRoutes } from './analyzers/routes.js';
import { inspectorPlugin, isInspectorRuntime } from './inspector.js';
import type { InspectorOptions } from './inspector.js';
import { createMcpMiddleware, MCP_PATH } from './mcp/http.js';
import { registerServer, registryDir } from './mcp/registry.js';
import { buildMcpServer } from './mcp/server.js';
import { SessionStore } from './mcp/sessions.js';
import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from './runtime/index.js';
import {
  injectComponentTracking,
  injectModuleTracking,
  isSvelteModule,
} from './runtime/transform.js';
import { Collector, HOT_EVENTS } from './server/collector.js';
import { captureCompilerWarnings } from './server/compiler-warnings.js';
import { createSvelteDevframe, DEVFRAME_BASE } from './server/devframe.js';
import type { SvelteDevtoolsHost } from './server/devframe.js';
import {
  LOAD_RECORDER,
  loadProfileOf,
  parseLoadReport,
  profileLoad,
} from './server/load-profile.js';
import type { LoadReport } from './server/load-profile.js';
import { mountStandalone, urlHost } from './server/mount.js';
import type { LoadProfile } from './types.js';

export interface SvelteDevtoolsOptions {
  /**
   * Enable component tracking via code injection.
   * @default true
   */
  componentTracking?: boolean;
  /**
   * Require the one-time code before a browser can use the standalone
   * DevTools (`/.svelte-devtools/`). Set `false` to skip it on a trusted,
   * single-user machine.
   *
   * Beware: without it, any page or device that can reach the dev server
   * can read files in your project through the DevTools (including other
   * devices when the dev server listens on a LAN address, `--host`).
   * Inside the Vite DevTools dock this option has no effect: use
   * `devtools: { apply: 'serve', clientAuth: false }` in the Vite config instead.
   * The MCP endpoint keeps its own token either way.
   * @default true
   */
  clientAuth?: boolean;
  /**
   * The Svelte Inspector: hold the toggle key combo (`alt-x` by default) and
   * click an element to open its source in your editor. It only runs in the
   * Vite DevTools dock (`@vitejs/devtools`). The dev server fails to start when
   * vite-plugin-svelte's built-in inspector is configured too (`vitePlugin.inspector`):
   * turn that one off.
   */
  inspector?: InspectorOptions;
}

/** When `@vitejs/devtools`' config plugin is present, the hub calls our `devtools.setup`. */
const VITE_DEVTOOLS_PLUGIN = 'vite:devtools';

// Shared by every plugin instance in the process: a config-file restart
// builds a *new* plugin instance for the new server, so only a process-wide
// counter tells the old instance that a newer server exists.
let serverGeneration = 0;

/**
 * Relative to `root`, as the panels show it (open-in-editor resolves it against
 * the root again); absolute when outside the root, e.g. a root reached through a symlink while module ids are real paths.
 */
function displayPath(root: string, file: string): string {
  const rel = path.posix.relative(root, file);
  return rel.startsWith('../') ? file : rel;
}

function collectModules(server: ViteDevServer): GraphModuleLike[] {
  type WithGraph = { moduleGraph?: { idToModuleMap?: Map<string, GraphModuleLike> } };
  const modules: GraphModuleLike[] = [];
  for (const env of Object.values(server.environments ?? {})) {
    const graph = (env as WithGraph).moduleGraph;
    if (graph?.idToModuleMap) modules.push(...graph.idToModuleMap.values());
  }
  if (modules.length === 0) {
    const legacy = (server as WithGraph).moduleGraph;
    if (legacy?.idToModuleMap) modules.push(...legacy.idToModuleMap.values());
  }
  return modules;
}

export function svelteDevtools(options: SvelteDevtoolsOptions = {}): Plugin[] {
  const { componentTracking = true, clientAuth = true } = options;

  let config: ResolvedConfig;
  let server: ViteDevServer | undefined;
  let root: string;
  // SvelteKit's resolved `files.routes` (absolute); undefined without SvelteKit.
  let routesDir: string | undefined;
  // When `@vitejs/devtools` is installed the hub mounts the devframe through
  // our `devtools` hook; otherwise we mount it ourselves. Never both: they
  // would claim the same base.
  let hostedByViteDevtools = false;
  // Plugins are `apply: 'serve'`, but a hook can still be reached outside dev
  // (a plugin list reused by another tool): every hook is inert unless serving.
  const serving = () => config?.command === 'serve';
  // MCP clients are local processes, not browser tabs, so they cannot use
  // devframe's browser auth handshake.
  const mcpToken = crypto.randomUUID();

  // Built lazily: `root` is resolved later.
  let sessions: SessionStore | null = null;
  function getSessions(): SessionStore {
    sessions ??= new SessionStore({
      persistDir: path.join(root, 'node_modules', '.vite-devtools-svelte', 'sessions'),
      getters: {
        getRenderProfiles: () => collector.renderProfiles,
        getLoadProfiles: () => collector.loadProfiles,
        getFpsSamples: () => collector.fpsSamples,
      },
    });
    return sessions;
  }

  const collector = new Collector({
    onFpsSample: sample => getSessions().recordFpsSample(sample),
    onLoadProfile: profile => getSessions().recordLoadProfile(profile),
  });

  const host: SvelteDevtoolsHost = {
    collector,
    root: () => root,
    routesDir: () => routesDir,
    publicBase: () => config?.base ?? '/',
    modules: () => (server ? collectModules(server) : []),
    transformRequest: file => (server ? server.transformRequest(file) : Promise.resolve(null)),
    resolveFile: serverResolver(() => server),
    serverOrigins: () => {
      const urls = server?.resolvedUrls;
      if (!urls) return [];
      return [...urls.local, ...urls.network].map(u => new URL(u).origin);
    },
    openInEditor: target => launchEditor(target),
  };
  const devframe = createSvelteDevframe(host);
  const middlewareModeMounts: Array<{ generation: number; dispose: () => Promise<void> }> = [];

  const mainPlugin: Plugin = {
    name: 'vite-devtools-svelte',
    enforce: 'pre',
    apply: 'serve',

    // Lets tests read the MCP token without a production-only flag.
    api: {
      getDevtoolsToken: () => mcpToken,
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      root = config.root;
      // SvelteKit's `files.routes`, made absolute in its `config` hook (read
      // the way its own `extract_svelte_config` does).
      const kit = config.plugins.find(p => p.name === 'vite-plugin-sveltekit-setup')?.api as
        | { options?: { files?: { routes?: unknown } } }
        | undefined;
      const routes = kit?.options?.files?.routes;
      routesDir = typeof routes === 'string' ? normalizePath(routes) : undefined;
      hostedByViteDevtools = config.plugins.some(p => p.name === VITE_DEVTOOLS_PLUGIN);
    },

    configureServer(devServer) {
      server = devServer;
      const generation = ++serverGeneration;
      collector.attach(devServer.hot);
      // The watcher closes with its server, so these listeners need no cleanup.
      const sourceChanged = () => collector.sourceChanged();
      devServer.watcher.on('add', sourceChanged);
      devServer.watcher.on('change', sourceChanged);
      devServer.watcher.on('unlink', sourceChanged);
      devServer.httpServer?.once('close', () => {
        if (server === devServer) {
          collector.detach();
          server = undefined;
        }
      });

      if (!hostedByViteDevtools) {
        const dispose = mountStandalone(devServer, devframe, { auth: clientAuth });
        if (dispose) middlewareModeMounts.push({ generation, dispose });
      }

      // The resolved port is known only once the server is listening.
      devServer.httpServer?.once('listening', () => {
        const addr = devServer.httpServer?.address();
        if (!addr || typeof addr === 'string') return;
        const proto = devServer.config.server?.https ? 'https' : 'http';
        const url = `${proto}://${urlHost(addr.address)}:${addr.port}${MCP_PATH}`;
        const { logger } = devServer.config;
        // Lets `vite-devtools-svelte mcp` find this server without a port or token.
        try {
          const unregister = registerServer(registryDir(), {
            id: `${process.pid}-${addr.port}`,
            host: os.hostname(),
            pid: process.pid,
            url,
            token: mcpToken,
            root,
            packageName: analyzeProject(root, routesDir !== undefined).name,
            startedAt: Date.now(),
          });
          // A killed process never closes its http server.
          process.once('exit', unregister);
          devServer.httpServer?.once('close', () => {
            process.off('exit', unregister);
            unregister();
          });
        } catch (e) {
          logger.warn(`[svelte-devtools] could not register the MCP endpoint: ${String(e)}`);
        }
        logger.info('');
        logger.info(`  svelte-devtools MCP ready — register it once with Claude Code:`);
        logger.info(`    claude mcp add svelte-devtools -- npx @sveltejs/vite-devtools-svelte mcp`);
        logger.info('');
      });

      devServer.middlewares.use(
        MCP_PATH,
        createMcpMiddleware({
          token: mcpToken,
          collector,
          logger: devServer.config.logger,
          createServer: () =>
            buildMcpServer({
              getProject: () => analyzeProject(root, routesDir !== undefined),
              getRoutes: () => analyzeRoutes(routesDir),
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
      );
    },

    // Middleware-mode mounts have no `httpServer` close event, and `closeServer`
    // (Vite >= 8.3) carries no server reference. On restart Vite has already
    // configured the replacement server, so every mount older than the newest
    // generation belongs to the server being torn down, whichever plugin
    // instance (inline config or re-evaluated config file) made it.
    async closeServer({ reason }) {
      const doomed = middlewareModeMounts.filter(
        m => reason === 'close' || m.generation < serverGeneration,
      );
      for (const m of doomed) middlewareModeMounts.splice(middlewareModeMounts.indexOf(m), 1);
      await Promise.all(doomed.map(m => m.dispose()));
    },

    resolveId(id, importer) {
      if (!serving()) return null;
      if (id === RUNTIME_MODULE_ID) return RESOLVED_RUNTIME_ID;
      if (
        componentTracking &&
        id === 'svelte/internal/client' &&
        importer &&
        !importer.includes('node_modules') &&
        !isInspectorRuntime(importer) &&
        !importer.startsWith('\0')
      ) {
        return WRAPPER_MODULE_ID;
      }
      return null;
    },

    load(id) {
      if (!serving()) return null;
      if (id === RESOLVED_RUNTIME_ID) return runtimeCode;
      if (id === WRAPPER_MODULE_ID) return wrapperCode;
      return null;
    },

    // 'pre' so Vite's own HTML processing rewrites the bare `virtual:` import to
    // a URL; otherwise the browser requests it itself and fails with a CORS error.
    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!serving()) return [];
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `import '${RUNTIME_MODULE_ID}'`,
            injectTo: 'head-prepend',
          },
        ];
      },
    },

    // Imported lazily so apps without Vite DevTools never load the kit.
    devtools: {
      capabilities: { dev: true, build: false },
      async setup(ctx) {
        const { createPluginFromDevframe } = await import('@vitejs/devtools-kit/node');
        const plugin = createPluginFromDevframe(devframe, { base: DEVFRAME_BASE });
        await plugin.devtools?.setup?.(ctx);
      },
    },
  };

  // Only injects the file path before $.push(); all reactive tracking is done
  // by the svelte/internal/client wrapper.
  const trackingPlugin: Plugin = {
    name: 'vite-devtools-svelte:tracking',
    enforce: 'post',
    apply: 'serve',

    transform(code, id, transformOptions) {
      if (!componentTracking || !serving()) return null;
      if (id.includes('node_modules') || isInspectorRuntime(id)) return null;
      // Client modules only: the runtime is browser code, and a server
      // render has no devtools to report to.
      if (transformOptions?.ssr) return null;
      const [file = id] = id.split('?');
      const modified = file.endsWith('.svelte')
        ? injectComponentTracking(code, file)
        : isSvelteModule(file)
          ? injectModuleTracking(code, file)
          : null;
      return modified === null ? null : { code: modified, map: null };
    },
  };

  const recordLoad = (report: LoadReport) =>
    collector.recordLoadProfile(loadProfileOf({ ...report, file: displayPath(root, report.file) }));

  // The transform wraps each exported `load`, which reports to this recorder
  // on the server and over the hot channel in the browser.
  const loadProfilePlugin: Plugin = {
    name: 'vite-devtools-svelte:load-profile',
    enforce: 'post',
    apply: 'serve',

    configureServer(devServer) {
      (globalThis as Record<string, unknown>)[LOAD_RECORDER] = (
        route: string,
        file: string,
        type: LoadProfile['type'],
        duration: number,
        dataSize: number,
      ) => recordLoad({ route, file, type, duration, dataSize });
      // The hot channel closes with its server, so this listener needs no cleanup.
      devServer.hot.on(HOT_EVENTS.loadProfile, payload => {
        const report = parseLoadReport(payload);
        if (report) recordLoad(report);
      });
    },

    transform(code, id) {
      if (!serving() || !routesDir) return null;
      const profiled = profileLoad(code, id, routesDir);
      return profiled === null ? null : { code: profiled, map: null };
    },
  };

  const warningCapturePlugin: Plugin = {
    name: 'vite-devtools-svelte:warning-capture',
    enforce: 'post',
    apply: 'serve',

    configResolved(resolvedConfig) {
      if (resolvedConfig.command !== 'serve') return;
      captureCompilerWarnings(resolvedConfig.plugins, w => collector.recordCompilerWarning(w));
    },
  };

  return [
    mainPlugin,
    trackingPlugin,
    loadProfilePlugin,
    warningCapturePlugin,
    inspectorPlugin(options.inspector),
  ];
}
