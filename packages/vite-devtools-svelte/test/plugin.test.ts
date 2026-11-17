import http from 'node:http';
import path from 'node:path';

import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { svelteDevtools } from '../src/plugin.js';
import { HOOKS_FILE, HOOKS_MODULE_ID } from '../src/runtime/index.js';
import { callHook, kitSetup, resolvePlugins } from './helpers.js';

// The app's Svelte as svelteSupport finds it from the root (svelte-support.test.ts
// covers the lookup): one with the devtools events, unless a test changes it.
const svelte = vi.hoisted(() => ({
  version: '5.99.0' as string | undefined,
  devtoolsEvents: true,
}));
vi.mock('../src/svelte-support.js', () => ({ svelteSupport: () => ({ ...svelte }) }));
const shape = (p: Plugin) => ({
  name: p.name,
  enforce: p.enforce,
  apply: typeof p.apply === 'function' ? 'fn' : p.apply,
});

describe('svelteDevtools factory', () => {
  it('returns the dev-only plugins in hook order', () => {
    // main (pre) resolves the runtime and the hooks; the transforms (post)
    // run after Vite's own.
    expect(svelteDevtools().map(shape)).toEqual([
      { name: 'vite-devtools-svelte', enforce: 'pre', apply: 'serve' },
      { name: 'vite-devtools-svelte:tracking', enforce: 'post', apply: 'serve' },
      { name: 'vite-devtools-svelte:load-profile', enforce: 'post', apply: 'serve' },
      { name: 'vite-devtools-svelte:warning-capture', enforce: 'post', apply: 'serve' },
      { name: 'vite-devtools-svelte-inspector', enforce: 'pre', apply: 'serve' },
    ]);
  });
});

function getMainPlugin(options: Parameters<typeof svelteDevtools>[0] = {}): Plugin {
  const plugins = svelteDevtools(options);
  const plugin = plugins.find(p => p.name === 'vite-devtools-svelte')!;
  resolvePlugins([plugin]);
  return plugin;
}

// `this` of a resolveId call: records what is passed on to `this.resolve`.
function resolveContext() {
  const calls: unknown[][] = [];
  return {
    calls,
    ctx: {
      resolve: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ id: '/app/node_modules/svelte/src/internal/devtools/index.js' });
      },
    },
  };
}

const resolveWith = (plugin: Plugin, id: string, importer?: string, ctx: object = {}) => {
  const hook = plugin.resolveId as (...args: unknown[]) => unknown;
  return hook.call(ctx, id, importer);
};

describe('mainPlugin module resolution', () => {
  it('resolves the hooks alias to the file on disk', async () => {
    expect(await resolveWith(getMainPlugin(), HOOKS_MODULE_ID)).toBe(HOOKS_FILE);
    expect(HOOKS_FILE.endsWith('/src/runtime/hooks.js')).toBe(true);
  });

  it("resolves Svelte imported by the hooks as the app's Svelte (from the project root)", async () => {
    const { calls, ctx } = resolveContext();
    const resolved = await resolveWith(
      getMainPlugin(),
      'svelte/internal/devtools',
      HOOKS_FILE,
      ctx,
    );
    expect(resolved).toEqual({ id: '/app/node_modules/svelte/src/internal/devtools/index.js' });
    expect(calls).toEqual([['svelte/internal/devtools', '/test/index.html', { skipSelf: true }]]);
  });

  it.each([
    ['svelte', '/test/src/App.svelte'],
    ['svelte/internal/client', '/test/src/App.svelte'],
    ['svelte/internal/devtools', '/test/src/App.svelte'],
    ['some-other-module', HOOKS_FILE],
    ['some-other-module', '/test/src/App.svelte'],
  ])('defers %s imported by %s to Vite', async (id, importer) => {
    expect(await resolveWith(getMainPlugin(), id, importer)).toBeNull();
  });
});

// =====================================================================
// Compiler option: experimental.devtools through vite-plugin-svelte
// =====================================================================

// The resolved options vite-plugin-svelte's config plugin exposes on its api.
function withSvelte(
  options: Parameters<typeof svelteDevtools>[0] = {},
  svelteOptions: Record<string, any> = {},
  command = 'serve',
) {
  const api = { options: svelteOptions };
  const plugins = svelteDevtools(options);
  resolvePlugins(plugins, { command, plugins: [{ name: 'vite-plugin-svelte:config', api }] });
  return api.options;
}

describe('experimental.devtools', () => {
  // the suite itself runs under Vitest, where the option is not added
  const vitest = process.env['VITEST'];
  beforeEach(() => {
    delete process.env['VITEST'];
  });
  afterEach(() => {
    process.env['VITEST'] = vitest;
  });

  it("lists the hooks in vite-plugin-svelte's compiler options", () => {
    expect(withSvelte().compilerOptions).toEqual({ experimental: { devtools: [HOOKS_FILE] } });
  });

  it('keeps the other experimental options and devtools plugins, once', () => {
    const svelteOptions = {
      compilerOptions: { dev: true, experimental: { async: true, devtools: ['other/runtime'] } },
    };
    withSvelte({}, svelteOptions);
    // a second plugin instance (restart with an inline config) adds nothing
    withSvelte({}, svelteOptions);
    expect(svelteOptions.compilerOptions).toEqual({
      dev: true,
      experimental: { async: true, devtools: ['other/runtime', HOOKS_FILE] },
    });
  });

  it('lets the dev server serve the hooks file (linked or outside the workspace)', () => {
    const resolved = resolvePlugins(svelteDevtools(), {
      plugins: [{ name: 'vite-plugin-svelte:config', api: { options: {} } }],
    });
    expect(resolved.server.fs.allow).toEqual(['/test', path.dirname(HOOKS_FILE)]);
  });

  it('is not added when building', () => {
    expect(withSvelte({}, {}, 'build').compilerOptions).toBeUndefined();
  });

  it('is not added inside Vitest', () => {
    process.env['VITEST'] = 'true';
    expect(withSvelte().compilerOptions).toBeUndefined();
  });

  it('does nothing without vite-plugin-svelte', () => {
    expect(() => resolvePlugins(svelteDevtools())).not.toThrow();
  });
});

/** Serve with vite-plugin-svelte, recording the warnings. */
function serveWithSvelte(plugins = svelteDevtools()) {
  const api = { options: { compilerOptions: { dev: true } } };
  const warn = vi.fn();
  const resolved = resolvePlugins(plugins, {
    plugins: [{ name: 'vite-plugin-svelte:config', api }],
    logger: { warn },
  });
  const byName = (name: string) => plugins.find(p => p.name === name)!;
  return { api, resolved, warn, byName };
}

// An older Svelte throws on `experimental.devtools` (options_unrecognised) and
// has no `svelte/internal/devtools` for the hooks to import: the app must
// still run, without tracking.
describe('a Svelte without devtools events', () => {
  const vitest = process.env['VITEST'];
  beforeEach(() => {
    delete process.env['VITEST'];
    svelte.version = '5.57.3';
    svelte.devtoolsEvents = false;
  });
  afterEach(() => {
    process.env['VITEST'] = vitest;
    svelte.version = '5.99.0';
    svelte.devtoolsEvents = true;
  });

  it('leaves the compiler options and fs.allow as they are', () => {
    const { api, resolved } = serveWithSvelte();
    expect(api.options.compilerOptions).toEqual({ dev: true });
    expect(resolved.server.fs.allow).toEqual(['/test']);
  });

  it('does not import the hooks into Svelte modules', () => {
    const { byName } = serveWithSvelte();
    expect(
      callHook(
        byName('vite-devtools-svelte:tracking').transform,
        'export const cart = $.proxy({})',
        '/test/src/cart.svelte.ts',
      ),
    ).toBeNull();
  });

  it('says why, with the version', () => {
    const { warn } = serveWithSvelte();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('svelte@5.57.3 has no devtools events');
  });

  it('says so when Svelte is not found', () => {
    svelte.version = undefined;
    const { warn } = serveWithSvelte();
    expect(warn.mock.calls[0]![0]).toContain('Svelte was not found');
  });

  it('is quiet inside Vitest', () => {
    process.env['VITEST'] = 'true';
    expect(serveWithSvelte().warn).not.toHaveBeenCalled();
  });

  it('follows the Svelte of each restart (the plugin instance is reused)', () => {
    const plugins = svelteDevtools();

    svelte.devtoolsEvents = true;
    const tracked = serveWithSvelte(plugins);
    expect(tracked.api.options.compilerOptions).toEqual({
      dev: true,
      experimental: { devtools: [HOOKS_FILE] },
    });

    svelte.devtoolsEvents = false;
    expect(serveWithSvelte(plugins).api.options.compilerOptions).toEqual({ dev: true });

    svelte.devtoolsEvents = true;
    expect(serveWithSvelte(plugins).api.options.compilerOptions).toEqual({
      dev: true,
      experimental: { devtools: [HOOKS_FILE] },
    });
  });
});

// Plugins are `apply: 'serve'`, but a hook can still be reached outside dev
// (a plugin list reused by another tool, `vite build --watch` setups): each
// hook re-checks the command and is inert during a build.
describe('build command: every hook is inert', () => {
  const plugins = svelteDevtools();
  resolvePlugins(plugins, { command: 'build' });
  const byName = (name: string) => plugins.find(p => p.name === name)!;
  const main = byName('vite-devtools-svelte');

  it.each([
    ['resolveId(hooks)', () => resolveWith(main, HOOKS_MODULE_ID)],
    [
      'tracking transform',
      () =>
        callHook(
          byName('vite-devtools-svelte:tracking').transform,
          'export const cart = $.proxy({})',
          '/test/src/cart.svelte.ts',
        ),
    ],
    [
      'load-profile transform',
      () =>
        callHook(
          byName('vite-devtools-svelte:load-profile').transform,
          'export const load = () => ({})',
          '/test/src/routes/+page.ts',
        ),
    ],
  ])('%s → null', async (_, run) => {
    expect(await run()).toBeNull();
  });
});

describe('mainPlugin', () => {
  // SvelteKit warns about any plugin that defines it (transform_index_html_unsupported).
  it('has no transformIndexHtml hook', () => {
    for (const plugin of svelteDevtools()) expect(plugin.transformIndexHtml).toBeUndefined();
  });
});

const kit = vi.hoisted(() => ({
  createPluginFromDevframe: vi.fn((def: any, options: any) => ({
    name: `devframe:${def.id}`,
    devtools: { setup: (ctx: any) => def.setup(ctx), options },
  })),
}));
vi.mock('@vitejs/devtools-kit/node', () => kit);

// Observe devframe instances without running real transports (host.test.ts covers the real stack).
const initiate = vi.hoisted(() => ({
  initDevframe: vi.fn((_def: unknown, _options: unknown) => ({
    nodeMiddleware: vi.fn(),
    close: vi.fn(async () => {}),
  })),
}));
vi.mock('devframe/initiate', () => initiate);

const FIXTURES = new URL('fixtures', import.meta.url).pathname;

/** Run the hub path: devtools.setup → createPluginFromDevframe → def.setup(ctx). */
async function hubHandlers(plugins: Plugin[]) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const main = plugins.find(p => p.name === 'vite-devtools-svelte')!;
  await (main.devtools as any).setup({
    scope: (id: string) => ({
      rpc: { register: (fn: any) => handlers.set(`${id}:${fn.name}`, fn.handler) },
    }),
    docks: { register: vi.fn() },
  });
  return handlers;
}

function resolve(plugins: Plugin[], config: Record<string, unknown> = {}) {
  return resolvePlugins(plugins, { root: FIXTURES, ...config });
}

function mockServer() {
  const middlewares: Array<(...args: any[]) => any> = [];
  // An unlistened http.Server: emits 'close' like the dev server's own.
  const httpServer = Object.assign(http.createServer(), { address: () => null });
  return {
    middlewares,
    httpServer,
    server: {
      hot: { on: vi.fn(), off: vi.fn(), send: vi.fn() },
      middlewares: { use: (...args: any[]) => middlewares.push(args.at(-1)) },
      httpServer,
      watcher: { on: vi.fn() },
      config: { server: {}, logger: { info: () => {}, error: () => {} } },
      environments: {},
    } as any,
  };
}

describe('mainPlugin devtools hook (Vite DevTools)', () => {
  it('is dev-only and declares no build capability', () => {
    const main = svelteDevtools().find(p => p.name === 'vite-devtools-svelte')!;
    expect(main.apply).toBe('serve');
    expect((main.devtools as any).capabilities).toEqual({ dev: true, build: false });
  });

  it('mounts the portable devframe through the kit at /.svelte-devtools/', async () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    const handlers = await hubHandlers(plugins);
    expect(kit.createPluginFromDevframe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'svelte-devtools', basePath: '/.svelte-devtools/' }),
      { base: '/.svelte-devtools/' },
    );
    const expected = [
      'get-project',
      'get-routes',
      'get-live-components',
      'get-module-graph',
      'get-api-endpoints',
    ];
    expect(expected.filter(name => !handlers.has(`svelte-devtools:${name}`))).toEqual([]);
    expect((await handlers.get('svelte-devtools:get-project')!()).name).toBeTruthy();
  });

  it('adds workflow docks beside the Overview devframe', async () => {
    const plugins = svelteDevtools();
    resolve(plugins, { plugins: [kitSetup('/test/src/routes')] });
    const main = plugins.find(p => p.name === 'vite-devtools-svelte')!;
    const register = vi.fn();
    await (main.devtools as any).setup({
      scope: () => ({ rpc: { register: vi.fn() } }),
      docks: { register },
    });
    expect(register.mock.calls.map(([entry]) => entry)).toEqual([
      {
        id: 'svelte-devtools:problems',
        title: 'Problems',
        description: 'Compiler warnings and runtime errors',
        icon: 'ph:warning-duotone',
        type: 'iframe',
        url: '/.svelte-devtools/?view=problems#/errors',
        groupId: 'svelte',
        category: 'default',
        defaultOrder: 10,
      },
      {
        id: 'svelte-devtools:inspect',
        title: 'Inspect',
        description: 'Components, reactivity and state over time',
        icon: 'ph:binoculars-duotone',
        type: 'iframe',
        url: '/.svelte-devtools/?view=inspect#/components',
        groupId: 'svelte',
        category: 'default',
        defaultOrder: 20,
      },
      {
        id: 'svelte-devtools:profile',
        title: 'Profile',
        description: 'Updates, load, frame rate and build performance',
        icon: 'ph:gauge-duotone',
        type: 'iframe',
        url: '/.svelte-devtools/?view=profile#/performance',
        groupId: 'svelte',
        category: 'default',
        defaultOrder: 30,
      },
      {
        id: 'svelte-devtools:project',
        title: 'Project',
        description: 'Routes, API, modules, assets and social previews',
        icon: 'ph:folder-open-duotone',
        type: 'iframe',
        url: '/.svelte-devtools/?view=project#/routes',
        groupId: 'svelte',
        category: 'default',
        defaultOrder: 40,
      },
      {
        id: 'svelte-devtools:add',
        title: 'Add',
        description: 'Install sv add-ons in one click',
        icon: 'ph:plus-circle-duotone',
        type: 'iframe',
        url: '/.svelte-devtools/?view=add#/addons',
        groupId: 'svelte',
        category: 'default',
        defaultOrder: 70,
      },
    ]);
  });
});

describe('mount selection', () => {
  it('mounts standalone when @vitejs/devtools is absent', () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    const m = mockServer();
    callHook(plugins[0]!.configureServer, m.server);
    // [standalone devframe middleware, MCP middleware]
    expect(m.middlewares).toHaveLength(2);
  });

  it('does not mount standalone when the Vite DevTools hub is present (it calls our devtools hook)', () => {
    const plugins = svelteDevtools();
    resolve(plugins, { plugins: [{ name: 'vite:devtools' }] });
    const m = mockServer();
    callHook(plugins[0]!.configureServer, m.server);
    expect(m.middlewares).toHaveLength(1); // MCP only
  });

  it('standalone answers 503 for the DevTools base before the server listens', () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    const m = mockServer();
    callHook(plugins[0]!.configureServer, m.server);
    const res = { statusCode: 200, end: vi.fn() };
    const next = vi.fn();
    m.middlewares[0]!({ url: '/.svelte-devtools/' }, res, next);
    expect(res.statusCode).toBe(503);
    m.middlewares[0]!({ url: '/app' }, { end: vi.fn() }, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('subscribes the collector to the hot channel and unsubscribes on server close', () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    const m = mockServer();
    callHook(plugins[0]!.configureServer, m.server);
    expect(m.server.hot.on).toHaveBeenCalledWith(
      'svelte-devtools:components',
      expect.any(Function),
    );
    m.httpServer.emit('close');
    expect(m.server.hot.off).toHaveBeenCalledWith(
      'svelte-devtools:components',
      expect.any(Function),
    );
  });
});

function middlewareServer() {
  const m = mockServer();
  m.server.httpServer = null;
  return m;
}
const lastInstance = () => initiate.initDevframe.mock.results.at(-1)!.value;

describe('middleware mode disposal (closeServer hook)', () => {
  it('config-file restart: the old plugin instance disposes its mount, the new one survives', async () => {
    const oldInstance = svelteDevtools();
    resolve(oldInstance);
    callHook(oldInstance[0]!.configureServer, middlewareServer().server);
    const a = lastInstance();
    const newInstance = svelteDevtools(); // config re-evaluated on restart
    resolve(newInstance);
    callHook(newInstance[0]!.configureServer, middlewareServer().server);
    const b = lastInstance();

    await callHook(oldInstance[0]!.closeServer, { reason: 'restart' });
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).not.toHaveBeenCalled();
    await callHook(newInstance[0]!.closeServer, { reason: 'close' });
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('inline restart: the reused plugin instance keeps only the newest mount', async () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    callHook(plugins[0]!.configureServer, middlewareServer().server);
    const a = lastInstance();
    callHook(plugins[0]!.configureServer, middlewareServer().server);
    const b = lastInstance();
    await callHook(plugins[0]!.closeServer, { reason: 'restart' });
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).not.toHaveBeenCalled();
    await callHook(plugins[0]!.closeServer, { reason: 'close' });
    expect(b.close).toHaveBeenCalledOnce();
  });

  it.each([
    [{}, true],
    [{ clientAuth: false }, false],
  ])('svelteDevtools(%j) → devframe auth %s', (options, auth) => {
    const plugins = svelteDevtools(options);
    resolve(plugins);
    callHook(plugins[0]!.configureServer, middlewareServer().server);
    expect(initiate.initDevframe.mock.calls.at(-1)![1]).toMatchObject({ auth });
  });

  it('serves devframe through SSE in middleware mode (no WebSocket server to share)', () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    callHook(plugins[0]!.configureServer, middlewareServer().server);
    expect(initiate.initDevframe.mock.calls.at(-1)![1]).toMatchObject({
      ws: false,
      sse: true,
      mcp: false,
    });
  });
});

async function warnings(plugins: Plugin[]) {
  return (await hubHandlers(plugins)).get('svelte-devtools:get-compiler-warnings')!();
}

describe('warningCapturePlugin', () => {
  type Warning = {
    code: string;
    message: string;
    filename?: string;
    start?: { line: number; column: number };
  };
  type OnWarn = (w: Warning, defaultHandler: (w: Warning) => void) => void;

  /** vite-plugin-svelte's config plugin, holding the options its compile reads `onwarn` from. */
  function sveltePlugin(onwarn?: OnWarn) {
    return { name: 'vite-plugin-svelte:config', api: { options: { onwarn } } };
  }

  const WARNING: Warning = {
    code: 'a11y_no_redundant_roles',
    message: 'Redundant role',
    filename: '/test/src/lib/Counter.svelte',
    start: { line: 5, column: 2 },
  };

  it('records the structured warning and still runs the default handler', async () => {
    const plugins = svelteDevtools();
    const vps = sveltePlugin();
    resolve(plugins, { plugins: [vps] });
    const printed: Warning[] = [];
    (vps.api.options.onwarn as OnWarn)(WARNING, w => {
      printed.push(w);
    });
    expect(printed).toEqual([WARNING]);
    expect(await warnings(plugins)).toEqual([
      {
        code: 'a11y_no_redundant_roles',
        message: 'Redundant role',
        file: '/test/src/lib/Counter.svelte',
        line: 5,
        column: 2,
      },
    ]);
  });

  it("defers to the user's onwarn (which may silence the warning)", async () => {
    const plugins = svelteDevtools();
    const user = vi.fn<OnWarn>();
    const vps = sveltePlugin(user);
    resolve(plugins, { plugins: [vps] });
    const defaultHandler = vi.fn<(w: Warning) => void>();
    (vps.api.options.onwarn as OnWarn)(WARNING, defaultHandler);
    expect(user).toHaveBeenCalledWith(WARNING, defaultHandler);
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(await warnings(plugins)).toHaveLength(1);
  });

  it('skips warnings from dependencies', async () => {
    const plugins = svelteDevtools();
    const vps = sveltePlugin();
    resolve(plugins, { plugins: [vps] });
    const onwarn = vps.api.options.onwarn as OnWarn;
    onwarn({ ...WARNING, filename: '/test/node_modules/lib/A.svelte' }, () => {});
    onwarn({ code: 'x', message: 'no file' }, () => {});
    expect(await warnings(plugins)).toEqual([
      { code: 'x', message: 'no file', file: '', line: undefined, column: undefined },
    ]);
  });

  it('is inert without vite-plugin-svelte and outside dev', () => {
    const plugins = svelteDevtools();
    expect(() => resolve(plugins, { plugins: [] })).not.toThrow();
    const vps = sveltePlugin();
    resolve(svelteDevtools(), { command: 'build', plugins: [vps] });
    expect(vps.api.options.onwarn).toBeUndefined();
  });
});

describe('loadProfilePlugin recorder', () => {
  it('records load timings from the transformed load wrapper', async () => {
    const plugins = svelteDevtools();
    resolve(plugins);
    const serverPlugin = plugins.find(p => p.name === 'vite-devtools-svelte:load-profile')!;
    callHook(serverPlugin.configureServer, { hot: { on: () => {} } });
    (globalThis as any).__svelte_devtools_record_load('/', '/r/+page.ts', 'universal', 1.234, 10);
    const loads = await (await hubHandlers(plugins)).get('svelte-devtools:get-load-profiles')!();
    expect(loads[0]).toMatchObject({ route: '/', duration: 1.23, dataSize: 10, type: 'universal' });
    // Outside the root (e.g. a symlinked root): kept absolute, not `../..`.
    expect(loads[0].file).toBe('/r/+page.ts');
  });
});

function appliesToBuild(p: Plugin): boolean {
  return typeof p.apply === 'function'
    ? p.apply({}, { command: 'build', mode: 'production' } as any)
    : p.apply === undefined || p.apply === 'build';
}

describe('production build no-op', () => {
  it('every plugin is serve-only (absent from vite build)', () => {
    expect(
      svelteDevtools()
        .filter(appliesToBuild)
        .map(p => p.name),
    ).toEqual([]);
  });
});
