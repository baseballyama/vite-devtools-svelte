/// <reference types="@vitejs/devtools-kit" />
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { analyzeRoutes } from './analyzers/routes.js'
import { analyzeAssets, MIME_TYPES } from './analyzers/assets.js'
import { analyzeProject } from './analyzers/project.js'
import { analyzeComponents } from './analyzers/components.js'
import { RUNTIME_MODULE_ID, RESOLVED_RUNTIME_ID, runtimeCode, WRAPPER_MODULE_ID, wrapperCode } from './runtime.js'
import type { ComponentInstance, RenderProfile, LoadProfile, ReactiveGraph, StateChange, CompilerWarning, RuntimeError, InspectResult, ApiEndpoint, ApiResponse, ModuleGraphData, ModuleNode, OGPreview, BuildAnalysis, BuildChunk, FpsSample } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Validate that a URL does not target private/internal network addresses (SSRF prevention).
 * Allows only http/https schemes and blocks private IP ranges.
 */
function validateExternalUrl(urlStr: string): void {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname
  // Block IPv6 loopback
  if (hostname === '::1' || hostname === '[::1]') {
    throw new Error('Blocked: loopback address')
  }

  // Resolve hostname to check for private IPs
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked: private IP address ${hostname}`)
    }
  } else {
    // For domain names, block common internal hostnames
    const lower = hostname.toLowerCase()
    if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
      throw new Error(`Blocked: internal hostname ${hostname}`)
    }
  }
}

function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  const parts = ip.split('.').map(Number)
  if (parts.length === 4) {
    // 127.0.0.0/8
    if (parts[0] === 127) return true
    // 10.0.0.0/8
    if (parts[0] === 10) return true
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.0.0.0
    if (parts.every(p => p === 0)) return true
  }
  return false
}

export interface SvelteDevtoolsOptions {
  /**
   * Enable component tracking via code injection.
   * @default true
   */
  componentTracking?: boolean
}

export function svelteDevtools(options: SvelteDevtoolsOptions = {}): Plugin[] {
  const { componentTracking = true } = options

  let config: ResolvedConfig
  let server: ViteDevServer | undefined
  let root: string
  // Per-process random token used by the HTTP fallback endpoint and asset
  // middleware to authenticate requests. Embedded into the DevTools client
  // HTML via a <meta> tag and required as `x-svelte-devtools-token`.
  // Combined with strict same-origin checks, this prevents arbitrary web
  // pages (and DNS-rebinding attacks against the dev server bound to
  // 0.0.0.0) from invoking inspect-file / open-in-editor / send-api-request.
  const devtoolsToken = crypto.randomUUID()

  // Resolve a user-supplied file path strictly under the project root.
  // Symlinks are followed via realpathSync so that symlinks inside the
  // project cannot be used to escape the root sandbox.
  // Throws if the resolved real path is outside the project root.
  function resolveWithinRoot(input: string): string {
    if (typeof input !== 'string' || input.length === 0) {
      throw new Error('Invalid file path')
    }
    const realRoot = fs.realpathSync(root)
    const candidate = path.isAbsolute(input) ? input : path.resolve(root, input)
    let real: string
    try {
      real = fs.realpathSync(candidate)
    } catch {
      throw new Error('File not found')
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new Error('Forbidden: path outside project root')
    }
    return real
  }

  let liveComponents: ComponentInstance[] = []
  let renderProfiles: RenderProfile[] = []
  let loadProfiles: LoadProfile[] = []
  let reactiveGraph: ReactiveGraph = { nodes: [], edges: [] }
  let reactiveGraphResolvers: Array<(graph: ReactiveGraph) => void> = []
  // Phase 3
  let stateTimeline: StateChange[] = []
  let stateTimelineResolvers: Array<(changes: StateChange[]) => void> = []
  let compilerWarnings: CompilerWarning[] = []
  let runtimeErrors: RuntimeError[] = []
  let fpsSamples: FpsSample[] = []

  // --- Shared RPC handler implementations ---
  // Used by both DevTools Kit RPC registration and HTTP fallback endpoint.
  // Lazily initialized once (handlers close over mutable state so a single instance works).
  let _rpcHandlers: Record<string, (...args: any[]) => Promise<unknown>> | null = null
  function getRpcHandlers(): Record<string, (...args: any[]) => Promise<unknown>> {
    if (_rpcHandlers) return _rpcHandlers
    _rpcHandlers = {
      'svelte-devtools:get-project': async () => analyzeProject(root),

      'svelte-devtools:get-routes': async () => {
        const projectInfo = analyzeProject(root)
        return analyzeRoutes(projectInfo.routesDir)
      },

      'svelte-devtools:get-assets': async () => {
        const projectInfo = analyzeProject(root)
        return analyzeAssets(projectInfo.staticDir)
      },

      'svelte-devtools:get-component-relations': async () => analyzeComponents(root),

      'svelte-devtools:get-live-components': async () => liveComponents,

      'svelte-devtools:open-in-editor': async (filePath: string, line?: number) => {
        const resolved = resolveWithinRoot(String(filePath))
        if (line && Number(line) > 0) {
          execFile('code', ['--goto', `${resolved}:${Number(line)}`])
        } else {
          execFile('code', [resolved])
        }
      },

      'svelte-devtools:open-reactive-in-editor': async (filePath: string, name: string, type: string) => {
        const resolved = resolveWithinRoot(String(filePath))
        let line = 0
        try {
          const source = fs.readFileSync(resolved, 'utf-8')
          const lines = source.split('\n')
          if (String(type) === 'effect') {
            // Find the $effect( declaration
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes('$effect(') || lines[i].includes('$effect.pre(')) {
                line = i + 1; break
              }
            }
          } else {
            // Find the variable declaration: let/const/var {name}
            const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(`(?:let|const|var)\\s+${escaped}\\b`)
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                line = i + 1; break
              }
            }
          }
        } catch { /* file not readable */ }
        if (line > 0) {
          execFile('code', ['--goto', `${resolved}:${line}`])
        } else {
          execFile('code', [resolved])
        }
      },

      'svelte-devtools:get-render-profiles': async () => renderProfiles,

      'svelte-devtools:get-reactive-graph': async () => {
        if (!server) return reactiveGraph
        server.hot.send('svelte-devtools:request-reactive-graph', {})
        return new Promise<ReactiveGraph>((resolve) => {
          let resolved = false
          const resolver = (graph: ReactiveGraph) => { if (!resolved) { resolved = true; clearTimeout(timeout); resolve(graph) } }
          const timeout = setTimeout(() => {
            resolved = true
            // Remove this resolver to prevent memory leak
            const idx = reactiveGraphResolvers.indexOf(resolver)
            if (idx !== -1) reactiveGraphResolvers.splice(idx, 1)
            resolve(reactiveGraph)
          }, 1000)
          reactiveGraphResolvers.push(resolver)
        })
      },

      'svelte-devtools:get-load-profiles': async () => loadProfiles,

      'svelte-devtools:clear-load-profiles': async () => { loadProfiles = [] },

      'svelte-devtools:get-state-timeline': async () => {
        if (!server) return stateTimeline
        server.hot.send('svelte-devtools:request-state-timeline', {})
        return new Promise<StateChange[]>((resolve) => {
          let resolved = false
          const resolver = (changes: StateChange[]) => { if (!resolved) { resolved = true; clearTimeout(timeout); resolve(changes) } }
          const timeout = setTimeout(() => {
            resolved = true
            const idx = stateTimelineResolvers.indexOf(resolver)
            if (idx !== -1) stateTimelineResolvers.splice(idx, 1)
            resolve(stateTimeline)
          }, 1000)
          stateTimelineResolvers.push(resolver)
        })
      },

      'svelte-devtools:clear-state-timeline': async () => {
        stateTimeline = []
        server?.hot.send('svelte-devtools:clear-state-timeline', {})
      },

      'svelte-devtools:get-api-endpoints': async () => {
        const projectInfo = analyzeProject(root)
        const routes = analyzeRoutes(projectInfo.routesDir)
        const endpoints: ApiEndpoint[] = []
        for (const route of routes) {
          const serverFile = route.files.find(f => f.type === 'endpoint')
          if (serverFile) {
            let content = ''
            try { content = fs.readFileSync(serverFile.path, 'utf-8') } catch { /* file may not exist */ }
            const methods: string[] = []
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
              if (content.includes(`export const ${m}`) || content.includes(`export async function ${m}`) || content.includes(`export function ${m}`)) {
                methods.push(m)
              }
            }
            if (methods.length === 0) methods.push('GET')
            endpoints.push({ route: route.id, path: route.path, methods, file: serverFile.path })
          }
        }
        return endpoints
      },

      'svelte-devtools:send-api-request': async (requestUrl: string, method: string, headers: string, body: string) => {
        const start = performance.now()
        try {
          validateExternalUrl(String(requestUrl))
          const parsedHeaders = headers ? JSON.parse(String(headers)) : {}
          const fetchOpts: RequestInit = { method: String(method), headers: parsedHeaders }
          if (body && String(method) !== 'GET' && String(method) !== 'HEAD') fetchOpts.body = String(body)
          const res = await fetch(String(requestUrl), fetchOpts)
          const resBody = await res.text()
          const resHeaders: Record<string, string> = {}
          res.headers.forEach((v, k) => { resHeaders[k] = v })
          return { status: res.status, statusText: res.statusText, headers: resHeaders, body: resBody, duration: Math.round((performance.now() - start) * 100) / 100 } as ApiResponse
        } catch (e) {
          return { status: 0, statusText: String(e), headers: {}, body: '', duration: Math.round((performance.now() - start) * 100) / 100 } as ApiResponse
        }
      },

      'svelte-devtools:get-compiler-warnings': async () => compilerWarnings,

      'svelte-devtools:get-runtime-errors': async () => runtimeErrors,

      'svelte-devtools:clear-errors': async () => { compilerWarnings = []; runtimeErrors = [] },

      'svelte-devtools:get-svelte-files': async () => {
        const components = analyzeComponents(root)
        return components.map(c => ({ file: c.file, name: c.name }))
      },

      'svelte-devtools:inspect-file': async (filePath: string) => {
        const fp = String(filePath)
        let resolved: string
        try {
          resolved = resolveWithinRoot(fp)
        } catch {
          return { source: '', compiled: '', file: fp } as InspectResult
        }
        let source = ''
        try { source = fs.readFileSync(resolved, 'utf-8') } catch { return { source: '', compiled: '', file: fp } as InspectResult }
        let compiled = ''
        let mappings: string | undefined
        let sources: string[] | undefined
        if (server) {
          try {
            const result = await server.transformRequest(resolved)
            compiled = result?.code || ''
            if (result?.map) {
              const map = typeof result.map === 'string' ? JSON.parse(result.map) : result.map
              mappings = map.mappings
              sources = map.sources
            }
          } catch { compiled = '// Transform failed' }
        }
        return { source, compiled, file: fp, mappings, sources } as InspectResult
      },

      'svelte-devtools:get-module-graph': async () => getModuleGraph(),

      'svelte-devtools:get-og-preview': async (url: string) => getOGPreview(String(url)),

      'svelte-devtools:get-build-analysis': async () => getBuildAnalysis(),

      'svelte-devtools:get-fps': async () => fpsSamples,

      'svelte-devtools:clear-fps': async () => { fpsSamples = [] },
    }
    return _rpcHandlers
  }

  const mainPlugin: Plugin = {
    name: 'vite-devtools-svelte',
    enforce: 'pre',

    // Vite plugins may expose data through `api` for inter-plugin (and test)
    // consumption. We surface the per-process auth token only — never the
    // RPC handlers themselves — so the test suite can attach the token to
    // mock requests without the production code needing a test-only flag.
    api: {
      getDevtoolsToken: () => devtoolsToken,
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig
      root = config.root
    },

    configureServer(devServer) {
      server = devServer

      // Defensive caps on runtime-supplied data: even though the runtime
      // already trims its own buffers, an out-of-spec or compromised runtime
      // could hand us unbounded payloads and inflate dev-server memory.
      const MAX_LIVE_COMPONENTS = 5000
      const MAX_RENDER_PROFILES = 5000
      const MAX_STATE_TIMELINE = 500
      const MAX_REACTIVE_NODES = 5000
      const MAX_REACTIVE_EDGES = 20000

      server.hot.on('svelte-devtools:components', (data: { components: ComponentInstance[] }) => {
        const arr = Array.isArray(data?.components) ? data.components : []
        liveComponents = arr.length > MAX_LIVE_COMPONENTS ? arr.slice(-MAX_LIVE_COMPONENTS) : arr
      })

      server.hot.on('svelte-devtools:profiles', (data: { profiles: RenderProfile[] }) => {
        const arr = Array.isArray(data?.profiles) ? data.profiles : []
        renderProfiles = arr.length > MAX_RENDER_PROFILES ? arr.slice(-MAX_RENDER_PROFILES) : arr
      })

      server.hot.on('svelte-devtools:state-timeline', (data: { changes: StateChange[] }) => {
        const arr = Array.isArray(data?.changes) ? data.changes : []
        stateTimeline = arr.length > MAX_STATE_TIMELINE ? arr.slice(-MAX_STATE_TIMELINE) : arr
        // Snapshot then reset before resolving so concurrent requests that
        // push during the resolve loop are not silently dropped.
        const pending = stateTimelineResolvers
        stateTimelineResolvers = []
        for (const resolve of pending) resolve(stateTimeline)
      })

      server.hot.on('svelte-devtools:fps', (data: FpsSample) => {
        fpsSamples.push(data)
        if (fpsSamples.length > 1200) fpsSamples = fpsSamples.slice(-1200)
      })

      server.hot.on('svelte-devtools:runtime-error', (data: RuntimeError) => {
        runtimeErrors.push(data)
        if (runtimeErrors.length > 200) runtimeErrors = runtimeErrors.slice(-200)
      })

      server.hot.on('svelte-devtools:reactive-graph', (data: ReactiveGraph) => {
        const nodes = Array.isArray(data?.nodes) ? data.nodes : []
        const edges = Array.isArray(data?.edges) ? data.edges : []
        reactiveGraph = {
          nodes: nodes.length > MAX_REACTIVE_NODES ? nodes.slice(0, MAX_REACTIVE_NODES) : nodes,
          edges: edges.length > MAX_REACTIVE_EDGES ? edges.slice(0, MAX_REACTIVE_EDGES) : edges,
        }
        const pending = reactiveGraphResolvers
        reactiveGraphResolvers = []
        for (const resolve of pending) resolve(reactiveGraph)
      })

      // Build the same-origin allow-list once. The dev server only serves
      // its own origin, so any cross-origin request to our endpoints is
      // rejected. This blocks both casual CSRF from arbitrary tabs and the
      // DNS-rebinding scenario where the dev server is bound to 0.0.0.0.
      const buildAllowedOrigins = (): Set<string> => {
        const set = new Set<string>()
        const serverCfg = server?.config?.server ?? config?.server
        const port = serverCfg?.port ?? 5173
        const proto = serverCfg?.https ? 'https' : 'http'
        for (const host of ['localhost', '127.0.0.1', '[::1]']) {
          set.add(`${proto}://${host}`)
          set.add(`${proto}://${host}:${port}`)
        }
        return set
      }

      const isAuthorizedRequest = (req: { headers: Record<string, string | string[] | undefined> }): boolean => {
        const allowed = buildAllowedOrigins()
        const origin = req.headers.origin
        const referer = req.headers.referer
        const sourceOrigin = (() => {
          if (typeof origin === 'string' && origin) return origin
          if (typeof referer === 'string' && referer) {
            try { return new URL(referer).origin } catch { return null }
          }
          return null
        })()
        // Same-origin browser requests sent by `fetch` from same-origin pages
        // typically include Origin; tests / curl may omit both — we still
        // require the explicit token header to compensate.
        if (sourceOrigin !== null && !allowed.has(sourceOrigin)) return false
        const tokenHeader = req.headers['x-svelte-devtools-token']
        const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader
        return token === devtoolsToken
      }

      // Serve the DevTools client UI. Inject the per-process token into
      // index.html as a <meta> tag so the client can attach it to RPC calls.
      const clientDir = path.resolve(__dirname, 'client')
      server.middlewares.use('/.svelte-devtools', (req, res, next) => {
        const reqUrl = req.url || '/'
        const urlPath = reqUrl.split('?')[0]
        const isIndex = urlPath === '/' || urlPath === '' || urlPath === '/index.html'
        const filePath = isIndex
          ? path.join(clientDir, 'index.html')
          : path.join(clientDir, urlPath)

        try {
          const stat = fs.statSync(filePath)
          if (stat.isFile()) {
            const ext = path.extname(filePath).toLowerCase()
            res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
            if (isIndex) {
              const html = fs.readFileSync(filePath, 'utf-8')
              const tokenMeta = `<meta name="svelte-devtools-token" content="${devtoolsToken}">`
              const injected = html.includes('</head>')
                ? html.replace('</head>', `  ${tokenMeta}\n</head>`)
                : `${tokenMeta}\n${html}`
              res.end(injected)
            } else {
              fs.createReadStream(filePath).pipe(res)
            }
            return
          }
        } catch { /* file doesn't exist, fall through */ }
        next()
      })

      // RPC fallback endpoint for when DevTools Kit RPC is not available.
      // Authorized via same-origin Origin/Referer + per-process token.
      server.middlewares.use('/__svelte-devtools/rpc', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        if (!isAuthorizedRequest(req as any)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        // Reject content types other than JSON to keep CSRF surface small.
        const ct = req.headers['content-type']
        const ctStr = Array.isArray(ct) ? ct[0] : ct
        if (!ctStr || !ctStr.includes('application/json')) {
          res.statusCode = 415
          res.end('Unsupported Media Type')
          return
        }

        let body = ''
        let aborted = false
        const MAX_BODY = 1_000_000 // 1 MB cap to avoid trivial DoS via huge requests
        req.on('data', (chunk: Buffer) => {
          if (aborted) return
          body += chunk.toString()
          if (body.length > MAX_BODY) {
            aborted = true
            res.statusCode = 413
            res.end('Payload Too Large')
          }
        })
        req.on('end', async () => {
          if (aborted) return
          try {
            const { method, args } = JSON.parse(body)
            const handlers = getRpcHandlers()
            const handler = handlers[method]
            if (!handler) throw new Error(`Unknown RPC method: ${method}`)
            const result = await handler(...args)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e) }))
          }
        })
      })

      // Serve asset files for preview. Authorized via same-origin policy.
      server.middlewares.use('/__svelte-devtools/asset', (req, res) => {
        if (!isAuthorizedRequest(req as any)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        const reqUrl = req.url || ''
        const queryStart = reqUrl.indexOf('?')
        const queryString = queryStart >= 0 ? reqUrl.slice(queryStart) : ''
        const params = new URLSearchParams(queryString)
        const filePath = params.get('path')
        if (!filePath) {
          res.statusCode = 400
          res.end('Missing path parameter')
          return
        }

        // Security: only serve files from static dir (resolve symlinks to prevent traversal)
        const projectInfo = analyzeProject(root)
        const realStaticDir = fs.realpathSync(projectInfo.staticDir)
        const resolvedPath = path.resolve(filePath)
        let realPath: string
        try {
          realPath = fs.realpathSync(resolvedPath)
        } catch {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        if (!realPath.startsWith(realStaticDir + path.sep) && realPath !== realStaticDir) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

        try {
          const stat = fs.statSync(realPath)
          if (!stat.isFile()) throw new Error('Not a file')
          const ext = path.extname(realPath).toLowerCase()
          res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
          fs.createReadStream(realPath).pipe(res)
        } catch {
          res.statusCode = 404
          res.end('Not found')
        }
      })
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

    // DevTools integration
    devtools: {
      setup(ctx) {
        const clientDir = path.resolve(__dirname, 'client')
        ctx.views.hostStatic('/.svelte-devtools/', clientDir)

        ctx.docks.register({
          id: 'svelte-devtools',
          title: 'Svelte',
          icon: 'simple-icons:svelte',
          type: 'iframe',
          url: '/.svelte-devtools/',
          category: 'framework',
        })

        // Register all RPC functions from shared handlers
        const handlers = getRpcHandlers()
        for (const [name, handler] of Object.entries(handlers)) {
          ctx.rpc.register({ name, handler })
        }
      },
    },
  }

  // --- Phase 4 helper functions ---

  function getModuleGraph(): ModuleGraphData {
    if (!server) return { modules: [], cycles: [] }
    const modules: ModuleNode[] = []
    const idMap = new Map<string, ModuleNode>()
    const moduleById = new Map<string, ModuleNode>()

    // Try different Vite moduleGraph APIs (v8 uses environments)
    const allModules: Array<{ file?: string | null; importedModules: Set<any> }> = []
    try {
      // Vite 8: use environments
      for (const env of Object.values(server.environments || {})) {
        if (env && 'moduleGraph' in env) {
          const mg = (env as any).moduleGraph
          if (mg?.idToModuleMap) {
            for (const mod of mg.idToModuleMap.values()) allModules.push(mod)
          }
        }
      }
    } catch { /* ignore */ }

    // Fallback: try legacy moduleGraph
    if (allModules.length === 0) {
      try {
        const mg = (server as any).moduleGraph
        if (mg?.idToModuleMap) {
          for (const mod of mg.idToModuleMap.values()) allModules.push(mod)
        }
      } catch { /* ignore */ }
    }

    for (const mod of allModules) {
      if (!mod.file || mod.file.includes('node_modules')) continue
      const relFile = path.relative(root, mod.file)
      if (relFile.startsWith('..')) continue
      if (idMap.has(mod.file)) continue // deduplicate
      const ext = path.extname(mod.file).toLowerCase()
      const type = ext === '.svelte' ? 'svelte' : ext === '.ts' || ext === '.js' ? (ext === '.ts' ? 'ts' : 'js') : ext === '.css' ? 'css' : 'other'
      let size: number | undefined
      try { size = fs.statSync(mod.file).size } catch { /* ignore */ }
      const node: ModuleNode = { id: relFile, file: mod.file, type: type as ModuleNode['type'], importedBy: [], imports: [], size }
      idMap.set(mod.file, node)
      moduleById.set(relFile, node)
      modules.push(node)
    }

    // Build edges using Sets for O(1) dedup
    for (const mod of allModules) {
      if (!mod.file || !idMap.has(mod.file)) continue
      const node = idMap.get(mod.file)!
      const importsSet = new Set(node.imports)
      for (const imp of mod.importedModules) {
        if (imp.file && idMap.has(imp.file)) {
          const impNode = idMap.get(imp.file)!
          const relImp = impNode.id
          if (!importsSet.has(relImp)) {
            importsSet.add(relImp)
            node.imports.push(relImp)
          }
          if (!impNode.importedBy.includes(node.id)) {
            impNode.importedBy.push(node.id)
          }
        }
      }
    }

    // Detect cycles (DFS) using Map for O(1) node lookup, push/pop to avoid array copies
    const cycles: string[][] = []
    const visited = new Set<string>()
    const stack = new Set<string>()
    const pathBuf: string[] = []
    function dfs(id: string) {
      if (stack.has(id)) {
        const cycleStart = pathBuf.indexOf(id)
        if (cycleStart >= 0 && pathBuf.length - cycleStart > 0) {
          const cycle = pathBuf.slice(cycleStart).concat(id)
          if (cycle.length > 2) cycles.push(cycle) // skip self-references
        }
        return
      }
      if (visited.has(id)) return
      visited.add(id); stack.add(id)
      pathBuf.push(id)
      const node = moduleById.get(id)
      if (node) for (const imp of node.imports) dfs(imp)
      pathBuf.pop()
      stack.delete(id)
    }
    for (const m of modules) dfs(m.id)

    // Mark cyclic modules
    const cyclicIds = new Set(cycles.flat())
    for (const m of modules) if (cyclicIds.has(m.id)) m.isCyclic = true

    return { modules, cycles }
  }

  async function getOGPreview(url: string): Promise<OGPreview> {
    const preview: OGPreview = { url, title: '', description: '', image: '', tags: [], issues: [] }
    try {
      validateExternalUrl(url)
      const res = await fetch(url)
      const html = await res.text()
      // Parse meta tags (attribute-order independent; matches both <meta ...> and <meta ... />)
      const metaRegex = /<meta\s+([^>]*?)\/?>/gi
      const propRegex = /(?:property|name)=["']([^"']+)["']/
      const contentRegex = /content=["']([^"']+)["']/
      let match
      while ((match = metaRegex.exec(html)) !== null) {
        const attrs = match[1]
        const propMatch = attrs.match(propRegex)
        const contentMatch = attrs.match(contentRegex)
        if (propMatch && contentMatch) {
          const prop = propMatch[1]
          const content = contentMatch[1]
          preview.tags.push({ property: prop, content })
          if (prop === 'og:title') preview.title = content
          else if (prop === 'og:description') preview.description = content
          else if (prop === 'og:image') preview.image = content
        }
      }
      // Fallback title
      if (!preview.title) {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
        if (titleMatch) preview.title = titleMatch[1]
      }
      // Fallback description
      if (!preview.description) {
        const descTag = preview.tags.find(t => t.property === 'description')
        if (descTag) preview.description = descTag.content
      }
      // Issues
      if (!preview.title) preview.issues.push('Missing og:title or <title>')
      if (!preview.description) preview.issues.push('Missing og:description or meta description')
      if (!preview.image) preview.issues.push('Missing og:image')
      if (!preview.tags.some(t => t.property === 'og:url')) preview.issues.push('Missing og:url')
      if (!preview.tags.some(t => t.property === 'og:type')) preview.issues.push('Missing og:type')
    } catch (e) {
      preview.issues.push(`Failed to fetch: ${String(e)}`)
    }
    return preview
  }

  function getBuildAnalysis(): BuildAnalysis {
    const buildDir = path.resolve(root, '.svelte-kit/output')
    const clientDir = path.resolve(root, 'build/client') // common SvelteKit build output
    const chunks: BuildChunk[] = []

    // Try to find built assets
    for (const dir of [buildDir, clientDir, path.resolve(root, 'build')]) {
      try {
        const walkDir = (d: string) => {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name)
            if (entry.isDirectory()) { walkDir(full); continue }
            const ext = path.extname(entry.name).toLowerCase()
            if (['.js', '.css', '.html'].includes(ext)) {
              const stat = fs.statSync(full)
              chunks.push({
                name: entry.name,
                file: path.relative(root, full),
                size: stat.size,
                modules: [],
                isEntry: entry.name.includes('index') || entry.name.includes('start'),
              })
            }
          }
        }
        walkDir(dir)
      } catch { /* directory doesn't exist or not readable */ }
    }

    chunks.sort((a, b) => b.size - a.size)
    return { chunks, totalSize: chunks.reduce((s, c) => s + c.size, 0), timestamp: Date.now() }
  }

  // Minimal component tracking transform plugin.
  // Only injects the file path before $.push() so the runtime wrapper knows
  // which component file is being initialized. All reactive tracking (state,
  // derived, proxy, effect) is handled by the svelte/internal/client wrapper.
  const trackingPlugin: Plugin = {
    name: 'vite-devtools-svelte:tracking',
    enforce: 'post',

    transform(code, id) {
      if (!componentTracking) return null
      if (!id.endsWith('.svelte')) return null
      if (id.includes('node_modules')) return null
      if (config?.command !== 'serve') return null
      if (!code.includes('$.push(')) return null

      const safeId = JSON.stringify(id)

      const importLine = `import '${RUNTIME_MODULE_ID}';\n`

      const modified = importLine + code.replace(
        /(\$\.push\([^)]+\);?)/,
        `if (typeof window !== 'undefined' && window.__SVELTE_DEVTOOLS__) { window.__SVELTE_DEVTOOLS__._pendingFile = ${safeId}; }\n$1`
      )

      return { code: modified, map: null }
    },
  }

  // Load function profiling transform plugin
  const loadProfilePlugin: Plugin = {
    name: 'vite-devtools-svelte:load-profile',
    enforce: 'post',

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
      let transformed = code.replace(
        /export\s+const\s+load\s*=\s*/,
        `const __original_load = `
      )

      if (transformed === code) {
        // Try `export function load` / `export async function load` pattern
        transformed = code.replace(
          /export\s+(async\s+)?function\s+load\s*\(/,
          `const __original_load = $1function __load_impl(`
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

    configureServer() {
      // Make the recording function available globally on the server
      ;(globalThis as Record<string, unknown>).__svelte_devtools_record_load = (
        route: string, file: string, type: string, duration: number, dataSize: number
      ) => {
        loadProfiles.push({
          route,
          file,
          type: type as 'server' | 'universal',
          duration: Math.round(duration * 100) / 100,
          dataSize,
          timestamp: Date.now(),
        })
        // Keep only last 200 entries
        if (loadProfiles.length > 200) {
          loadProfiles = loadProfiles.slice(-200)
        }
      }
    },
  }

  // Compiler warning capture plugin
  const warningCapturePlugin: Plugin = {
    name: 'vite-devtools-svelte:warning-capture',
    enforce: 'post',

    configResolved(resolvedConfig) {
      // Intercept Svelte compiler warnings from the logger
      const originalWarn = resolvedConfig.logger.warn
      resolvedConfig.logger.warn = (msg: string, options?: { timestamp?: boolean }) => {
        // Svelte compiler warnings usually contain file paths and codes
        if (msg.includes('.svelte') && config?.command === 'serve') {
          const fileMatch = msg.match(/(?:^|\s)((?:\/|\.\/|\w:)[^\s:]+\.svelte)(?::(\d+):(\d+))?/)
          const codeMatch = msg.match(/\(([a-z0-9_-]+)\)/)
          compilerWarnings.push({
            code: codeMatch?.[1] || 'unknown',
            message: msg.replace(/\x1b\[[0-9;]*m/g, '').trim(), // strip ANSI
            file: fileMatch?.[1] || '',
            line: fileMatch?.[2] ? parseInt(fileMatch[2]) : undefined,
            column: fileMatch?.[3] ? parseInt(fileMatch[3]) : undefined,
          })
          if (compilerWarnings.length > 500) compilerWarnings = compilerWarnings.slice(-500)
        }
        originalWarn(msg, options)
      }
    },
  }

  return [mainPlugin, trackingPlugin, loadProfilePlugin, loadProfileServerPlugin, warningCapturePlugin]
}
