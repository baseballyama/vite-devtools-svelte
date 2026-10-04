import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineDevframe, defineRpcFunction } from 'devframe'
import type { DevframeDefinition } from 'devframe'
import { z } from 'zod'
import { analyzeRoutes } from './analyzers/routes.js'
import { analyzeAssets } from './analyzers/assets.js'
import { analyzeProject } from './analyzers/project.js'
import { analyzeComponents } from './analyzers/components.js'
import { analyzeApiEndpoints, sendApiRequest } from './analyzers/api.js'
import { analyzeBuild } from './analyzers/build.js'
import { buildModuleGraph } from './analyzers/module-graph.js'
import type { GraphModuleLike } from './analyzers/module-graph.js'
import { getOGPreview } from './analyzers/og.js'
import { findReactiveLine } from './analyzers/source.js'
import { resolveWithinRoot } from './security.js'
import type { Collector } from './collector.js'
import type {
  ApiResponse,
  CaptureInfoMap,
  InspectResult,
  OGPreview,
  ReactiveGraphResult,
  ReactiveSummary,
  StateTimelineDelta,
  LiveComponentsMeta,
} from './types.js'

export const DEVFRAME_ID = 'svelte-devtools'
/** Mount base for both hosts (standalone and Vite DevTools), so the SPA URL never changes. */
export const DEVFRAME_BASE = '/.svelte-devtools/'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as {
  name: string
  version: string
  description: string
  homepage: string
}
const clientAssets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'client')

/**
 * Everything the portable devframe needs from whatever hosts it. The Vite
 * plugin implements this over its dev server; tests implement it directly.
 * Getters are lazy because the host resolves config after construction.
 */
export interface SvelteDevtoolsHost {
  collector: Collector
  /** Absolute project root. */
  root: () => string
  /** Public base the dev server serves the app (and static files) under. */
  publicBase: () => string
  /** Every module the dev server currently knows about, across environments. */
  modules: () => GraphModuleLike[]
  /** Compile a project file through the dev server's pipeline (absent without a server). */
  transformRequest?: (file: string) => Promise<{
    code: string
    map?: { mappings?: string; sources?: string[] } | string | null
  } | null>
  /** Origins the dev server itself is reachable at (API playground / OG preview may call them). */
  serverOrigins: () => string[]
  /** Open `file[:line]` in the user's editor. */
  openInEditor: (target: string) => void
}

const filePath = z.string().min(1).max(4096)

export function createRpcFunctions(host: SvelteDevtoolsHost) {
  const { collector } = host
  const project = () => analyzeProject(host.root())
  const routes = () => analyzeRoutes(project().routesDir)

  return [
    defineRpcFunction({
      name: 'get-project',
      type: 'query',
      jsonSerializable: true,
      handler: () => project(),
    }),
    defineRpcFunction({
      name: 'get-routes',
      type: 'query',
      jsonSerializable: true,
      handler: () => routes(),
    }),
    defineRpcFunction({
      name: 'get-assets',
      type: 'query',
      jsonSerializable: true,
      handler: () => analyzeAssets(project().staticDir, host.publicBase()),
    }),
    defineRpcFunction({
      name: 'get-component-relations',
      type: 'query',
      jsonSerializable: true,
      handler: () => analyzeComponents(host.root()),
    }),
    defineRpcFunction({
      name: 'get-svelte-files',
      type: 'query',
      jsonSerializable: true,
      handler: () => analyzeComponents(host.root()).map(c => ({ file: c.file, name: c.name })),
    }),
    defineRpcFunction({
      name: 'get-live-components',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.liveComponents,
    }),
    defineRpcFunction({
      name: 'get-live-components-meta',
      type: 'query',
      jsonSerializable: true,
      handler: (): LiveComponentsMeta => ({
        total: collector.liveComponentsTotal,
        kept: collector.liveComponents.length,
        truncated: collector.liveComponentsTotal > collector.liveComponents.length,
        ...collector.epochInfo,
      }),
    }),
    defineRpcFunction({
      name: 'set-active',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ client: z.string().min(1).max(64), active: z.boolean() })],
      returns: z.void(),
      handler: ({ client, active }) => {
        if (active) collector.lease(`ui:${client}`)
        else collector.release(`ui:${client}`)
      },
    }),
    defineRpcFunction({
      name: 'open-in-editor',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ file: filePath, line: z.number().int().nonnegative().optional() })],
      returns: z.void(),
      handler: ({ file, line }) => {
        const resolved = resolveWithinRoot(host.root(), file)
        host.openInEditor(line ? `${resolved}:${line}` : resolved)
      },
    }),
    defineRpcFunction({
      name: 'open-reactive-in-editor',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ file: filePath, name: z.string().max(256), type: z.string().max(32) })],
      returns: z.void(),
      handler: ({ file, name, type }) => {
        const resolved = resolveWithinRoot(host.root(), file)
        let line = 0
        try {
          line = findReactiveLine(fs.readFileSync(resolved, 'utf-8'), name, type)
        } catch {
          /* file not readable */
        }
        host.openInEditor(line > 0 ? `${resolved}:${line}` : resolved)
      },
    }),
    defineRpcFunction({
      name: 'get-render-profiles',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.renderProfiles,
    }),
    defineRpcFunction({
      name: 'get-reactive-graph',
      type: 'query',
      jsonSerializable: true,
      // Omitted = whole app (older clients). Scoped requests are built by the
      // runtime within the caps (docs/devframe-migration.md §6.7 A).
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
      // Overview aggregate from runtime counters; never captures the graph (§6.7 I).
      args: [
        z
          .object({
            topK: z.number().int().positive().optional(),
            windowMs: z.number().int().positive().optional(),
          })
          .optional(),
      ],
      returns: z.custom<ReactiveSummary>(),
      handler: req => collector.requestReactiveSummary(req ?? {}),
    }),
    defineRpcFunction({
      name: 'get-capture-info',
      type: 'query',
      jsonSerializable: true,
      handler: (): CaptureInfoMap => collector.getCaptureInfo(),
    }),
    defineRpcFunction({
      name: 'get-load-profiles',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.loadProfiles,
    }),
    defineRpcFunction({
      name: 'clear-load-profiles',
      type: 'action',
      jsonSerializable: true,
      handler: () => collector.clearLoadProfiles(),
    }),
    defineRpcFunction({
      name: 'get-state-timeline',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.requestStateTimeline(),
    }),
    defineRpcFunction({
      name: 'get-state-timeline-delta',
      type: 'query',
      jsonSerializable: true,
      args: [z.object({ since: z.number().int().nonnegative().optional() })],
      returns: z.custom<StateTimelineDelta>(),
      // Served from the buffer the runtime pushes into; never pulls the app.
      handler: ({ since }) => collector.getStateTimelineDelta(since),
    }),
    defineRpcFunction({
      name: 'get-versions',
      type: 'query',
      jsonSerializable: true,
      handler: () => ({ ...collector.versions }),
    }),
    defineRpcFunction({
      name: 'clear-state-timeline',
      type: 'action',
      jsonSerializable: true,
      handler: () => collector.clearStateTimeline(),
    }),
    defineRpcFunction({
      name: 'get-api-endpoints',
      type: 'query',
      jsonSerializable: true,
      handler: () => analyzeApiEndpoints(routes()),
    }),
    defineRpcFunction({
      name: 'send-api-request',
      type: 'action',
      jsonSerializable: true,
      args: [
        z.object({
          url: z.string().max(8192),
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
          headers: z.string().max(65536),
          body: z.string().max(1_000_000),
        }),
      ],
      returns: z.custom<ApiResponse>(),
      handler: input => sendApiRequest(input, { allowedOrigins: host.serverOrigins() }),
    }),
    defineRpcFunction({
      name: 'get-compiler-warnings',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.compilerWarnings,
    }),
    defineRpcFunction({
      name: 'get-runtime-errors',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.runtimeErrors,
    }),
    defineRpcFunction({
      name: 'clear-errors',
      type: 'action',
      jsonSerializable: true,
      handler: () => collector.clearErrors(),
    }),
    defineRpcFunction({
      name: 'inspect-file',
      type: 'query',
      jsonSerializable: true,
      args: [z.object({ file: filePath })],
      returns: z.custom<InspectResult>(),
      handler: async ({ file }): Promise<InspectResult> => {
        const empty: InspectResult = { source: '', compiled: '', file }
        let resolved: string
        let source: string
        try {
          resolved = resolveWithinRoot(host.root(), file)
          source = fs.readFileSync(resolved, 'utf-8')
        } catch {
          return empty
        }
        if (!host.transformRequest) return { ...empty, source }
        try {
          const result = await host.transformRequest(resolved)
          const map = typeof result?.map === 'string' ? JSON.parse(result.map) : result?.map
          return {
            source,
            compiled: result?.code || '',
            file,
            mappings: map?.mappings,
            sources: map?.sources,
          }
        } catch {
          return { source, compiled: '// Transform failed', file }
        }
      },
    }),
    defineRpcFunction({
      name: 'get-module-graph',
      type: 'query',
      jsonSerializable: true,
      handler: () => buildModuleGraph(host.root(), host.modules()),
    }),
    defineRpcFunction({
      name: 'get-og-preview',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ url: z.string().max(8192) })],
      returns: z.custom<OGPreview>(),
      handler: ({ url }) => getOGPreview(url, { allowedOrigins: host.serverOrigins() }),
    }),
    defineRpcFunction({
      name: 'get-build-analysis',
      type: 'query',
      jsonSerializable: true,
      handler: () => analyzeBuild(host.root()),
    }),
    defineRpcFunction({
      name: 'get-fps',
      type: 'query',
      jsonSerializable: true,
      handler: () => collector.fpsSamples,
    }),
    defineRpcFunction({
      name: 'clear-fps',
      type: 'action',
      jsonSerializable: true,
      handler: () => collector.clearFps(),
    }),
  ] as const
}

/**
 * The portable Svelte DevTools tool. Host-agnostic: the same definition is
 * mounted standalone (`initDevframe`) or inside Vite DevTools
 * (`createPluginFromDevframe`); the SPA in `dist/client` connects with
 * `connectDevframe()` either way.
 */
export function createSvelteDevframe(host: SvelteDevtoolsHost): DevframeDefinition {
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
      const scoped = ctx.scope(DEVFRAME_ID)
      for (const fn of createRpcFunctions(host)) scoped.rpc.register(fn)
    },
  })
}
