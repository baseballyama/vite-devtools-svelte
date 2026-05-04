export interface RouteInfo {
  id: string
  path: string
  pattern: string
  segments: string[]
  hasPage: boolean
  hasLayout: boolean
  hasServerPage: boolean
  hasServerLayout: boolean
  hasEndpoint: boolean
  hasPageLoad: boolean
  hasLayoutLoad: boolean
  params: ParamInfo[]
  files: RouteFile[]
}

export interface ParamInfo {
  name: string
  optional: boolean
  rest: boolean
  matcher?: string
}

export interface RouteFile {
  type: 'page' | 'layout' | 'server-page' | 'server-layout' | 'endpoint' | 'page-load' | 'layout-load' | 'error' | 'page-load-server' | 'layout-load-server'
  path: string
}

export interface AssetInfo {
  name: string
  path: string
  relativePath: string
  size: number
  type: string
  mtime: number
}

export interface ProjectInfo {
  name: string
  version: string
  svelteVersion: string
  sveltekitVersion: string
  viteVersion: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  routesDir: string
  staticDir: string
}

export interface ComponentRelation {
  file: string
  name: string
  imports: string[]
}

export interface ComponentInstance {
  id: number
  file: string
  name: string
  parentId: number | null
  mounted: boolean
}

// Phase 2: Performance Analysis

export interface RenderProfile {
  componentId: number
  file: string
  name: string
  initTime: number
  renderCount: number
  totalRenderTime: number
  lastRenderTime: number
  lastRenderAt: number
}

export interface ReactiveNode {
  id: string
  type: 'state' | 'derived' | 'effect'
  name: string
  componentId: number
  componentFile: string
  value?: unknown
}

export interface ReactiveEdge {
  from: string
  to: string
}

export interface ReactiveGraph {
  nodes: ReactiveNode[]
  edges: ReactiveEdge[]
}

export interface LoadProfile {
  route: string
  file: string
  type: 'server' | 'universal'
  duration: number
  dataSize: number
  timestamp: number
}

// Phase 3: Debug & Developer Experience

export interface StateChange {
  id: string
  name: string
  componentFile: string
  oldValue: unknown
  newValue: unknown
  timestamp: number
}

export interface ApiEndpoint {
  route: string
  path: string
  methods: string[]
  file: string
}

export interface ApiResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
}

export interface CompilerWarning {
  code: string
  message: string
  file: string
  line?: number
  column?: number
}

export interface RuntimeError {
  message: string
  file?: string
  line?: number
  column?: number
  stack?: string
  timestamp: number
}

export interface InspectResult {
  source: string
  compiled: string
  file: string
  /** VLQ-encoded source map `mappings` string (per the Source Map v3 spec). */
  mappings?: string
  /** Source map sources array */
  sources?: string[]
}

// Phase 4: Advanced Features

export interface ModuleNode {
  id: string
  file: string
  type: 'svelte' | 'js' | 'ts' | 'css' | 'other'
  importedBy: string[]
  imports: string[]
  isCyclic?: boolean
  size?: number
}

export interface ModuleGraphData {
  modules: ModuleNode[]
  cycles: string[][]
}

export interface OGTag {
  property: string
  content: string
}

export interface OGPreview {
  url: string
  title: string
  description: string
  image: string
  tags: OGTag[]
  issues: string[]
}

export interface BuildChunk {
  name: string
  file: string
  size: number
  modules: string[]
  isEntry: boolean
}

export interface BuildAnalysis {
  chunks: BuildChunk[]
  totalSize: number
  timestamp: number
}

// FPS Monitoring

export interface FpsSample {
  timestamp: number
  fps: number
}
