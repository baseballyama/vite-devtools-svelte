<script lang="ts">
  import type { Component } from 'svelte'
  import { onMount } from 'svelte'
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

  // Single source of truth for the panel registry: id, label, icon, group,
  // and the component to render. `group` controls the visual divider in the
  // sidebar — purely decorative grouping, but it makes the long flat nav list
  // scannable. Adding a panel only requires adding one entry here.
  type Group = 'inspect' | 'measure' | 'tools'
  type Tab = {
    id: string
    label: string
    icon: string
    group: Group
    component: Component
    hint?: string
  }
  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'i-overview', group: 'inspect', component: Overview, hint: 'Project info' },
    { id: 'components', label: 'Components', icon: 'i-components', group: 'inspect', component: Components, hint: 'Tree & relations' },
    { id: 'routes', label: 'Routes', icon: 'i-routes', group: 'inspect', component: Routes, hint: 'SvelteKit routes' },
    { id: 'assets', label: 'Assets', icon: 'i-assets', group: 'inspect', component: Assets, hint: 'Static files' },
    { id: 'modules', label: 'Modules', icon: 'i-modules', group: 'inspect', component: ModuleGraph, hint: 'Module graph' },

    { id: 'profiler', label: 'Render', icon: 'i-profiler', group: 'measure', component: RenderProfiler, hint: 'Render perf' },
    { id: 'reactive', label: 'Reactive', icon: 'i-reactive', group: 'measure', component: ReactiveGraph, hint: 'Effect graph' },
    { id: 'fps', label: 'FPS', icon: 'i-fps', group: 'measure', component: FpsMonitor, hint: 'Frame rate' },
    { id: 'loads', label: 'Loads', icon: 'i-loads', group: 'measure', component: LoadProfiler, hint: 'Load timings' },
    { id: 'timeline', label: 'Timeline', icon: 'i-timeline', group: 'measure', component: StateTimeline, hint: 'State changes' },
    { id: 'build', label: 'Build', icon: 'i-build', group: 'measure', component: BuildAnalysis, hint: 'Bundle stats' },

    { id: 'api', label: 'API', icon: 'i-api', group: 'tools', component: ApiPlayground, hint: 'Endpoint sandbox' },
    { id: 'errors', label: 'Errors', icon: 'i-errors', group: 'tools', component: ErrorDashboard, hint: 'HMR & runtime' },
    { id: 'inspect', label: 'Inspect', icon: 'i-inspect', group: 'tools', component: Inspect, hint: 'Element picker' },
    { id: 'og', label: 'OG', icon: 'i-og', group: 'tools', component: OGPreview, hint: 'Social previews' },
  ] as const satisfies readonly Tab[]

  type TabId = (typeof tabs)[number]['id']

  const groupLabels: Record<Group, string> = {
    inspect: 'Inspect',
    measure: 'Measure',
    tools: 'Tools',
  }

  let activeTab = $state<TabId>('overview')
  const activeMeta = $derived(tabs.find((t) => t.id === activeTab) ?? tabs[0])
  const ActivePanel = $derived(activeMeta.component)

  const groups = $derived.by(() => {
    const out: { group: Group; label: string; tabs: Tab[] }[] = []
    let current: { group: Group; label: string; tabs: Tab[] } | null = null
    for (const tab of tabs) {
      if (!current || current.group !== tab.group) {
        current = { group: tab.group, label: groupLabels[tab.group], tabs: [] }
        out.push(current)
      }
      current.tabs.push(tab)
    }
    return out
  })

  // Command palette ⌘K — quick switch between panels. Implemented inline
  // because spinning up another component for ~80 lines of UI doesn't justify
  // the indirection cost.
  let paletteOpen = $state(false)
  let paletteQuery = $state('')
  let paletteIndex = $state(0)

  const paletteResults = $derived.by(() => {
    if (!paletteQuery.trim()) return tabs.slice()
    const q = paletteQuery.toLowerCase()
    return tabs.filter(
      (t) => t.label.toLowerCase().includes(q) || (t.hint ?? '').toLowerCase().includes(q),
    )
  })

  function openPalette() {
    paletteOpen = true
    paletteQuery = ''
    paletteIndex = 0
  }

  function closePalette() {
    paletteOpen = false
  }

  function commitPalette(index: number = paletteIndex) {
    const pick = paletteResults[index]
    if (pick) {
      activeTab = pick.id
      closePalette()
    }
  }

  function onKeydown(e: KeyboardEvent) {
    const cmdK = (e.metaKey || e.ctrlKey) && e.key === 'k'
    if (cmdK) {
      e.preventDefault()
      paletteOpen ? closePalette() : openPalette()
      return
    }
    if (!paletteOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      paletteIndex = Math.min(paletteIndex + 1, paletteResults.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      paletteIndex = Math.max(paletteIndex - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commitPalette()
    }
  }

  // Reset palette selection whenever the search query changes. We only
  // *read* `paletteQuery` here so $effect tracks it; assigning to
  // `paletteIndex` does not loop because we never read paletteIndex inside
  // the effect.
  let _lastQuery = ''
  $effect(() => {
    if (paletteQuery !== _lastQuery) {
      _lastQuery = paletteQuery
      paletteIndex = 0
    }
  })

  // Lightweight FPS readout for the status bar — a nice "this is a precision
  // tool" detail. requestAnimationFrame loop, throttled to update the visible
  // number ~4× per second so it doesn't flicker.
  let fpsReadout = $state<number | null>(null)
  let fpsState = $state<'good' | 'fair' | 'poor'>('good')
  let nowTime = $state<string>('')

  onMount(() => {
    let frames = 0
    let lastSample = performance.now()
    let lastEmit = lastSample
    let raf = 0
    const tick = (t: number) => {
      frames++
      if (t - lastEmit >= 250) {
        const elapsed = t - lastSample
        if (elapsed > 0) {
          const fps = Math.round((frames * 1000) / elapsed)
          fpsReadout = fps
          fpsState = fps >= 55 ? 'good' : fps >= 30 ? 'fair' : 'poor'
        }
        frames = 0
        lastSample = t
        lastEmit = t
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const updateClock = () => {
      const d = new Date()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      nowTime = `${hh}:${mm}:${ss}`
    }
    updateClock()
    const clockId = setInterval(updateClock, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(clockId)
    }
  })

  const theme = createThemeStore()
</script>

<svelte:window on:keydown={onKeydown} />

<div class="devtools">
  <aside class="sidebar" aria-label="Panel navigation">
    <a class="brand" href="#overview" onclick={(e) => { e.preventDefault(); activeTab = 'overview' }}>
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="22" height="22">
          <path
            d="M85.8 11.7c-7.3-4.2-16.7-1.7-21 5.6L41.2 59l-8.6-4.8c-7.3-4.2-16.7-1.7-21 5.6-4.2 7.3-1.7 16.7 5.6 21l19.8 11.4c7.3 4.2 16.7 1.7 21-5.6L91.4 32.7c4.2-7.3 1.7-16.7-5.6-21z"
            fill="url(#brand-grad)"
          />
          <defs>
            <linearGradient id="brand-grad" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#ff7a4d" />
              <stop offset="1" stop-color="#ff3e00" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      <span class="brand-text">
        <span class="brand-line">svelte</span>
        <span class="brand-sub">devtools<span class="brand-dot">·</span><span class="brand-italic">vite</span></span>
      </span>
    </a>

    <button
      type="button"
      class="cmdk-trigger"
      onclick={openPalette}
      aria-label="Open command palette"
    >
      <span class="cmdk-icon i-search" aria-hidden="true"></span>
      <span class="cmdk-label">Quick switch</span>
      <span class="cmdk-kbd">
        <kbd>⌘</kbd><kbd>K</kbd>
      </span>
    </button>

    <nav class="nav-list">
      {#each groups as g (g.group)}
        <div class="nav-group">
          <span class="nav-group-label uppercase-eyebrow">{g.label}</span>
          <div class="nav-group-items">
            {#each g.tabs as tab (tab.id)}
              <button
                class="nav-item"
                class:active={activeTab === tab.id}
                onclick={() => (activeTab = tab.id)}
                title={tab.hint ?? tab.label}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <span class="nav-rail" aria-hidden="true"></span>
                <span class="nav-icon {tab.icon}" aria-hidden="true"></span>
                <span class="nav-label">{tab.label}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <ThemeToggle {theme} />
      <div class="version-stamp" aria-hidden="true">
        <span class="version-label uppercase-eyebrow">build</span>
        <span class="version-num font-mono">v0.0.1 · α</span>
      </div>
    </div>
  </aside>

  <main class="content">
    <header class="topbar">
      <div class="crumb">
        <span class="crumb-section uppercase-eyebrow">{groupLabels[activeMeta.group]}</span>
        <span class="crumb-sep" aria-hidden="true">›</span>
        <h1 class="crumb-title">
          {activeMeta.label}
        </h1>
        {#if activeMeta.hint}
          <span class="crumb-hint">— {activeMeta.hint}</span>
        {/if}
      </div>
      <div class="topbar-actions">
        <span class="topbar-meter" title="Live frame rate">
          <span class="meter-dot meter-{fpsState}" aria-hidden="true"></span>
          <span class="meter-label">{fpsReadout ?? '—'}</span>
          <span class="meter-unit">fps</span>
        </span>
      </div>
    </header>

    {#key activeTab}
      <section class="panel-stage" aria-label={activeMeta.label}>
        <ActivePanel />
      </section>
    {/key}

    <footer class="statusbar" aria-label="Status">
      <div class="status-cluster">
        <span class="status-pip status-good" aria-hidden="true"></span>
        <span class="status-text">connected</span>
        <span class="status-sep" aria-hidden="true">·</span>
        <span class="status-text font-mono">vite-devtools-svelte</span>
      </div>
      <div class="status-cluster">
        <span class="status-text font-mono">{fpsReadout ?? '—'} fps</span>
        <span class="status-sep" aria-hidden="true">·</span>
        <span class="status-text font-mono">{nowTime || '--:--:--'}</span>
      </div>
    </footer>
  </main>
</div>

{#if paletteOpen}
  <div
    class="palette-scrim"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closePalette()
    }}
  >
    <div
      class="palette"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Quick switch panels"
    >
      <div class="palette-input-row">
        <span class="palette-input-icon i-search" aria-hidden="true"></span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          class="palette-input"
          placeholder="Switch to panel…"
          bind:value={paletteQuery}
        />
        <kbd class="palette-esc">esc</kbd>
      </div>
      <div class="palette-list" role="listbox">
        {#each paletteResults as t, i (t.id)}
          <button
            class="palette-item"
            class:active={i === paletteIndex}
            onmouseenter={() => (paletteIndex = i)}
            onclick={() => commitPalette(i)}
            role="option"
            aria-selected={i === paletteIndex}
          >
            <span class="palette-icon {t.icon}" aria-hidden="true"></span>
            <span class="palette-label">{t.label}</span>
            {#if t.hint}<span class="palette-hint">{t.hint}</span>{/if}
            <span class="palette-group uppercase-eyebrow">{groupLabels[t.group]}</span>
          </button>
        {:else}
          <div class="palette-empty">No matching panels.</div>
        {/each}
      </div>
      <div class="palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .devtools {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  /* ===== Sidebar ===== */
  .sidebar {
    display: flex;
    flex-direction: column;
    padding: var(--space-4) var(--space-3) var(--space-3);
    background: var(--color-glass);
    border-right: 1px solid var(--color-border);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }

  /* Hairline accent at the very edge of the sidebar — barely-there but
   * unmistakable when you look for it. */
  .sidebar::after {
    content: '';
    position: absolute;
    inset: 12% auto 12% 0;
    width: 1px;
    background: linear-gradient(180deg, transparent, var(--color-accent-500) 50%, transparent);
    opacity: 0.35;
    pointer-events: none;
  }

  /* ===== Brand ===== */
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2-5, 10px);
    padding: var(--space-1) var(--space-1) var(--space-3);
    text-decoration: none;
    color: var(--color-text);
    cursor: pointer;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, rgba(255, 122, 77, 0.12), rgba(255, 62, 0, 0.06));
    box-shadow: var(--shadow-sm);
    flex-shrink: 0;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1;
    gap: 2px;
  }

  .brand-line {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 22px;
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text);
  }

  .brand-sub {
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .brand-dot {
    margin: 0 4px;
    color: var(--color-text-faint);
  }

  .brand-italic {
    font-family: var(--font-display);
    font-style: italic;
    text-transform: lowercase;
    letter-spacing: 0;
    font-size: 11px;
    color: var(--color-text-accent);
  }

  /* ===== ⌘K trigger ===== */
  .cmdk-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 7px var(--space-2);
    margin-bottom: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-xs);
    text-align: left;
    width: 100%;
    transition:
      border-color var(--transition-fast),
      color var(--transition-fast),
      background var(--transition-fast);
  }

  .cmdk-trigger:hover {
    border-color: var(--color-border-strong);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
  }

  .cmdk-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  .cmdk-label {
    flex: 1;
  }

  .cmdk-kbd {
    display: inline-flex;
    gap: 2px;
  }

  kbd {
    display: inline-block;
    padding: 1px 4px;
    background: var(--color-surface-tertiary);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.1;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  /* ===== Nav ===== */
  .nav-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    flex: 1;
  }

  .nav-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .nav-group-label {
    padding: 0 var(--space-2);
    margin-bottom: 2px;
  }

  .nav-group-items {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-2);
    background: none;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
  }

  .nav-item:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  /* The active-state rail — a subtle ember gradient fills the left edge. The
   * border-active treatment on the surface gives a focused, instrument-like
   * feel without resorting to heavy backgrounds. */
  .nav-rail {
    position: absolute;
    left: -3px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: var(--radius-full);
    background: var(--color-rail);
    opacity: 0;
    transform: scaleY(0.4);
    transform-origin: center;
    transition:
      opacity var(--transition-normal),
      transform var(--transition-slow);
  }

  .nav-item.active {
    color: var(--color-text);
    background: var(--color-surface-active);
  }

  .nav-item.active .nav-rail {
    opacity: 1;
    transform: scaleY(1);
  }

  .nav-item.active .nav-icon {
    color: var(--color-text-accent);
  }

  .nav-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    color: currentColor;
    background: currentColor;
  }

  .nav-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ===== Sidebar footer ===== */
  .sidebar-footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    margin-top: var(--space-2);
    border-top: 1px dashed var(--color-border);
  }

  .version-stamp {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px var(--space-1);
    color: var(--color-text-faint);
  }

  .version-label {
    font-size: 8.5px;
    color: var(--color-text-faint);
  }

  .version-num {
    font-size: 10px;
    color: var(--color-text-muted);
  }

  /* ===== Content area ===== */
  .content {
    display: grid;
    grid-template-rows: var(--topbar-height) 1fr var(--statusbar-height);
    overflow: hidden;
    background: transparent;
    min-width: 0;
  }

  /* ===== Top bar ===== */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-5);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .crumb {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .crumb-section {
    color: var(--color-text-muted);
    font-size: 9.5px;
  }

  .crumb-sep {
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    transform: translateY(-1px);
  }

  .crumb-title {
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 400;
    font-size: 22px;
    letter-spacing: var(--tracking-tighter);
    line-height: 1;
    color: var(--color-text);
    white-space: nowrap;
  }

  .crumb-hint {
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .topbar-meter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: 3px var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .meter-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--color-text-faint);
    box-shadow: 0 0 8px currentColor;
  }
  .meter-good {
    background: var(--color-success);
    color: var(--color-success);
  }
  .meter-fair {
    background: var(--color-warning);
    color: var(--color-warning);
  }
  .meter-poor {
    background: var(--color-error);
    color: var(--color-error);
  }

  .meter-label {
    color: var(--color-text);
    font-weight: 600;
    min-width: 18px;
    text-align: right;
  }

  .meter-unit {
    color: var(--color-text-faint);
    font-size: 10px;
  }

  /* ===== Panel stage ===== */
  .panel-stage {
    overflow: auto;
    padding: var(--space-5) var(--space-5) var(--space-3);
    animation: stageIn 0.4s var(--ease-out-expo);
  }

  @keyframes stageIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ===== Status bar ===== */
  .statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-5);
    border-top: 1px solid var(--color-border);
    background: var(--color-glass-strong);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: var(--color-text-faint);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
  }

  .status-cluster {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status-pip {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--color-success);
    box-shadow: 0 0 6px var(--color-success);
  }

  .status-text {
    color: var(--color-text-muted);
  }

  .status-sep {
    color: var(--color-text-faint);
  }

  /* ===== Command palette ===== */
  .palette-scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh var(--space-4) var(--space-4);
    animation: scrimIn 0.18s ease-out;
  }

  @keyframes scrimIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .palette {
    width: min(560px, 100%);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: paletteIn 0.28s var(--ease-out-expo);
  }

  @keyframes paletteIn {
    from {
      opacity: 0;
      transform: translateY(-12px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .palette-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .palette-input-icon {
    width: 16px;
    height: 16px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .palette-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    letter-spacing: var(--tracking-tight);
  }

  .palette-input::placeholder {
    color: var(--color-text-faint);
  }

  .palette-esc {
    margin-left: auto;
  }

  .palette-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
  }

  .palette-item.active {
    background: var(--color-surface-active);
    color: var(--color-text);
    box-shadow: inset 2px 0 0 var(--color-accent-500);
  }

  .palette-icon {
    width: 14px;
    height: 14px;
    color: currentColor;
    background: currentColor;
    flex-shrink: 0;
  }

  .palette-item.active .palette-icon {
    color: var(--color-text-accent);
  }

  .palette-label {
    font-weight: 500;
  }

  .palette-hint {
    color: var(--color-text-faint);
    font-style: italic;
    font-size: var(--text-xs);
    margin-left: var(--space-1);
    flex: 1;
  }

  .palette-group {
    color: var(--color-text-faint);
    font-size: 9px;
  }

  .palette-empty {
    padding: var(--space-5);
    color: var(--color-text-faint);
    text-align: center;
    font-style: italic;
  }

  .palette-foot {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--color-border);
    color: var(--color-text-faint);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
  }

  .palette-foot span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* ===== Mask icons ===== */
  .nav-icon,
  .palette-icon,
  .cmdk-icon,
  .palette-input-icon {
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }

  .i-overview {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='3' y='14' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='14' width='7' height='7' rx='1.5'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='3' y='14' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='14' width='7' height='7' rx='1.5'/%3E%3C/svg%3E");
  }
  .i-components {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='4' y='4' width='6' height='6' rx='1'/%3E%3Crect x='14' y='4' width='6' height='6' rx='1'/%3E%3Crect x='9' y='14' width='6' height='6' rx='1'/%3E%3Cpath d='M7 10v2h10v-2'/%3E%3Cpath d='M12 12v2'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='4' y='4' width='6' height='6' rx='1'/%3E%3Crect x='14' y='4' width='6' height='6' rx='1'/%3E%3Crect x='9' y='14' width='6' height='6' rx='1'/%3E%3Cpath d='M7 10v2h10v-2'/%3E%3Cpath d='M12 12v2'/%3E%3C/svg%3E");
  }
  .i-routes {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 17 9 8h6l5 9'/%3E%3Ccircle cx='4' cy='17' r='2'/%3E%3Ccircle cx='20' cy='17' r='2'/%3E%3Cpath d='M9 8 V5'/%3E%3Cpath d='M15 8 V5'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 17 9 8h6l5 9'/%3E%3Ccircle cx='4' cy='17' r='2'/%3E%3Ccircle cx='20' cy='17' r='2'/%3E%3Cpath d='M9 8 V5'/%3E%3Cpath d='M15 8 V5'/%3E%3C/svg%3E");
  }
  .i-assets {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='14' rx='2'/%3E%3Ccircle cx='9' cy='11' r='1.5'/%3E%3Cpath d='M21 16 16 11l-7 7'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='14' rx='2'/%3E%3Ccircle cx='9' cy='11' r='1.5'/%3E%3Cpath d='M21 16 16 11l-7 7'/%3E%3C/svg%3E");
  }
  .i-profiler {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='13' r='8'/%3E%3Cpath d='M12 9v4l2.5 2.5'/%3E%3Cpath d='M9 2h6'/%3E%3Cpath d='M12 2v3'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='13' r='8'/%3E%3Cpath d='M12 9v4l2.5 2.5'/%3E%3Cpath d='M9 2h6'/%3E%3Cpath d='M12 2v3'/%3E%3C/svg%3E");
  }
  .i-fps {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 18h2l2-6 3 10 3-14 3 10 2-6h3'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 18h2l2-6 3 10 3-14 3 10 2-6h3'/%3E%3C/svg%3E");
  }
  .i-reactive {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='2.5'/%3E%3Ccircle cx='18' cy='6' r='2.5'/%3E%3Ccircle cx='12' cy='18' r='2.5'/%3E%3Cpath d='M8.5 6h7M7 8 11 16M17 8 13 16'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='2.5'/%3E%3Ccircle cx='18' cy='6' r='2.5'/%3E%3Ccircle cx='12' cy='18' r='2.5'/%3E%3Cpath d='M8.5 6h7M7 8 11 16M17 8 13 16'/%3E%3C/svg%3E");
  }
  .i-loads {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='M7 10l5 5 5-5'/%3E%3Cpath d='M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='M7 10l5 5 5-5'/%3E%3Cpath d='M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2'/%3E%3C/svg%3E");
  }
  .i-timeline {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12h4l3-9 4 18 3-9h4'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12h4l3-9 4 18 3-9h4'/%3E%3C/svg%3E");
  }
  .i-api {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 8 4 12l4 4'/%3E%3Cpath d='M16 8l4 4-4 4'/%3E%3Cpath d='M14 4 10 20'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 8 4 12l4 4'/%3E%3Cpath d='M16 8l4 4-4 4'/%3E%3Cpath d='M14 4 10 20'/%3E%3C/svg%3E");
  }
  .i-errors {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/%3E%3Cpath d='M12 9v4'/%3E%3Cpath d='M12 17h.01'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/%3E%3Cpath d='M12 9v4'/%3E%3Cpath d='M12 17h.01'/%3E%3C/svg%3E");
  }
  .i-inspect {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M11 3a8 8 0 1 0 4.7 14.5'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3Ccircle cx='11' cy='11' r='3'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M11 3a8 8 0 1 0 4.7 14.5'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3Ccircle cx='11' cy='11' r='3'/%3E%3C/svg%3E");
  }
  .i-modules {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/%3E%3Cpath d='M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/%3E%3Cpath d='M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12'/%3E%3C/svg%3E");
  }
  .i-og {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='14' rx='2'/%3E%3Cpath d='M3 9h18'/%3E%3Cpath d='M8 13h8M8 16h5'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='14' rx='2'/%3E%3Cpath d='M3 9h18'/%3E%3Cpath d='M8 13h8M8 16h5'/%3E%3C/svg%3E");
  }
  .i-build {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='4' y='12' width='4' height='9' rx='1'/%3E%3Crect x='10' y='4' width='4' height='17' rx='1'/%3E%3Crect x='16' y='8' width='4' height='13' rx='1'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='4' y='12' width='4' height='9' rx='1'/%3E%3Crect x='10' y='4' width='4' height='17' rx='1'/%3E%3Crect x='16' y='8' width='4' height='13' rx='1'/%3E%3C/svg%3E");
  }
  .i-search {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E");
  }
</style>
