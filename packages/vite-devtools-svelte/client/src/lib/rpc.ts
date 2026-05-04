import type { RouteInfo, AssetInfo, ProjectInfo, ComponentRelation, ComponentInstance, RenderProfile, LoadProfile, ReactiveGraph, StateChange, ApiEndpoint, ApiResponse, CompilerWarning, RuntimeError, InspectResult, ModuleGraphData, OGPreview, BuildAnalysis, FpsSample } from './types.js'

interface RpcClient {
  call(method: string, ...args: unknown[]): Promise<unknown>
}

let rpcClient: RpcClient | null = null
// Cache the in-flight client-resolution Promise so concurrent callers
// (e.g. Promise.all of several RPC calls during initial mount) do not each
// trigger a fresh DevTools Kit dynamic import. Without this, two callers can
// both observe `rpcClient === null` and race the kit import twice.
let clientPromise: Promise<RpcClient> | null = null

function readDevtoolsToken(): string | null {
  const meta = document.querySelector('meta[name="svelte-devtools-token"]')
  return meta?.getAttribute('content') ?? null
}

function createHttpClient(): RpcClient {
  // Same-origin only — the dev iframe lives on the Vite server origin.
  const baseUrl = window.location.origin
  const token = readDevtoolsToken()
  return {
    async call(method: string, ...args: unknown[]) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['x-svelte-devtools-token'] = token
      const res = await fetch(`${baseUrl}/__svelte-devtools/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`RPC ${method} failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
      }
      return res.json()
    },
  }
}

async function getClient(): Promise<RpcClient> {
  if (rpcClient) return rpcClient
  if (clientPromise) return clientPromise

  clientPromise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const kitClient = await Promise.race([
        (async () => {
          const { getDevToolsRpcClient } = await import('@vitejs/devtools-kit/client')
          return await getDevToolsRpcClient()
        })(),
        new Promise<never>((_, reject) => {
          // 2s is the discovery timeout for DevTools Kit's WebSocket handshake.
          // If the kit isn't reachable by then, fall back to HTTP RPC.
          timer = setTimeout(() => reject(new Error('devtools-kit timeout')), 2000)
        }),
      ])
      return kitClient
    } catch {
      return createHttpClient()
    } finally {
      if (timer) clearTimeout(timer)
    }
  })()

  rpcClient = await clientPromise
  return rpcClient
}

export async function getProject(): Promise<ProjectInfo> {
  const client = await getClient()
  return client.call('svelte-devtools:get-project') as Promise<ProjectInfo>
}

export async function getRoutes(): Promise<RouteInfo[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-routes') as Promise<RouteInfo[]>
}

export async function getAssets(): Promise<AssetInfo[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-assets') as Promise<AssetInfo[]>
}

export async function getComponentRelations(): Promise<ComponentRelation[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-component-relations') as Promise<ComponentRelation[]>
}

export async function getLiveComponents(): Promise<ComponentInstance[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-live-components') as Promise<ComponentInstance[]>
}

export async function openInEditor(filePath: string, line?: number): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:open-in-editor', filePath, line ?? 0)
}

export async function openReactiveInEditor(file: string, name: string, type: string): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:open-reactive-in-editor', file, name, type)
}

// Phase 2: Performance Analysis

export async function getReactiveGraph(): Promise<ReactiveGraph> {
  const client = await getClient()
  return client.call('svelte-devtools:get-reactive-graph') as Promise<ReactiveGraph>
}

export async function getRenderProfiles(): Promise<RenderProfile[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-render-profiles') as Promise<RenderProfile[]>
}

export async function getLoadProfiles(): Promise<LoadProfile[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-load-profiles') as Promise<LoadProfile[]>
}

export async function clearLoadProfiles(): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:clear-load-profiles')
}

// Phase 3: Debug & Developer Experience

export async function getStateTimeline(): Promise<StateChange[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-state-timeline') as Promise<StateChange[]>
}

export async function clearStateTimeline(): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:clear-state-timeline')
}

export async function getApiEndpoints(): Promise<ApiEndpoint[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-api-endpoints') as Promise<ApiEndpoint[]>
}

export async function sendApiRequest(url: string, method: string, headers: string, body: string): Promise<ApiResponse> {
  const client = await getClient()
  return client.call('svelte-devtools:send-api-request', url, method, headers, body) as Promise<ApiResponse>
}

export async function getCompilerWarnings(): Promise<CompilerWarning[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-compiler-warnings') as Promise<CompilerWarning[]>
}

export async function getRuntimeErrors(): Promise<RuntimeError[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-runtime-errors') as Promise<RuntimeError[]>
}

export async function clearErrors(): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:clear-errors')
}

export async function getSvelteFiles(): Promise<{ file: string; name: string }[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-svelte-files') as Promise<{ file: string; name: string }[]>
}

export async function inspectFile(filePath: string): Promise<InspectResult> {
  const client = await getClient()
  return client.call('svelte-devtools:inspect-file', filePath) as Promise<InspectResult>
}

// Phase 4: Advanced Features

export async function getModuleGraph(): Promise<ModuleGraphData> {
  const client = await getClient()
  return client.call('svelte-devtools:get-module-graph') as Promise<ModuleGraphData>
}

export async function getOGPreview(url: string): Promise<OGPreview> {
  const client = await getClient()
  return client.call('svelte-devtools:get-og-preview', url) as Promise<OGPreview>
}

export async function getBuildAnalysis(): Promise<BuildAnalysis> {
  const client = await getClient()
  return client.call('svelte-devtools:get-build-analysis') as Promise<BuildAnalysis>
}

// FPS Monitoring

export async function getFps(): Promise<FpsSample[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-fps') as Promise<FpsSample[]>
}

export async function clearFps(): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:clear-fps')
}
