<script lang="ts">
  import type { Component } from 'svelte'
  import './lib/design-system.css'
  import { createThemeStore } from './lib/theme.svelte.js'
  import ThemeToggle from './components/ThemeToggle.svelte'
  import Overview from './panels/Overview.svelte'
  import Components from './panels/Components.svelte'
  import Routes from './panels/Routes.svelte'
  import Assets from './panels/Assets.svelte'
  import RenderProfiler from './panels/RenderProfiler.svelte'
  import ReactiveGraph from './panels/ReactiveGraph.svelte'
  import LoadProfiler from './panels/LoadProfiler.svelte'
  import StateTimeline from './panels/StateTimeline.svelte'
  import ApiPlayground from './panels/ApiPlayground.svelte'
  import ErrorDashboard from './panels/ErrorDashboard.svelte'
  import Inspect from './panels/Inspect.svelte'
  import ModuleGraph from './panels/ModuleGraph.svelte'
  import OGPreview from './panels/OGPreview.svelte'
  import BuildAnalysis from './panels/BuildAnalysis.svelte'
  import FpsMonitor from './panels/FpsMonitor.svelte'

  // Single source of truth for the panel registry: id, label, sidebar
  // icon class, and the component to render. Adding a new panel only
  // requires adding one entry — no separate `{:else if}` branch and
  // no separate type-union to keep in sync.
  type Tab = {
    id: string
    label: string
    icon: string
    component: Component
  }
  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'i-overview', component: Overview },
    { id: 'components', label: 'Components', icon: 'i-components', component: Components },
    { id: 'routes', label: 'Routes', icon: 'i-routes', component: Routes },
    { id: 'assets', label: 'Assets', icon: 'i-assets', component: Assets },
    { id: 'profiler', label: 'Profiler', icon: 'i-profiler', component: RenderProfiler },
    { id: 'reactive', label: 'Reactive', icon: 'i-reactive', component: ReactiveGraph },
    { id: 'fps', label: 'FPS', icon: 'i-profiler', component: FpsMonitor },
    { id: 'loads', label: 'Loads', icon: 'i-loads', component: LoadProfiler },
    { id: 'timeline', label: 'Timeline', icon: 'i-timeline', component: StateTimeline },
    { id: 'api', label: 'API', icon: 'i-api', component: ApiPlayground },
    { id: 'errors', label: 'Errors', icon: 'i-errors', component: ErrorDashboard },
    { id: 'inspect', label: 'Inspect', icon: 'i-inspect', component: Inspect },
    { id: 'modules', label: 'Modules', icon: 'i-modules', component: ModuleGraph },
    { id: 'og', label: 'OG', icon: 'i-og', component: OGPreview },
    { id: 'build', label: 'Build', icon: 'i-build', component: BuildAnalysis },
  ] as const satisfies readonly Tab[]

  type TabId = (typeof tabs)[number]['id']

  let activeTab = $state<TabId>('overview')
  const ActivePanel = $derived(
    (tabs.find((t) => t.id === activeTab) ?? tabs[0]).component,
  )
  const theme = createThemeStore()
</script>

<div class="devtools">
  <nav class="sidebar">
    <div class="logo">
      <svg viewBox="0 0 100 100" width="22" height="22">
        <path d="M85.8 11.7c-7.3-4.2-16.7-1.7-21 5.6L41.2 59l-8.6-4.8c-7.3-4.2-16.7-1.7-21 5.6-4.2 7.3-1.7 16.7 5.6 21l19.8 11.4c7.3 4.2 16.7 1.7 21-5.6L91.4 32.7c4.2-7.3 1.7-16.7-5.6-21z" fill="#ff3e00"/>
      </svg>
      <span class="logo-text">Svelte</span>
    </div>

    <div class="nav-list">
      {#each tabs as tab}
        <button
          class="nav-item"
          class:active={activeTab === tab.id}
          onclick={() => (activeTab = tab.id)}
          title={tab.label}
        >
          <span class="nav-icon {tab.icon}"></span>
          <span class="nav-label">{tab.label}</span>
        </button>
      {/each}
    </div>

    <ThemeToggle {theme} />
  </nav>

  <main class="content">
    <ActivePanel />
  </main>
</div>

<style>
  .devtools {
    display: grid;
    grid-template-columns: max-content 1fr;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    background: var(--color-glass);
    border-right: 1px solid var(--color-border);
    backdrop-filter: blur(7px);
    width: 150px;
    overflow-y: auto;
  }

  .nav-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    margin-bottom: var(--space-2);
  }

  .logo-text {
    font-weight: 700;
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    background: none;
    border: none;
    border-radius: var(--radius-lg);
    /* Use --color-text-secondary instead of muted+0.55 opacity. The previous
       0.55 * #999 effectively rendered at ~#555 luminance on dark — about
       2.5:1 contrast on #111, well below the WCAG AA threshold. */
    color: var(--color-text-secondary);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    transition: all var(--transition-fast);
  }

  .nav-item:hover {
    color: var(--color-text);
    background: var(--color-surface-active);
  }

  .nav-item.active {
    color: var(--color-text-accent);
    background: var(--color-surface-active);
  }

  .nav-icon {
    width: 18px;
    height: 18px;
    display: block;
  }

  /* Icon backgrounds as inline SVG data URIs for simplicity */
  .i-overview {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7' rx='1'/%3E%3Crect x='14' y='3' width='7' height='7' rx='1'/%3E%3Crect x='3' y='14' width='7' height='7' rx='1'/%3E%3Crect x='14' y='14' width='7' height='7' rx='1'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7' rx='1'/%3E%3Crect x='14' y='3' width='7' height='7' rx='1'/%3E%3Crect x='3' y='14' width='7' height='7' rx='1'/%3E%3Crect x='14' y='14' width='7' height='7' rx='1'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  .i-components {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  .i-routes {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M9 18l6-6-6-6'/%3E%3Cline x1='3' y1='12' x2='15' y2='12'/%3E%3Cpath d='M21 5v14'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M9 18l6-6-6-6'/%3E%3Cline x1='3' y1='12' x2='15' y2='12'/%3E%3Cpath d='M21 5v14'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  .i-assets {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Profiler icon (timer/stopwatch) */
  .i-profiler {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='12' cy='13' r='8'/%3E%3Cpath d='M12 9v4l2 2'/%3E%3Cpath d='M9 2h6'/%3E%3Cpath d='M12 2v3'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='12' cy='13' r='8'/%3E%3Cpath d='M12 9v4l2 2'/%3E%3Cpath d='M9 2h6'/%3E%3Cpath d='M12 2v3'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Reactive icon (connected nodes/graph) */
  .i-reactive {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='6' cy='6' r='3'/%3E%3Ccircle cx='18' cy='6' r='3'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='18' cy='18' r='3'/%3E%3Cpath d='M9 6h6M6 9v6M18 9v6M9 18h6'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='6' cy='6' r='3'/%3E%3Ccircle cx='18' cy='6' r='3'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='18' cy='18' r='3'/%3E%3Cpath d='M9 6h6M6 9v6M18 9v6M9 18h6'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Loads icon (download/data) */
  .i-loads {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='M8 11l4 4 4-4'/%3E%3Cpath d='M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='M8 11l4 4 4-4'/%3E%3Cpath d='M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Timeline icon (clock with list) */
  .i-timeline {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M3 12h4l3-9 4 18 3-9h4'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M3 12h4l3-9 4 18 3-9h4'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* API icon (terminal/code) */
  .i-api {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M7 8l-4 4 4 4'/%3E%3Cpath d='M17 8l4 4-4 4'/%3E%3Cline x1='14' y1='4' x2='10' y2='20'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M7 8l-4 4 4 4'/%3E%3Cpath d='M17 8l4 4-4 4'/%3E%3Cline x1='14' y1='4' x2='10' y2='20'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Errors icon (alert triangle) */
  .i-errors {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'/%3E%3Cline x1='12' y1='9' x2='12' y2='13'/%3E%3Cline x1='12' y1='17' x2='12.01' y2='17'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'/%3E%3Cline x1='12' y1='9' x2='12' y2='13'/%3E%3Cline x1='12' y1='17' x2='12.01' y2='17'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Inspect icon (eye) */
  .i-inspect {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Modules icon (box/package) */
  .i-modules {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'/%3E%3Cpath d='M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'/%3E%3Cpath d='M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* OG icon (share/globe) */
  .i-og {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3Cpath d='M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3Cpath d='M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  /* Build icon (bar chart) */
  .i-build {
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cline x1='18' y1='20' x2='18' y2='10'/%3E%3Cline x1='12' y1='20' x2='12' y2='4'/%3E%3Cline x1='6' y1='20' x2='6' y2='14'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cline x1='18' y1='20' x2='18' y2='10'/%3E%3Cline x1='12' y1='20' x2='12' y2='4'/%3E%3Cline x1='6' y1='20' x2='6' y2='14'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  .content {
    overflow: auto;
    padding: var(--space-4);
  }
</style>
