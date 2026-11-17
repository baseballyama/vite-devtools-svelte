import crypto from 'node:crypto';
import path from 'node:path';

import { launchEditor } from 'devframe/utils/launch-editor';
import { normalizePath } from 'vite';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { svelteInspector } from 'vite-devtools-svelte-inspector';
import type { InspectorLink } from 'vite-devtools-svelte-inspector';

import { serverResolver } from './analyzers/api.js';
import { analyzeComponents } from './analyzers/components.js';
import type { GraphModuleLike } from './analyzers/module-graph.js';
import { analyzeProject } from './analyzers/project.js';
import { analyzeRoutes } from './analyzers/routes.js';
import { createMcpMiddleware, MCP_PATH } from './mcp/http.js';
import { buildMcpServer } from './mcp/server.js';
import { SessionStore } from './mcp/sessions.js';
import { HOOKS_FILE, HOOKS_MODULE_ID, INSPECTOR_LINK_FILE } from './runtime/index.js';
import { injectModuleTracking, isSvelteModule } from './runtime/transform.js';
import { Collector } from './server/collector.js';
import { captureCompilerWarnings } from './server/compiler-warnings.js';
import { createSvelteDevframe, DEVFRAME_BASE } from './server/devframe.js';
import type { SvelteDevtoolsHost } from './server/devframe.js';
import { LOAD_RECORDER, loadProfileOf, profileLoad } from './server/load-profile.js';
import { mountStandalone, urlHost } from './server/mount.js';
import { svelteSupport } from './svelte-support.js';
import type { LoadProfile } from './types.js';

/**
 * Options of the Svelte Inspector in the app page: the same as
 * vite-plugin-svelte's `inspector` option.
 */
export interface SvelteDevtoolsInspectorOptions {
  /** Key combo that turns the inspector on and off. @default 'alt-x' */
  toggleKeyCombo?: string;
  /** Keys that move the selection to the parent / first child / next / previous element. */
  navKeys?: { parent: string; child: string; next: string; prev: string };
  /** Key that acts on the selected element, as a click does. @default 'Enter' */
  openKey?: string;
  /** Key that opens the menu of the selected element's components. @default ' ' */
  openMenuKey?: string;
  /** Keys that turn the inspector off. @default ['Backspace', 'Escape'] */
  escapeKeys?: string[];
  /** Holding the key combo turns the inspector on only until it is released. @default true */
  holdMode?: boolean;
  /** When to show the on-screen toggle button. @default 'active' */
  showToggleButton?: 'always' | 'active' | 'never';
  /** Where the toggle button is. @default 'top-right' */
  toggleButtonPos?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Outline the element under the cursor and change the cursor while on. @default true */
  customStyles?: boolean;
}

export interface SvelteDevtoolsOptions {
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
  clientAuth?: boolean;
  /**
   * The Svelte Inspector in the app page, in place of vite-plugin-svelte's
   * built-in one: hover an element to see its component and location; a
   * click selects that component instance in the DevTools, Alt+click opens
   * the element in your editor. Options left out are taken from
   * vite-plugin-svelte's `inspector` option, then the defaults. `false`
   * leaves the inspector out (and the "Pick element" button does nothing).
   * @default true
   */
  inspector?: boolean | SvelteDevtoolsInspectorOptions;
}

/** Name of `@vitejs/devtools`' config plugin; its presence means the hub will call our `devtools.setup`. */
const VITE_DEVTOOLS_PLUGIN = 'vite:devtools';

/** vite-plugin-svelte's config plugin; its `api.options` are the resolved Svelte options. */
const VITE_PLUGIN_SVELTE_CONFIG = 'vite-plugin-svelte:config';

/** The browser files served from disk (hooks.js and its neighbours; in `dist`, the inspector's too). */
const BROWSER_DIR = `${normalizePath(path.dirname(HOOKS_FILE))}/`;

/** vite-plugin-svelte's resolved options (its config plugin's api), if it is installed. */
function svelteOptionsOf(plugins: readonly Plugin[]) {
  const svelteConfig = plugins.find(p => p.name === VITE_PLUGIN_SVELTE_CONFIG);
  return (
    svelteConfig?.api as
      | {
          options?: {
            compilerOptions?: { experimental?: { devtools?: string[] } };
            inspector?: unknown;
          };
        }
      | undefined
  )?.options;
}

/**
 * Lists the hooks in the compiler's `experimental.devtools`, in the options
 * vite-plugin-svelte resolved (read when it compiles a component, including
 * libraries it prebundles). vite-plugin-svelte has no documented way to add
 * an entry yet.
 */
function addDevtoolsHooks(plugins: readonly Plugin[]): void {
  const options = svelteOptionsOf(plugins);
  if (!options) return;
  const compilerOptions = (options.compilerOptions ??= {});
  const experimental = (compilerOptions.experimental ??= {});
  const devtools = (experimental.devtools ??= []);
  if (!devtools.includes(HOOKS_FILE)) devtools.push(HOOKS_FILE);
}

// Shared by every plugin instance in the process: a config-file restart
// builds a *new* plugin instance for the new server, so only a process-wide
// counter tells the old instance that a newer server exists.
let serverGeneration = 0;

/** Collect every module the dev server knows, across Vite 8 environments (legacy graph as fallback). */
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
  const { clientAuth = true, inspector = true } = options;
  // Filled in configResolved (over vite-plugin-svelte's `inspector` option),
  // before the inspector plugin, listed after this one, reads it in its own.
  const inspectorOptions: SvelteDevtoolsInspectorOptions = {};
  // The inspector's link to the DevTools imports the hooks: dropped in
  // configResolved when the app's Svelte has no devtools events.
  const inspectorLink: InspectorLink = {};

  let config: ResolvedConfig;
  let server: ViteDevServer | undefined;
  let root: string;
  // When `@vitejs/devtools` is installed the hub mounts the devframe through
  // our `devtools` hook; otherwise we mount it ourselves. Never both: they
  // would claim the same base.
  let hostedByViteDevtools = false;
  // Plugins are `apply: 'serve'`, but a hook can still be reached outside dev
  // (a plugin list reused by another tool): every hook is inert unless serving.
  const serving = () => config?.command === 'serve';
  // Whether the app's Svelte has the devtools events the hooks listen to (set
  // in configResolved). Without them, nothing imports the hooks: they import
  // `svelte/internal/devtools`, and the compiler rejects `experimental.devtools`.
  let devtoolsEvents = false;
  const hooked = () => serving() && devtoolsEvents;
  // Per-process token for the MCP endpoint (MCP clients are local processes,
  // not browser tabs, so they cannot use devframe's browser auth handshake).
  const mcpToken = crypto.randomUUID();

  // Session store for AI-driven measurement workflows. Built lazily after
  // `root` is resolved.
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

    // Surfaces the per-process MCP token for inter-plugin (and test)
    // consumption, so tests need no production-only flag.
    api: {
      getDevtoolsToken: () => mcpToken,
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      root = config.root;
      hostedByViteDevtools = config.plugins.some(p => p.name === VITE_DEVTOOLS_PLUGIN);
      if (serving()) {
        const fromSvelteConfig = svelteOptionsOf(config.plugins)?.inspector;
        // (a restart with an inline config reuses this plugin: start over)
        for (const key of Object.keys(inspectorOptions) as Array<keyof typeof inspectorOptions>) {
          delete inspectorOptions[key];
        }
        Object.assign(
          inspectorOptions,
          typeof fromSvelteConfig === 'object' ? fromSvelteConfig : {},
          typeof inspector === 'object' ? inspector : {},
        );

        const support = svelteSupport(root);
        devtoolsEvents = support.devtoolsEvents;
        if (devtoolsEvents) inspectorLink.devtools = INSPECTOR_LINK_FILE;
        else delete inspectorLink.devtools;
        if (!devtoolsEvents && !process.env['VITEST']) {
          const why =
            support.version === undefined
              ? 'Svelte was not found'
              : `svelte@${support.version} has no devtools events (svelte/internal/devtools)`;
          config.logger.warn(
            `[vite-devtools-svelte] ${why}: components and state are not tracked. Update Svelte to a version that has them.`,
          );
        }
      }
      // Only while developing, and not inside Vitest (which runs `serve`).
      // vite-plugin-svelte resolved its options in its own `configResolved`
      // (order 'pre').
      if (hooked() && !process.env['VITEST']) {
        addDevtoolsHooks(config.plugins);
        // Components import the hooks by path (/@fs/...). Installed by link
        // or from outside the workspace, that path is not in fs.allow and
        // the browser gets a 403 for every component.
        config.server.fs.allow.push(path.dirname(HOOKS_FILE));
      }
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

      // Print a one-line `claude mcp add` snippet once the dev server is
      // actually listening — that's when we know the resolved port.
      devServer.httpServer?.once('listening', () => {
        const addr = devServer.httpServer?.address();
        if (!addr || typeof addr === 'string') return;
        const proto = devServer.config.server?.https ? 'https' : 'http';
        const url = `${proto}://${urlHost(addr.address)}:${addr.port}${MCP_PATH}`;
        const { logger } = devServer.config;
        logger.info('');
        logger.info(`  svelte-devtools MCP ready — register with Claude Code:`);
        logger.info(
          `    claude mcp add --transport http svelte ${url} --header x-svelte-devtools-token:${mcpToken}`,
        );
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
              getProject: () => analyzeProject(root),
              getRoutes: () => analyzeRoutes(analyzeProject(root).routesDir),
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
      );
      for (const m of doomed) middlewareModeMounts.splice(middlewareModeMounts.indexOf(m), 1);
      await Promise.all(doomed.map(m => m.dispose()));
    },

    // Module resolution: the alias of the hooks file, and Svelte as the
    // browser files served from disk import it.
    async resolveId(id, importer) {
      if (!serving()) return null;
      if (id === HOOKS_MODULE_ID) return HOOKS_FILE;
      // The hooks (and the inspector) must use the app's Svelte instance, not
      // one installed next to this package: resolve as if imported from the
      // project root.
      if (
        (id === 'svelte' || id.startsWith('svelte/')) &&
        importer !== undefined &&
        normalizePath(importer).startsWith(BROWSER_DIR)
      ) {
        return this.resolve(id, path.join(root, 'index.html'), { skipSelf: true });
      }
      return null;
    },

    // Inject the runtime into the user's app
    // 'pre': the tag is injected before Vite's own HTML processing, which
    // rewrites the inline module's bare `virtual:` import to a URL the browser
    // can load (as a normal-order hook, the browser requested
    // 'virtual:svelte-devtools-hooks' itself and failed with a CORS error).
    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!hooked()) return [];
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `import '${HOOKS_MODULE_ID}'`,
            injectTo: 'head-prepend',
          },
        ];
      },
    },

    // Vite DevTools integration: only invoked by `@vitejs/devtools`. The kit
    // is imported lazily so apps without Vite DevTools never load it.
    devtools: {
      capabilities: { dev: true, build: false },
      async setup(ctx) {
        const { createPluginFromDevframe } = await import('@vitejs/devtools-kit/node');
        const plugin = createPluginFromDevframe(devframe, { base: DEVFRAME_BASE });
        await plugin.devtools?.setup?.(ctx);
      },
    },
  };

  // Svelte modules (`.svelte.js/.ts`) import the hooks first; components get
  // the import from the compiler (see addDevtoolsHooks), which
  // vite-plugin-svelte does not pass on to modules.
  const trackingPlugin: Plugin = {
    name: 'vite-devtools-svelte:tracking',
    enforce: 'post',
    apply: 'serve',

    transform(code, id, transformOptions) {
      if (!hooked()) return null;
      if (id.includes('node_modules')) return null;
      // Client modules only: the runtime is browser code, and a server
      // render has no devtools to report to.
      if (transformOptions?.ssr) return null;
      const [file = id] = id.split('?');
      if (!isSvelteModule(file)) return null;
      const modified = injectModuleTracking(code);
      return modified === null ? null : { code: modified, map: null };
    },
  };

  // SvelteKit load function profiling: the transform wraps each exported
  // `load`, and the wrapper reports to a recorder the dev server exposes.
  const loadProfilePlugin: Plugin = {
    name: 'vite-devtools-svelte:load-profile',
    enforce: 'post',
    apply: 'serve',

    configureServer() {
      (globalThis as Record<string, unknown>)[LOAD_RECORDER] = (
        route: string,
        file: string,
        type: LoadProfile['type'],
        duration: number,
        dataSize: number,
      ) => {
        collector.recordLoadProfile(loadProfileOf({ route, file, type, duration, dataSize }));
      };
    },

    transform(code, id) {
      if (!serving()) return null;
      const profiled = profileLoad(code, id, root);
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
    // After mainPlugin, whose configResolved completes inspectorOptions.
    ...(inspector === false ? [] : [svelteInspector(inspectorOptions, inspectorLink)]),
  ];
}
