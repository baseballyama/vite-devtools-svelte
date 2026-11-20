import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { defineDevframe, defineRpcFunction } from 'devframe';
import type { DevframeDefinition } from 'devframe';
import { z } from 'zod';

import { analyzeApiEndpoints } from '../analyzers/api.js';
import type { ResolveFile } from '../analyzers/api.js';
import { analyzeAssets } from '../analyzers/assets.js';
import { analyzeBuild } from '../analyzers/build.js';
import { analyzeComponents } from '../analyzers/components.js';
import { buildModuleGraph } from '../analyzers/module-graph.js';
import type { GraphModuleLike } from '../analyzers/module-graph.js';
import { getOGPreview } from '../analyzers/og.js';
import { analyzeProject } from '../analyzers/project.js';
import { findReactiveLine } from '../analyzers/reactive-line.js';
import { analyzeRoutes } from '../analyzers/routes.js';
import { MAX_EPOCH_LENGTH } from '../limits.js';
import { resolveWithinRoot } from '../security.js';
import type {
  CaptureInfoMap,
  ElementPick,
  OGPreview,
  ReactiveGraphResult,
  ReactiveSummary,
  StateTimelineDelta,
  LiveComponentsMeta,
} from '../types.js';
import { createAddonRpcFunctions } from './addons.js';
import type { AddonHub } from './addons.js';
import type { Collector } from './collector.js';

export const DEVFRAME_ID = 'svelte-devtools';
// Must match the group the bundled inspector registers (packages/inspector/src/plugin.ts).
export const SVELTE_DOCK_GROUP = 'svelte';
/** Same base for both hosts (standalone and Vite DevTools), so the SPA URL never changes. */
export const DEVFRAME_BASE = '/.svelte-devtools/';
export const PICK_BROADCAST = 'element-picked';

export const VIEW_DOCKS = [
  {
    id: 'problems',
    title: 'Problems',
    description: 'Compiler warnings and runtime errors',
    icon: 'ph:warning-duotone',
    panel: 'errors',
    defaultOrder: 10,
  },
  {
    id: 'inspect',
    title: 'Inspect',
    description: 'Components, reactivity and state over time',
    icon: 'ph:binoculars-duotone',
    panel: 'components',
    defaultOrder: 20,
  },
  {
    id: 'profile',
    title: 'Profile',
    description: 'Render, load, frame rate and build performance',
    icon: 'ph:gauge-duotone',
    panel: 'render',
    defaultOrder: 30,
  },
  {
    id: 'project',
    title: 'Project',
    description: 'Routes, API, modules, assets and social previews',
    icon: 'ph:folder-open-duotone',
    panel: 'routes',
    defaultOrder: 40,
  },
  {
    id: 'add',
    title: 'Add',
    description: 'Install sv add-ons in one click',
    icon: 'ph:plus-circle-duotone',
    panel: 'addons',
    // Last, after the inspector's Settings (50) and Pick element (60).
    defaultOrder: 70,
  },
] as const;
type ViewDockId = (typeof VIEW_DOCKS)[number]['id'];
export const viewDockId = (id: ViewDockId): string => `${DEVFRAME_ID}:${id}`;

// Self-reference by name: resolves to this package's root both from the
// bundle (dist/index.mjs) and from the sources (tests run src/ directly).
const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve('@sveltejs/vite-devtools-svelte/package.json');
const pkg = require(pkgJsonPath) as {
  name: string;
  version: string;
  description: string;
  homepage: string;
};
const clientAssets = path.join(path.dirname(pkgJsonPath), 'dist/client');

// Getters are lazy: the plugin resolves config after construction.
export interface DevframeDeps {
  collector: Collector;
  root: () => string;
  routesDir: () => string | undefined;
  publicBase: () => string;
  modules: () => GraphModuleLike[];
  resolveFile?: ResolveFile;
  /** The OG preview may call these. */
  serverOrigins: () => string[];
  openInEditor: (target: string) => void;
}

const filePath = z.string().min(1).max(4096);

const query = <N extends string, R>(name: N, handler: () => R) =>
  defineRpcFunction({ name, type: 'query', jsonSerializable: true, handler });
const action = <N extends string, R>(name: N, handler: () => R) =>
  defineRpcFunction({ name, type: 'action', jsonSerializable: true, handler });

export function createRpcFunctions(deps: DevframeDeps) {
  const { collector } = deps;
  const project = () => analyzeProject(deps.root(), deps.routesDir() !== undefined);
  const routes = () => analyzeRoutes(deps.routesDir());
  // Spelled like the Vite module ids the runtime reports as live `file`s:
  // Vite resolves them with the native realpath (real casing, symlinks
  // resolved) and `/` separators.
  let idRootCache: { root: string; id: string } | undefined;
  const idRoot = () => {
    const root = deps.root();
    if (idRootCache?.root !== root) {
      let real = root;
      try {
        real = fs.realpathSync.native(root);
      } catch {
        // A root that cannot be resolved is still the best prefix we have.
      }
      idRootCache = { root, id: real.split(path.sep).join('/') };
    }
    return idRootCache.id;
  };

  return [
    query('get-project', project),
    query('get-routes', routes),
    query('get-assets', () => analyzeAssets(project().staticDir, deps.publicBase())),
    query('get-component-relations', () => analyzeComponents(deps.root())),
    query('get-live-components', () => collector.liveComponents),
    query('get-live-components-meta', (): LiveComponentsMeta => ({
      total: collector.liveComponentsTotal,
      kept: collector.liveComponents.length,
      truncated: collector.liveComponentsTotal > collector.liveComponents.length,
      root: idRoot(),
      ...collector.epochInfo,
    })),
    defineRpcFunction({
      name: 'set-active',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ client: z.string().min(1).max(64), active: z.boolean() })],
      returns: z.void(),
      handler: ({ client, active }) => {
        if (active) collector.lease(`ui:${client}`);
        else collector.release(`ui:${client}`);
      },
    }),
    defineRpcFunction({
      name: 'open-in-editor',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ file: filePath, line: z.number().int().nonnegative().optional() })],
      returns: z.void(),
      handler: ({ file, line }) => {
        const resolved = resolveWithinRoot(deps.root(), file);
        deps.openInEditor(line ? `${resolved}:${line}` : resolved);
      },
    }),
    // A pick made just before a UI connected (the dock opening the Svelte panel for it).
    query('get-recent-element-pick', (): ElementPick | null => collector.recentPick),
    defineRpcFunction({
      name: 'open-reactive-in-editor',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ file: filePath, name: z.string().max(256), type: z.string().max(32) })],
      returns: z.void(),
      handler: ({ file, name, type }) => {
        const resolved = resolveWithinRoot(deps.root(), file);
        let line = 0;
        try {
          line = findReactiveLine(fs.readFileSync(resolved, 'utf-8'), name, type);
        } catch {
          // Unreadable: open the file without a line.
        }
        deps.openInEditor(line > 0 ? `${resolved}:${line}` : resolved);
      },
    }),
    query('get-render-profiles', () => collector.renderProfiles),
    defineRpcFunction({
      name: 'get-reactive-graph',
      type: 'query',
      jsonSerializable: true,
      args: [
        z
          .object({
            componentId: z.number().int().nonnegative().optional(),
            epoch: z.string().max(MAX_EPOCH_LENGTH).optional(),
            maxNodes: z.number().int().positive().optional(),
            maxEdges: z.number().int().positive().optional(),
          })
          .optional(),
      ],
      returns: z.custom<ReactiveGraphResult>(),
      handler: req => collector.requestReactiveGraph(req ?? {}),
    }),
    defineRpcFunction({
      name: 'get-reactive-summary',
      type: 'query',
      jsonSerializable: true,
      args: [
        z
          .object({
            topK: z.number().int().positive().optional(),
          })
          .optional(),
      ],
      returns: z.custom<ReactiveSummary>(),
      handler: req => collector.requestReactiveSummary(req ?? {}),
    }),
    query('get-capture-info', (): CaptureInfoMap => collector.getCaptureInfo()),
    query('get-load-profiles', () => collector.loadProfiles),
    action('clear-load-profiles', () => collector.clearLoadProfiles()),
    query('get-state-timeline', () => collector.requestStateTimeline()),
    defineRpcFunction({
      name: 'get-state-timeline-delta',
      type: 'query',
      jsonSerializable: true,
      args: [z.object({ since: z.number().int().nonnegative().optional() })],
      returns: z.custom<StateTimelineDelta>(),
      // Served from the buffer the runtime pushes into; never pulls the app.
      handler: ({ since }) => collector.getStateTimelineDelta(since),
    }),
    query('get-versions', () => ({ ...collector.versions })),
    action('clear-state-timeline', () => collector.clearStateTimeline()),
    query('get-api-endpoints', () =>
      analyzeApiEndpoints(routes(), deps.publicBase(), deps.resolveFile),
    ),
    query('get-compiler-warnings', () => collector.compilerWarnings),
    query('get-runtime-errors', () => collector.runtimeErrors),
    action('clear-errors', () => collector.clearErrors()),
    query('get-module-graph', () => buildModuleGraph(deps.root(), deps.modules())),
    defineRpcFunction({
      name: 'get-og-preview',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ url: z.string().max(8192) })],
      returns: z.custom<OGPreview>(),
      handler: ({ url }) => getOGPreview(url, { allowedOrigins: deps.serverOrigins() }),
    }),
    query('get-build-analysis', () => analyzeBuild(deps.root())),
    query('get-fps', () => collector.fpsSamples),
    action('clear-fps', () => collector.clearFps()),
  ] as const;
}

export function createSvelteDevframe(deps: DevframeDeps): DevframeDefinition {
  // A host may run setup again (dev-server restart): one picker subscription at a time.
  let detachPicker: (() => void) | undefined;
  return defineDevframe({
    id: DEVFRAME_ID,
    name: 'Svelte',
    version: pkg.version,
    packageName: pkg.name,
    importMetaUrl: import.meta.url,
    homepage: pkg.homepage,
    description: pkg.description,
    icon: 'simple-icons:svelte',
    basePath: DEVFRAME_BASE,
    // Live data from an instrumented dev server only; a static export would be an empty shell.
    capabilities: { dev: true, build: false },
    dock: {
      title: 'Overview',
      category: 'default',
      defaultOrder: 0,
      groupId: SVELTE_DOCK_GROUP,
      icon: 'ph:squares-four-duotone',
    },
    clientAssets,
    setup(ctx) {
      const scoped = ctx.scope(DEVFRAME_ID);
      for (const fn of createRpcFunctions(deps)) scoped.rpc.register(fn);
      for (const fn of createAddonRpcFunctions(deps.root, () => ctx as AddonHub)) {
        scoped.rpc.register(fn);
      }
      const docks = (ctx as { docks?: { activate?: (dockId: string) => void } }).docks;
      detachPicker?.();
      detachPicker = deps.collector.onElementPicked(pick => {
        // To every DevTools UI, hidden tabs included (they apply it once visible).
        void scoped.rpc
          .broadcast({ method: PICK_BROADCAST, args: [pick], event: true, optional: true })
          .catch(() => {});
        docks?.activate?.(viewDockId('inspect'));
      });
    },
  });
}
