import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { defineDevframe, defineRpcFunction } from 'devframe'
import type { DevframeDefinition } from 'devframe'
import { z } from 'zod'

import { analyzeApiEndpoints, sendApiRequest } from '../analyzers/api.js'
import { analyzeAssets } from '../analyzers/assets.js'
import { analyzeBuild } from '../analyzers/build.js'
import { analyzeComponents } from '../analyzers/components.js'
import { buildModuleGraph } from '../analyzers/module-graph.js'
import type { GraphModuleLike } from '../analyzers/module-graph.js'
import { getOGPreview } from '../analyzers/og.js'
import { analyzeProject } from '../analyzers/project.js'
import { analyzeRoutes } from '../analyzers/routes.js'
import { findReactiveLine } from '../analyzers/source.js'
import type {
  ApiResponse,
  CaptureInfoMap,
  InspectResult,
  OGPreview,
  ReactiveGraphResult,
  ReactiveSummary,
  StateTimelineDelta,
  LiveComponentsMeta,
} from '../types.js'
import type { Collector } from './collector.js'
import { resolveWithinRoot } from './security.js'

export const DEVFRAME_ID = 'svelte-devtools'
/** Mount base for both hosts (standalone and Vite DevTools), so the SPA URL never changes. */
export const DEVFRAME_BASE = '/.svelte-devtools/'

// Self-reference by name: resolves to this package's root both from the
// bundle (dist/index.mjs) and from the sources (tests run src/ directly).
const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve('vite-devtools-svelte/package.json')
const pkg = require(pkgJsonPath) as {
  name: string
  version: string
  description: string
  homepage: string
}
const clientAssets = path.join(path.dirname(pkgJsonPath), 'dist/client')

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

/** A JSON-serializable RPC function without arguments. */
function plain<N extends string, R>(type: 'query' | 'action', name: N, handler: () => R) {
  return defineRpcFunction({ name, type, jsonSerializable: true, handler })
}
const query = <N extends string, R>(name: N, handler: () => R) => plain('query', name, handler)
const action = <N extends string, R>(name: N, handler: () => R) => plain('action', name, handler)

export function createRpcFunctions(host: SvelteDevtoolsHost) {
  const { collector } = host
  const project = () => analyzeProject(host.root())
  const routes = () => analyzeRoutes(project().routesDir)

  return [
    query('get-project', project),
    query('get-routes', routes),
    query('get-assets', () => analyzeAssets(project().staticDir, host.publicBase())),
    query('get-component-relations', () => analyzeComponents(host.root())),
    query('get-svelte-files', () =>
      analyzeComponents(host.root()).map(c => ({ file: c.file, name: c.name })),
    ),
    query('get-live-components', () => collector.liveComponents),
    query('get-live-components-meta', (): LiveComponentsMeta => ({
      total: collector.liveComponentsTotal,
      kept: collector.liveComponents.length,
      truncated: collector.liveComponentsTotal > collector.liveComponents.length,
      ...collector.epochInfo,
    })),
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
    query('get-render-profiles', () => collector.renderProfiles),
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
    query('get-api-endpoints', () => analyzeApiEndpoints(routes())),
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
    query('get-compiler-warnings', () => collector.compilerWarnings),
    query('get-runtime-errors', () => collector.runtimeErrors),
    action('clear-errors', () => collector.clearErrors()),
    defineRpcFunction({
      name: 'inspect-file',
      type: 'query',
      jsonSerializable: true,
      args: [z.object({ file: filePath })],
      returns: z.custom<InspectResult>(),
      handler: ({ file }) => inspectFile(host, file),
    }),
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
  ] as const
}

/** A project file's source and its compiled output (with source map) from the dev server. */
async function inspectFile(host: SvelteDevtoolsHost, file: string): Promise<InspectResult> {
  let resolved: string
  let source: string
  try {
    resolved = resolveWithinRoot(host.root(), file)
    source = fs.readFileSync(resolved, 'utf-8')
  } catch {
    return { source: '', compiled: '', file }
  }
  if (!host.transformRequest) return { source, compiled: '', file }
  try {
    const result = await host.transformRequest(resolved)
    const map = parseSourceMap(result?.map)
    return {
      source,
      compiled: result?.code ?? '',
      file,
      mappings: map?.mappings,
      sources: map?.sources,
    }
  } catch {
    return { source, compiled: '// Transform failed', file }
  }
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

/** The `mappings` / `sources` of a transform's source map (object or JSON string). */
function parseSourceMap(
  map: { mappings?: string; sources?: string[] } | string | null | undefined,
): { mappings?: string; sources?: string[] } | undefined {
  if (typeof map !== 'string') return map ?? undefined
  const parsed: unknown = JSON.parse(map)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { mappings, sources } = parsed as { mappings?: unknown; sources?: unknown }
  return {
    mappings: typeof mappings === 'string' ? mappings : undefined,
    sources:
      Array.isArray(sources) && sources.every(s => typeof s === 'string') ? sources : undefined,
  }
}
