import type { Component } from 'svelte';

import { inDevtoolsDock } from './devtools-dock.js';
import type { IconName } from './icons.js';

export type PanelGroup = 'start' | 'inspect' | 'profile' | 'project';
export type PanelView = 'overview' | 'problems' | 'inspect' | 'profile' | 'project' | 'add';

export interface PanelDef {
  id: string;
  label: string;
  icon: IconName;
  group: PanelGroup;
  description: string;
  keywords?: string;
  /** Only shown when the app uses SvelteKit (noise otherwise). */
  kit?: boolean;
  /** Only shown inside the Vite DevTools dock (needs its terminal). */
  dock?: boolean;
  load: () => Promise<{ default: Component }>;
}

/** `start` has no visible heading in the sidebar. */
export const groupLabels: Record<PanelGroup, string> = {
  start: 'General',
  inspect: 'Inspect',
  profile: 'Profile',
  project: 'Project',
};

export const panels = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'overview',
    group: 'start',
    description: 'Project, versions and health at a glance',
    load: () => import('../panels/Overview.svelte'),
  },
  {
    id: 'errors',
    label: 'Problems',
    icon: 'errors',
    group: 'start',
    description: 'Compiler warnings and runtime errors',
    keywords: 'warnings errors diagnostics',
    load: () => import('../panels/Problems.svelte'),
  },
  {
    id: 'components',
    label: 'Components',
    icon: 'components',
    group: 'inspect',
    description: 'Live component tree and static import graph',
    keywords: 'tree instance mounted imports',
    load: () => import('../panels/Components.svelte'),
  },
  {
    id: 'reactive',
    label: 'Reactivity',
    icon: 'reactive',
    group: 'inspect',
    description: '$state / $derived / $effect dependency graph',
    keywords: 'signals runes effect derived state',
    load: () => import('../panels/Reactivity.svelte'),
  },
  {
    id: 'timeline',
    label: 'State timeline',
    icon: 'timeline',
    group: 'inspect',
    description: 'Every $state mutation, newest first',
    keywords: 'history changes mutations',
    load: () => import('../panels/StateTimeline.svelte'),
  },
  {
    id: 'render',
    label: 'Render',
    icon: 'render',
    group: 'profile',
    description: 'Per-component init and render cost',
    keywords: 'profiler performance slow',
    load: () => import('../panels/RenderProfiler.svelte'),
  },
  {
    id: 'loads',
    kit: true,
    label: 'Load functions',
    icon: 'loads',
    group: 'profile',
    description: 'Server / universal load timings',
    keywords: 'waterfall data fetch',
    load: () => import('../panels/LoadProfiler.svelte'),
  },
  {
    id: 'fps',
    label: 'Frame rate',
    icon: 'fps',
    group: 'profile',
    description: 'Live FPS with recordable windows',
    keywords: 'fps jank frames',
    load: () => import('../panels/FpsMonitor.svelte'),
  },
  {
    id: 'build',
    kit: true,
    label: 'Build',
    icon: 'build',
    group: 'profile',
    description: 'Production chunks and sizes',
    keywords: 'bundle chunks size',
    load: () => import('../panels/BuildAnalysis.svelte'),
  },
  {
    id: 'routes',
    kit: true,
    label: 'Routes',
    icon: 'routes',
    group: 'project',
    description: 'SvelteKit route tree and route files',
    keywords: 'pages layouts params kit',
    load: () => import('../panels/Routes.svelte'),
  },
  {
    id: 'api',
    kit: true,
    label: 'API',
    icon: 'api',
    group: 'project',
    description: 'Call +server endpoints',
    keywords: 'endpoint request http playground',
    load: () => import('../panels/ApiPlayground.svelte'),
  },
  {
    id: 'modules',
    label: 'Modules',
    icon: 'modules',
    group: 'project',
    description: 'Vite module graph with cycle detection',
    keywords: 'imports graph circular',
    load: () => import('../panels/ModuleGraph.svelte'),
  },
  {
    id: 'assets',
    label: 'Assets',
    icon: 'assets',
    group: 'project',
    description: 'Static assets by type and size',
    keywords: 'images fonts static',
    load: () => import('../panels/Assets.svelte'),
  },
  {
    id: 'addons',
    dock: true,
    label: 'Add',
    icon: 'plus',
    group: 'project',
    description: 'Install sv add-ons in one click',
    keywords: 'sv add addon install tailwind vitest drizzle',
    load: () => import('../panels/Addons.svelte'),
  },
  {
    id: 'og',
    label: 'Social preview',
    icon: 'og',
    group: 'project',
    description: 'Open Graph tags and card preview',
    keywords: 'og meta seo twitter',
    load: () => import('../panels/OGPreview.svelte'),
  },
] as const satisfies readonly PanelDef[];

export type PanelId = (typeof panels)[number]['id'];

/** SvelteKit-only panels stay hidden while `kit` is unknown, so apps without SvelteKit never see them flash in. */
export function visiblePanels(
  kit: boolean | undefined,
  docked = inDevtoolsDock(),
): (PanelDef & { id: PanelId })[] {
  return panels.filter((p: PanelDef) => (!p.kit || kit === true) && (!p.dock || docked));
}

const viewPanels: Record<PanelView, readonly PanelId[]> = {
  overview: ['overview'],
  problems: ['errors'],
  inspect: ['components', 'reactive', 'timeline'],
  profile: ['render', 'loads', 'fps', 'build'],
  project: ['routes', 'api', 'modules', 'assets', 'og'],
  add: ['addons'],
};

// The Overview is the devframe's own dock, whose URL cannot carry `?view`.
export function requestedPanelView(
  search = location.search,
  embedded = inDevtoolsDock(),
): PanelView | null {
  const requested = new URLSearchParams(search).get('view');
  if (requested && Object.hasOwn(viewPanels, requested)) return requested as PanelView;
  return embedded ? 'overview' : null;
}

/** Every visible panel when `view` is null (the standalone page). */
export function panelsForView(
  kit: boolean | undefined,
  view: PanelView | null,
  docked = inDevtoolsDock(),
): (PanelDef & { id: PanelId })[] {
  const visible = visiblePanels(kit, docked);
  if (view === null) return visible;
  return viewPanels[view]
    .map(id => visible.find(panel => panel.id === id))
    .filter(panel => panel !== undefined);
}

export function panelById(id: PanelId): PanelDef {
  return panels.find(p => p.id === id)!;
}
