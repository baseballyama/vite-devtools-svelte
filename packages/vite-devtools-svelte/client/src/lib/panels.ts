/**
 * Panel registry — single source of truth for navigation, the command
 * palette and the router. Panels are code-split and loaded on first visit.
 */
import type { Component } from 'svelte'
import type { IconName } from './icons.js'

export type PanelGroup = 'app' | 'perf' | 'tools'

export interface PanelDef {
  id: string
  label: string
  icon: IconName
  group: PanelGroup
  description: string
  keywords?: string
  load: () => Promise<{ default: Component }>
}

export const groupLabels: Record<PanelGroup, string> = {
  app: 'App',
  perf: 'Performance',
  tools: 'Tools',
}

export const panels = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'app', description: 'Project, versions and health at a glance', load: () => import('../panels/Overview.svelte') },
  { id: 'components', label: 'Components', icon: 'components', group: 'app', description: 'Live component tree and static import graph', keywords: 'tree instance mounted imports', load: () => import('../panels/Components.svelte') },
  { id: 'routes', label: 'Routes', icon: 'routes', group: 'app', description: 'SvelteKit route tree and route files', keywords: 'pages layouts params kit', load: () => import('../panels/Routes.svelte') },
  { id: 'modules', label: 'Modules', icon: 'modules', group: 'app', description: 'Vite module graph with cycle detection', keywords: 'imports graph circular', load: () => import('../panels/ModuleGraph.svelte') },
  { id: 'assets', label: 'Assets', icon: 'assets', group: 'app', description: 'Static assets by type and size', keywords: 'images fonts static', load: () => import('../panels/Assets.svelte') },
  { id: 'render', label: 'Render', icon: 'render', group: 'perf', description: 'Per-component init and render cost', keywords: 'profiler performance slow', load: () => import('../panels/RenderProfiler.svelte') },
  { id: 'reactive', label: 'Reactivity', icon: 'reactive', group: 'perf', description: '$state / $derived / $effect dependency graph', keywords: 'signals runes effect derived state', load: () => import('../panels/ReactiveGraph.svelte') },
  { id: 'timeline', label: 'State timeline', icon: 'timeline', group: 'perf', description: 'Every $state mutation, newest first', keywords: 'history changes mutations', load: () => import('../panels/StateTimeline.svelte') },
  { id: 'loads', label: 'Load functions', icon: 'loads', group: 'perf', description: 'Server / universal load timings', keywords: 'waterfall data fetch', load: () => import('../panels/LoadProfiler.svelte') },
  { id: 'fps', label: 'Frame rate', icon: 'fps', group: 'perf', description: 'Live FPS with recordable windows', keywords: 'fps jank frames', load: () => import('../panels/FpsMonitor.svelte') },
  { id: 'build', label: 'Build', icon: 'build', group: 'perf', description: 'Production chunks and sizes', keywords: 'bundle chunks size', load: () => import('../panels/BuildAnalysis.svelte') },
  { id: 'errors', label: 'Problems', icon: 'errors', group: 'tools', description: 'Compiler warnings and runtime errors', keywords: 'warnings errors diagnostics', load: () => import('../panels/ErrorDashboard.svelte') },
  { id: 'inspect', label: 'Compiled output', icon: 'inspect', group: 'tools', description: 'Source ↔ compiled JS with source-map links', keywords: 'inspect compile sourcemap', load: () => import('../panels/Inspect.svelte') },
  { id: 'api', label: 'API', icon: 'api', group: 'tools', description: 'Call +server endpoints', keywords: 'endpoint request http playground', load: () => import('../panels/ApiPlayground.svelte') },
  { id: 'og', label: 'Social preview', icon: 'og', group: 'tools', description: 'Open Graph tags and card preview', keywords: 'og meta seo twitter', load: () => import('../panels/OGPreview.svelte') },
] as const satisfies readonly PanelDef[]

export type PanelId = (typeof panels)[number]['id']

export function panelById(id: string): PanelDef {
  return panels.find((p) => p.id === id) ?? panels[0]
}
