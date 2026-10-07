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
import { vi, type Mock } from 'vitest'

import type * as Real from '../lib/rpc.js'
import type {
  BuildAnalysis,
  DatasetVersions,
  InspectResult,
  LiveComponentsMeta,
  ModuleGraphData,
  OGPreview,
  ProjectInfo,
  ReactiveGraphResult,
  ReactiveSummary,
} from '../lib/types.js'

type RealRpc = typeof Real
type FnKey = {
  [K in keyof RealRpc]: RealRpc[K] extends (...a: never[]) => unknown ? K : never
}[keyof RealRpc]
type ConnectionState = Real.ConnectionState

export const project: ProjectInfo = {
  name: 'demo-app',
  version: '1.0.0',
  svelteVersion: '5.0.0',
  sveltekitVersion: '2.0.0',
  viteVersion: '6.0.0',
  dependencies: {},
  devDependencies: {},
  routesDir: 'src/routes',
  staticDir: 'static',
}

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
}

export const emptySummary: ReactiveSummary = {
  epoch: 'e1',
  window: { ms: 10_000, since: 0, until: 10_000, sampledActiveMs: 10_000 },
  policy: 'sampled-200ms',
  coverage: 'component-init',
  components: { total: 0, withActivity: 0 },
  rows: [],
  other: null,
  truncated: false,
  capabilities: { valueInspection: true, signalHistory: false, writeCause: false },
}

export const versions: DatasetVersions = {
  components: 0,
  renderProfiles: 0,
  loadProfiles: 0,
  stateTimeline: 0,
  reactiveGraph: 0,
  errors: 0,
  fps: 0,
}

const liveMeta: LiveComponentsMeta = { total: 0, kept: 0, truncated: false, epochs: 1 }
const moduleGraph: ModuleGraphData = { modules: [], cycles: [] }
const build: BuildAnalysis = { chunks: [], totalSize: 0, timestamp: 0 }
const og: OGPreview = { url: '', title: '', description: '', image: '', tags: [], issues: [] }
const inspected: InspectResult = { source: '', compiled: '', file: '' }

let connectionState: ConnectionState = { status: 'connected', host: 'standalone' }
const connectionListeners = new Set<(s: ConnectionState) => void>()

const defaults: { [K in FnKey]: RealRpc[K] } = {
  getConnectionState: () => connectionState,
  onConnectionState: cb => {
    connectionListeners.add(cb)
    cb(connectionState)
    return () => {
      connectionListeners.delete(cb)
    }
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
  getReactiveGraph: () => Promise.resolve(emptyGraph),
  getReactiveSummary: () => Promise.resolve(emptySummary),
  getCaptureInfo: () => Promise.resolve({}),
  getRenderProfiles: () => Promise.resolve([]),
  getLoadProfiles: () => Promise.resolve([]),
  clearLoadProfiles: () => Promise.resolve(),
  getStateTimeline: () => Promise.resolve([]),
  getStateTimelineDelta: () => Promise.resolve({ cursor: 0, reset: true, changes: [] }),
  getVersions: () => Promise.resolve(versions),
  clearStateTimeline: () => Promise.resolve(),
  getApiEndpoints: () => Promise.resolve([]),
  sendApiRequest: () =>
    Promise.resolve({ status: 200, statusText: 'OK', headers: {}, body: '', duration: 1 }),
  getCompilerWarnings: () => Promise.resolve([]),
  getRuntimeErrors: () => Promise.resolve([]),
  clearErrors: () => Promise.resolve(),
  getSvelteFiles: () => Promise.resolve([]),
  inspectFile: () => Promise.resolve(inspected),
  getModuleGraph: () => Promise.resolve(moduleGraph),
  getOGPreview: () => Promise.resolve(og),
  getBuildAnalysis: () => Promise.resolve(build),
  getFps: () => Promise.resolve([]),
  clearFps: () => Promise.resolve(),
}

function fake<K extends FnKey>(key: K): Mock<RealRpc[K]> {
  return vi.fn(defaults[key])
}

export const getConnectionState = fake('getConnectionState')
export const onConnectionState = fake('onConnectionState')
export const requestAuthCode = fake('requestAuthCode')
export const submitAuthCode = fake('submitAuthCode')
export const getProject = fake('getProject')
export const getRoutes = fake('getRoutes')
export const getAssets = fake('getAssets')
export const getComponentRelations = fake('getComponentRelations')
export const getLiveComponents = fake('getLiveComponents')
export const getLiveComponentsMeta = fake('getLiveComponentsMeta')
export const openInEditor = fake('openInEditor')
export const openReactiveInEditor = fake('openReactiveInEditor')
export const getReactiveGraph = fake('getReactiveGraph')
export const getReactiveSummary = fake('getReactiveSummary')
export const getCaptureInfo = fake('getCaptureInfo')
export const getRenderProfiles = fake('getRenderProfiles')
export const getLoadProfiles = fake('getLoadProfiles')
export const clearLoadProfiles = fake('clearLoadProfiles')
export const getStateTimeline = fake('getStateTimeline')
export const getStateTimelineDelta = fake('getStateTimelineDelta')
export const getVersions = fake('getVersions')
export const clearStateTimeline = fake('clearStateTimeline')
export const getApiEndpoints = fake('getApiEndpoints')
export const sendApiRequest = fake('sendApiRequest')
export const getCompilerWarnings = fake('getCompilerWarnings')
export const getRuntimeErrors = fake('getRuntimeErrors')
export const clearErrors = fake('clearErrors')
export const getSvelteFiles = fake('getSvelteFiles')
export const inspectFile = fake('inspectFile')
export const getModuleGraph = fake('getModuleGraph')
export const getOGPreview = fake('getOGPreview')
export const getBuildAnalysis = fake('getBuildAnalysis')
export const getFps = fake('getFps')
export const clearFps = fake('clearFps')

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
  getReactiveGraph,
  getReactiveSummary,
  getCaptureInfo,
  getRenderProfiles,
  getLoadProfiles,
  clearLoadProfiles,
  getStateTimeline,
  getStateTimelineDelta,
  getVersions,
  clearStateTimeline,
  getApiEndpoints,
  sendApiRequest,
  getCompilerWarnings,
  getRuntimeErrors,
  clearErrors,
  getSvelteFiles,
  inspectFile,
  getModuleGraph,
  getOGPreview,
  getBuildAnalysis,
  getFps,
  clearFps,
}

/** Push a connection state to every `onConnectionState` subscriber (the shell's gate). */
export function emitConnection(next: ConnectionState): void {
  connectionState = next
  for (const listener of connectionListeners) listener(next)
}

/** Restore every default implementation and clear recorded calls. */
export function resetFakeRpc(): void {
  for (const key of Object.keys(all) as FnKey[]) {
    const mock = all[key] as Mock<(...a: never[]) => unknown>
    mock.mockReset()
    mock.mockImplementation(defaults[key])
  }
  emitConnection({ status: 'connected', host: 'standalone' })
}
