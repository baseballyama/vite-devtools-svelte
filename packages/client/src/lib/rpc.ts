import { connectDevframe } from 'devframe/client';
import type { DevframeConnectionStatus, DevframeRpcClient } from 'devframe/client';

import { errorMessage } from './format.js';
import type {
  RouteInfo,
  AssetInfo,
  ProjectInfo,
  ComponentRelation,
  ComponentInstance,
  ElementPick,
  RenderProfile,
  LoadProfile,
  ReactiveGraphRequest,
  ReactiveGraphResult,
  ReactiveSummary,
  ReactiveSummaryRequest,
  CaptureInfoMap,
  StateChange,
  ApiEndpoint,
  CompilerWarning,
  RuntimeError,
  InspectResult,
  ModuleGraphData,
  OGPreview,
  BuildAnalysis,
  FpsSample,
  StateTimelineDelta,
  DatasetVersions,
  LiveComponentsMeta,
} from './types.js';

// Runs both standalone and inside the Vite DevTools dock; `connectDevframe()`
// discovers the backend through `./__connection.json` in both, so nothing
// here may be host-specific.

const NAMESPACE = 'svelte-devtools';

export type ConnectionStatus = DevframeConnectionStatus;

export interface ConnectionState {
  status: ConnectionStatus;
  host: 'standalone' | 'vite-devtools' | 'unknown';
  error?: string;
}

const RECONNECT_MIN_DELAY = 500;
const RECONNECT_MAX_DELAY = 10_000;

let client: DevframeRpcClient | null = null;
// In-flight connection, shared so concurrent first calls (e.g. a Promise.all
// during mount) do not each open a socket.
let connecting: Promise<DevframeRpcClient> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = RECONNECT_MIN_DELAY;
let state: ConnectionState = { status: 'connecting', host: 'unknown' };
const listeners = new Set<(s: ConnectionState) => void>();

function setState(next: Partial<ConnectionState>): void {
  state = { ...state, ...next };
  if (next.status && next.status !== 'error') state.error = next.error;
  for (const listener of listeners) listener(state);
  syncActivity();
}

// The injected runtime only polls state / samples FPS while some consumer
// holds a lease. This tab holds one while it is connected and visible, renewing well inside the server's 15 s TTL.

const HEARTBEAT_INTERVAL = 5_000;
// Also loaded by unit tests outside a browser.
const hasDocument = typeof document !== 'undefined';
const CLIENT_ID = Math.random().toString(36).slice(2, 12);
let heartbeat: ReturnType<typeof setInterval> | undefined;

function sendActive(active: boolean): void {
  const c = client;
  if (c?.status !== 'connected') return;
  c.scope(NAMESPACE)
    .rpc.call('set-active', { client: CLIENT_ID, active })
    .catch(() => {});
}

function syncActivity(): void {
  const wanted =
    state.status === 'connected' && hasDocument && document.visibilityState === 'visible';
  if (wanted && !heartbeat) {
    sendActive(true);
    heartbeat = setInterval(() => sendActive(true), HEARTBEAT_INTERVAL);
  } else if (!wanted && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = undefined;
    sendActive(false);
  }
}

if (hasDocument) {
  document.addEventListener('visibilitychange', syncActivity);
  window.addEventListener('pagehide', () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    sendActive(false);
  });
}

const pickListeners = new Set<(pick: ElementPick) => void>();

function listenForPicks(c: DevframeRpcClient): void {
  c.scope(NAMESPACE).rpc.register({
    name: 'element-picked',
    type: 'event',
    handler: (pick: ElementPick) => {
      for (const listener of pickListeners) listener(pick);
    },
  });
}

function detectHost(c: DevframeRpcClient): ConnectionState['host'] {
  // Vite DevTools serves every mounted devframe through its hub, which
  // advertises hub UI configs in the connection meta.
  return c.connectionMeta?.configs ? 'vite-devtools' : 'standalone';
}

/**
 * A devframe client is final once its socket closes (no built-in
 * reconnect), so a dev-server restart leaves it `disconnected` for good.
 * Drop it and dial again with exponential backoff; the persisted bearer
 * token re-trusts the new connection without asking for a code again.
 */
function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    getClient().catch(() => {});
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
}

function discard(c: DevframeRpcClient): void {
  if (client !== c) return;
  client = null;
  try {
    c.close?.();
  } catch {
    /* already closed */
  }
}

async function getClient(): Promise<DevframeRpcClient> {
  if (client) return client;
  if (connecting) return connecting;

  setState({ status: 'connecting' });
  // The shell renders its own code-entry gate; devframe's fallback
  // `window.prompt()` would block the main thread on every reconnect.
  connecting = connectDevframe({ simpleAuth: false })
    .then(c => {
      client = c;
      listenForPicks(c);
      setState({ status: c.status, host: detectHost(c) });
      c.events.on('connection:status', status => {
        if (client !== c) return;
        if (status === 'connected') reconnectDelay = RECONNECT_MIN_DELAY;
        setState({ status, error: c.connectionError?.message });
        if (status === 'disconnected' || status === 'error') {
          discard(c);
          scheduleReconnect();
        }
      });
      return c;
    })
    .catch((e: unknown) => {
      // `__connection.json` unreachable (server down / restarting).
      setState({ status: 'error', error: errorMessage(e) });
      scheduleReconnect();
      throw e;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  try {
    const c = await getClient();
    // The scoped view prefixes `svelte-devtools:` and accepts our untyped ids.
    return (await c.scope(NAMESPACE).rpc.call(method, ...args)) as T;
  } catch (e) {
    throw new Error(`RPC ${method} failed: ${errorMessage(e)}`, {
      cause: e,
    });
  }
}

export function getConnectionState(): ConnectionState {
  return state;
}

/** Subscribing also starts connecting. */
export function onConnectionState(cb: (s: ConnectionState) => void): () => void {
  listeners.add(cb);
  cb(state);
  getClient().catch(() => {});
  return () => {
    listeners.delete(cb);
  };
}

/** devframe prints each code at most once; pass `reissue: true` to rotate it and print again. */
export async function requestAuthCode(options: { reissue?: boolean } = {}): Promise<void> {
  const c = await getClient();
  await c.requestAuthCode(options.reissue ? { reissue: true } : {});
}

export async function submitAuthCode(code: string): Promise<boolean> {
  const c = await getClient();
  return c.requestTrustWithCode(code.trim());
}

export function getProject(): Promise<ProjectInfo> {
  return call('get-project');
}

export function getRoutes(): Promise<RouteInfo[]> {
  return call('get-routes');
}

export function getAssets(): Promise<AssetInfo[]> {
  return call('get-assets');
}

export function getComponentRelations(): Promise<ComponentRelation[]> {
  return call('get-component-relations');
}

export function getLiveComponents(): Promise<ComponentInstance[]> {
  return call('get-live-components');
}

export function getLiveComponentsMeta(): Promise<LiveComponentsMeta> {
  return call('get-live-components-meta');
}

export async function openInEditor(filePath: string, line?: number): Promise<void> {
  await call('open-in-editor', { file: filePath, line: line && line > 0 ? line : undefined });
}

export async function openReactiveInEditor(
  file: string,
  name: string,
  type: string,
): Promise<void> {
  await call('open-reactive-in-editor', { file, name, type });
}

async function deliverRecentPick(cb: (pick: ElementPick) => void): Promise<void> {
  const pick = await call<ElementPick | null>('get-recent-element-pick');
  if (pick && pickListeners.has(cb)) cb(pick);
}

/**
 * Elements picked in the app page's inspector (clicked while it is on).
 * Delivered while this tab is hidden too, and a pick made just before this
 * UI connected (the dock opening the Svelte panel for it) is delivered once
 * on subscribing. Returns an unsubscribe function.
 */
export function onElementPicked(cb: (pick: ElementPick) => void): () => void {
  pickListeners.add(cb);
  deliverRecentPick(cb).catch(() => {});
  return () => {
    pickListeners.delete(cb);
  };
}

/** `total`/`truncated`/`stale` say what the answer covers. */
export function getReactiveGraph(req?: ReactiveGraphRequest): Promise<ReactiveGraphResult> {
  return req ? call('get-reactive-graph', req) : call('get-reactive-graph');
}

/** Built from runtime counters; never captures the graph. */
export function getReactiveSummary(req?: ReactiveSummaryRequest): Promise<ReactiveSummary> {
  return req ? call('get-reactive-summary', req) : call('get-reactive-summary');
}

export function getCaptureInfo(): Promise<CaptureInfoMap> {
  return call('get-capture-info');
}

export function getRenderProfiles(): Promise<RenderProfile[]> {
  return call('get-render-profiles');
}

export function getLoadProfiles(): Promise<LoadProfile[]> {
  return call('get-load-profiles');
}

export async function clearLoadProfiles(): Promise<void> {
  await call('clear-load-profiles');
}

export function getStateTimeline(): Promise<StateChange[]> {
  return call('get-state-timeline');
}

/**
 * Timeline changes after `since` (the previous `cursor`); `reset: true` means
 * replace the local list. Cheap to poll: answered from the server buffer.
 */
export function getStateTimelineDelta(since?: number): Promise<StateTimelineDelta> {
  return call('get-state-timeline-delta', { since });
}

/** Change counters per dataset; poll this and refetch only what moved. */
export function getVersions(): Promise<DatasetVersions> {
  return call('get-versions');
}

export async function clearStateTimeline(): Promise<void> {
  await call('clear-state-timeline');
}

export function getApiEndpoints(): Promise<ApiEndpoint[]> {
  return call('get-api-endpoints');
}

export function getCompilerWarnings(): Promise<CompilerWarning[]> {
  return call('get-compiler-warnings');
}

export function getRuntimeErrors(): Promise<RuntimeError[]> {
  return call('get-runtime-errors');
}

export async function clearErrors(): Promise<void> {
  await call('clear-errors');
}

export interface SvelteFileEntry {
  file: string;
  name: string;
}

export function getSvelteFiles(): Promise<SvelteFileEntry[]> {
  return call('get-svelte-files');
}

export function inspectFile(filePath: string): Promise<InspectResult> {
  return call('inspect-file', { file: filePath });
}

export function getModuleGraph(): Promise<ModuleGraphData> {
  return call('get-module-graph');
}

export function getOGPreview(url: string): Promise<OGPreview> {
  return call('get-og-preview', { url });
}

export function getBuildAnalysis(): Promise<BuildAnalysis> {
  return call('get-build-analysis');
}

export function getFps(): Promise<FpsSample[]> {
  return call('get-fps');
}

export async function clearFps(): Promise<void> {
  await call('clear-fps');
}
