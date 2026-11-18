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
import { analyzeRoutes } from '../analyzers/routes.js';
import { findReactiveLine } from '../analyzers/source.js';
import type {
  CaptureInfoMap,
  ElementPick,
  OGPreview,
  ReactiveGraphResult,
  ReactiveSummary,
  StateTimelineDelta,
  LiveComponentsMeta,
} from '../types.js';
import type { Collector } from './collector.js';
import { resolveWithinRoot } from './security.js';

export const DEVFRAME_ID = 'svelte-devtools';
/** Same base for both hosts (standalone and Vite DevTools), so the SPA URL never changes. */
export const DEVFRAME_BASE = '/.svelte-devtools/';
export const PICK_BROADCAST = 'element-picked';

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

// Getters are lazy because the host resolves config after construction.
export interface SvelteDevtoolsHost {
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

function plain<N extends string, R>(type: 'query' | 'action', name: N, handler: () => R) {
  return defineRpcFunction({ name, type, jsonSerializable: true, handler });
}
const query = <N extends string, R>(name: N, handler: () => R) => plain('query', name, handler);
const action = <N extends string, R>(name: N, handler: () => R) => plain('action', name, handler);

export function createRpcFunctions(host: SvelteDevtoolsHost) {
  const { collector } = host;
  const project = () => analyzeProject(host.root(), host.routesDir() !== undefined);
  const routes = () => analyzeRoutes(host.routesDir());
  // Spelled like the Vite module ids the runtime reports as live `file`s:
  // Vite resolves them with the native realpath (real casing, symlinks
  // resolved) and `/` separators.
  let idRootCache: { root: string; id: string } | undefined;
  const idRoot = () => {
    const root = host.root();
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
    query('get-assets', () => analyzeAssets(project().staticDir, host.publicBase())),
    query('get-component-relations', () => analyzeComponents(host.root())),
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
        const resolved = resolveWithinRoot(host.root(), file);
        host.openInEditor(line ? `${resolved}:${line}` : resolved);
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
        const resolved = resolveWithinRoot(host.root(), file);
        let line = 0;
        try {
          line = findReactiveLine(fs.readFileSync(resolved, 'utf-8'), name, type);
        } catch {
          /* file not readable */
        }
        host.openInEditor(line > 0 ? `${resolved}:${line}` : resolved);
      },
    }),
    query('get-render-profiles', () => collector.renderProfiles),
    defineRpcFunction({
      name: 'get-reactive-graph',
      type: 'query',
      jsonSerializable: true,
      // Omitted by older clients: whole app.
      args: [
        z
          .object({
            componentId: z.number().int().nonnegative().optional(),
            epoch: z.string().max(200).optional(),
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
      // Aggregated from runtime counters; never captures the graph.
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
      analyzeApiEndpoints(routes(), host.publicBase(), host.resolveFile),
    ),
    query('get-compiler-warnings', () => collector.compilerWarnings),
    query('get-runtime-errors', () => collector.runtimeErrors),
    action('clear-errors', () => collector.clearErrors()),
    query('get-module-graph', () => buildModuleGraph(host.root(), host.modules())),
    defineRpcFunction({
      name: 'get-og-preview',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ url: z.string().max(8192) })],
      returns: z.custom<OGPreview>(),
      handler: ({ url }) => getOGPreview(url, { allowedOrigins: host.serverOrigins() }),
    }),
    query('get-build-analysis', () => analyzeBuild(host.root())),
    query('get-fps', () => collector.fpsSamples),
    action('clear-fps', () => collector.clearFps()),
  ] as const;
}

export function createSvelteDevframe(host: SvelteDevtoolsHost): DevframeDefinition {
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
    dock: { category: 'framework' },
    clientAssets,
    setup(ctx) {
      const scoped = ctx.scope(DEVFRAME_ID);
      for (const fn of createRpcFunctions(host)) scoped.rpc.register(fn);
      const docks = (ctx as { docks?: { activate?: (dockId: string) => void } }).docks;
      detachPicker?.();
      detachPicker = host.collector.onElementPicked(pick => {
        // To every DevTools UI, hidden tabs included (they apply it once visible).
        void scoped.rpc
          .broadcast({ method: PICK_BROADCAST, args: [pick], event: true, optional: true })
          .catch(() => {});
        docks?.activate?.(DEVFRAME_ID);
      });
    },
  });
}
