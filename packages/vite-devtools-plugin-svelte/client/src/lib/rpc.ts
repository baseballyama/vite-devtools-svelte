import type { RouteInfo, AssetInfo, ProjectInfo, ComponentRelation, ComponentInstance, RenderProfile, LoadProfile, ReactiveGraph, StateChange, ApiEndpoint, ApiResponse, CompilerWarning, RuntimeError, InspectResult, ModuleGraphData, OGPreview, BuildAnalysis } from './types.js'

interface RpcClient {
  call(method: string, ...args: unknown[]): Promise<unknown>
}

let rpcClient: RpcClient | null = null

function createHttpClient(): RpcClient {
  // Determine the base URL: if we're in an iframe, use the parent origin
  const baseUrl = window.location.origin
  return {
    async call(method: string, ...args: unknown[]) {
      const res = await fetch(`${baseUrl}/__svelte-devtools/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })
      if (!res.ok) throw new Error(`RPC failed: ${res.statusText}`)
      return res.json()
    },
  }
}

async function getClient(): Promise<RpcClient> {
  if (rpcClient) return rpcClient

  // Try DevTools Kit RPC first with a timeout
  try {
    const kitClient = await Promise.race([
      (async () => {
        const { getDevToolsRpcClient } = await import('@vitejs/devtools-kit/client')
        return await getDevToolsRpcClient()
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      ),
    ])
    rpcClient = kitClient
    return kitClient
  } catch {
    // Fallback to HTTP RPC
    rpcClient = createHttpClient()
    return rpcClient
  }
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

export async function getFps(): Promise<{ timestamp: number; fps: number }[]> {
  const client = await getClient()
  return client.call('svelte-devtools:get-fps') as Promise<{ timestamp: number; fps: number }[]>
}

export async function clearFps(): Promise<void> {
  const client = await getClient()
  await client.call('svelte-devtools:clear-fps')
}
