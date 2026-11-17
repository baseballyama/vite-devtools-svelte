/**
 * Typed stand-in for `src/lib/rpc.ts` in component tests (the `dom` vitest
 * project mocks the module with this one in `setup.ts`).
 *
 * Every export of the real module is a `vi.fn` with the same signature and a
 * harmless default (empty data, resolved promises). Tests import
 * `* as rpc from '../lib/rpc.js'` and override per test, e.g.
 * `vi.mocked(rpc.getRoutes).mockResolvedValue([...])`. `resetFakeRpc()`
 * (run before each test) restores the defaults.
 */
import { vi, type Mock } from 'vitest';

import type * as Real from '../lib/rpc.js';
import type {
  BuildAnalysis,
  DatasetVersions,
  ElementPick,
  LiveComponentsMeta,
  ModuleGraphData,
  OGPreview,
  PerformanceRecording,
  ProjectInfo,
  ReactiveGraphResult,
  ReactiveSummary,
} from '../lib/types.js';

type RealRpc = typeof Real;
type FnKey = {
  [K in keyof RealRpc]: RealRpc[K] extends (...a: never[]) => unknown ? K : never;
}[keyof RealRpc];
type ConnectionState = Real.ConnectionState;

export const project: ProjectInfo = {
  name: 'demo-app',
  version: '1.0.0',
  svelteVersion: '5.0.0',
  sveltekitVersion: '3.0.0',
  kit: true,
  viteVersion: '6.0.0',
  dependencies: {},
  devDependencies: {},
  staticDir: 'static',
};

export const emptyGraph: ReactiveGraphResult = {
  nodes: [],
  edges: [],
  scope: null,
  epoch: 'e1',
  total: { nodes: 0, nodesKind: 'registered', edges: 0 },
  truncated: false,
  edgesOmitted: 0,
  computedAt: 0,
  policy: 'global-head',
};

export const emptySummary: ReactiveSummary = {
  epoch: 'e1',
  computedAt: 10_000,
  policy: 'per-flush',
  coverage: 'component-init',
  components: { total: 0, withActivity: 0 },
  rows: [],
  other: null,
  truncated: false,
  capabilities: { valueInspection: true, signalHistory: false, writeCause: false },
};

export const versions: DatasetVersions = {
  components: 0,
  renderProfiles: 0,
  loadProfiles: 0,
  stateTimeline: 0,
  reactiveGraph: 0,
  errors: 0,
  fps: 0,
  apiEndpoints: 0,
  performance: 0,
};

export const idleRecording: PerformanceRecording = {
  state: 'idle',
  recordingId: null,
  startedAt: null,
  stoppedAt: null,
  epoch: null,
  updates: [],
  droppedUpdates: 0,
  components: [],
  componentsOmitted: false,
};

const liveMeta: LiveComponentsMeta = {
  total: 0,
  kept: 0,
  truncated: false,
  root: '/app',
  epochs: 1,
};
const moduleGraph: ModuleGraphData = { modules: [], cycles: [] };
const build: BuildAnalysis = { chunks: [], totalSize: 0, timestamp: 0 };
const og: OGPreview = { url: '', title: '', description: '', image: '', tags: [], issues: [] };

let connectionState: ConnectionState = { status: 'connected', host: 'standalone' };
const connectionListeners = new Set<(s: ConnectionState) => void>();
const pickListeners = new Set<(pick: ElementPick) => void>();

const defaults: { [K in FnKey]: RealRpc[K] } = {
  getConnectionState: () => connectionState,
  onConnectionState: cb => {
    connectionListeners.add(cb);
    cb(connectionState);
    return () => {
      connectionListeners.delete(cb);
    };
  },
  requestAuthCode: () => Promise.resolve(),
  submitAuthCode: () => Promise.resolve(true),
  getProject: () => Promise.resolve(project),
  getRoutes: () => Promise.resolve([]),
  getAssets: () => Promise.resolve([]),
  getComponentRelations: () => Promise.resolve([]),
  getLiveComponents: () => Promise.resolve([]),
  getLiveComponentsMeta: () => Promise.resolve(liveMeta),
  openInEditor: () => Promise.resolve(),
  openReactiveInEditor: () => Promise.resolve(),
  onElementPicked: cb => {
    pickListeners.add(cb);
    return () => {
      pickListeners.delete(cb);
    };
  },
  getReactiveGraph: () => Promise.resolve(emptyGraph),
  getReactiveSummary: () => Promise.resolve(emptySummary),
  getCaptureInfo: () => Promise.resolve({}),
  startPerformanceRecording: () => Promise.resolve({ recordingId: 'p1', startedAt: 0 }),
  stopPerformanceRecording: () => Promise.resolve(idleRecording),
  getPerformanceRecording: () => Promise.resolve(idleRecording),
  getLoadProfiles: () => Promise.resolve([]),
  clearLoadProfiles: () => Promise.resolve(),
  getStateTimeline: () => Promise.resolve([]),
  getStateTimelineDelta: () => Promise.resolve({ cursor: 0, reset: true, changes: [] }),
  getVersions: () => Promise.resolve(versions),
  clearStateTimeline: () => Promise.resolve(),
  getApiEndpoints: () => Promise.resolve([]),
  getCompilerWarnings: () => Promise.resolve([]),
  getRuntimeErrors: () => Promise.resolve([]),
  clearErrors: () => Promise.resolve(),
  getModuleGraph: () => Promise.resolve(moduleGraph),
  getOGPreview: () => Promise.resolve(og),
  getBuildAnalysis: () => Promise.resolve(build),
  getFps: () => Promise.resolve([]),
  clearFps: () => Promise.resolve(),
  getAddons: () => Promise.resolve({ available: false, addons: [] }),
  installAddon: () => Promise.resolve({ sessionId: '' }),
  getCommunityAddons: () => Promise.resolve({ addons: [] }),
};

function fake<K extends FnKey>(key: K): Mock<RealRpc[K]> {
  return vi.fn(defaults[key]);
}

export const getConnectionState = fake('getConnectionState');
export const onConnectionState = fake('onConnectionState');
export const requestAuthCode = fake('requestAuthCode');
export const submitAuthCode = fake('submitAuthCode');
export const getProject = fake('getProject');
export const getRoutes = fake('getRoutes');
export const getAssets = fake('getAssets');
export const getComponentRelations = fake('getComponentRelations');
export const getLiveComponents = fake('getLiveComponents');
export const getLiveComponentsMeta = fake('getLiveComponentsMeta');
export const openInEditor = fake('openInEditor');
export const openReactiveInEditor = fake('openReactiveInEditor');
export const onElementPicked = fake('onElementPicked');
export const getReactiveGraph = fake('getReactiveGraph');
export const getReactiveSummary = fake('getReactiveSummary');
export const getCaptureInfo = fake('getCaptureInfo');
export const startPerformanceRecording = fake('startPerformanceRecording');
export const stopPerformanceRecording = fake('stopPerformanceRecording');
export const getPerformanceRecording = fake('getPerformanceRecording');
export const getLoadProfiles = fake('getLoadProfiles');
export const clearLoadProfiles = fake('clearLoadProfiles');
export const getStateTimeline = fake('getStateTimeline');
export const getStateTimelineDelta = fake('getStateTimelineDelta');
export const getVersions = fake('getVersions');
export const clearStateTimeline = fake('clearStateTimeline');
export const getApiEndpoints = fake('getApiEndpoints');
export const getCompilerWarnings = fake('getCompilerWarnings');
export const getRuntimeErrors = fake('getRuntimeErrors');
export const clearErrors = fake('clearErrors');
export const getModuleGraph = fake('getModuleGraph');
export const getOGPreview = fake('getOGPreview');
export const getBuildAnalysis = fake('getBuildAnalysis');
export const getFps = fake('getFps');
export const clearFps = fake('clearFps');
export const getAddons = fake('getAddons');
export const installAddon = fake('installAddon');
export const getCommunityAddons = fake('getCommunityAddons');

const all: { [K in FnKey]: Mock<RealRpc[K]> } = {
  getConnectionState,
  onConnectionState,
  requestAuthCode,
  submitAuthCode,
  getProject,
  getRoutes,
  getAssets,
  getComponentRelations,
  getLiveComponents,
  getLiveComponentsMeta,
  openInEditor,
  openReactiveInEditor,
  onElementPicked,
  getReactiveGraph,
  getReactiveSummary,
  getCaptureInfo,
  startPerformanceRecording,
  stopPerformanceRecording,
  getPerformanceRecording,
  getLoadProfiles,
  clearLoadProfiles,
  getStateTimeline,
  getStateTimelineDelta,
  getVersions,
  clearStateTimeline,
  getApiEndpoints,
  getCompilerWarnings,
  getRuntimeErrors,
  clearErrors,
  getModuleGraph,
  getOGPreview,
  getBuildAnalysis,
  getFps,
  clearFps,
  getAddons,
  installAddon,
  getCommunityAddons,
};

/** Push a connection state to every `onConnectionState` subscriber (the shell's gate). */
export function emitConnection(next: ConnectionState): void {
  connectionState = next;
  for (const listener of connectionListeners) listener(next);
}

/** Deliver a server → UI element pick to every `onElementPicked` subscriber. */
export function emitPick(pick: ElementPick): void {
  for (const listener of pickListeners) listener(pick);
}

export function resetFakeRpc(): void {
  for (const key of Object.keys(all) as FnKey[]) {
    const mock = all[key] as Mock<(...a: never[]) => unknown>;
    mock.mockReset();
    mock.mockImplementation(defaults[key]);
  }
  emitConnection({ status: 'connected', host: 'standalone' });
}
