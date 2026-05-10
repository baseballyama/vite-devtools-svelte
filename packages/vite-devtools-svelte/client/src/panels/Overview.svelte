<script lang="ts">
  import { getProject } from '../lib/rpc.js'
  import type { ProjectInfo } from '../lib/types.js'
  import Card from '../components/Card.svelte'
  import PanelContainer from '../components/PanelContainer.svelte'
  import SearchInput from '../components/SearchInput.svelte'

  let project = $state<ProjectInfo | null>(null)
  let error = $state<string | null>(null)
  let loading = $state(true)
  let depFilter = $state('')

  async function load() {
    try {
      loading = true
      project = await getProject()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load project info'
    } finally {
      loading = false
    }
  }

  load()

  type Dep = { name: string; version: string }

  function formatDeps(deps: Record<string, string>): Dep[] {
    return Object.entries(deps)
      .map(([name, version]) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function applyFilter(deps: Dep[]): Dep[] {
    if (!depFilter) return deps
    const q = depFilter.toLowerCase()
    return deps.filter((d) => d.name.toLowerCase().includes(q))
  }

  const dependencies = $derived(project ? applyFilter(formatDeps(project.dependencies)) : [])
  const devDependencies = $derived(project ? applyFilter(formatDeps(project.devDependencies)) : [])
  const totalDepCount = $derived(
    project
      ? Object.keys(project.dependencies).length + Object.keys(project.devDependencies).length
      : 0,
  )
</script>

<PanelContainer summary="The signature of your project — versions, framework stack, and the libraries it leans on.">
  {#if loading}
    <div class="hero hero-skeleton">
      <span class="skel skel-eyebrow"></span>
      <span class="skel skel-title"></span>
      <span class="skel skel-meta"></span>
    </div>
  {:else if error}
    <div class="error-state">
      <p class="error-eyebrow">RPC offline</p>
      <p class="error-message">{error}</p>
      <p class="error-hint">
        This panel needs the dev-server plugin attached. When you're running the playground or
        a project that wires <span class="font-mono">vite-devtools-svelte</span> into Vite,
        the data will populate live.
      </p>
    </div>
  {:else if project}
    <!-- Hero strip — editorial display of the project name with the framework
         stack laid out in a horizontal rule of versions. Reads instantly. -->
    <div class="hero">
      <div class="hero-left">
        <p class="hero-eyebrow">project</p>
        <h1 class="hero-title">
          <span class="hero-name">{project.name}</span>
        </h1>
        <p class="hero-meta">
          <span class="hero-tag">v{project.version}</span>
          <span class="sep">·</span>
          <span>{totalDepCount} dependencies</span>
        </p>
      </div>

      <dl class="hero-stack">
        <div class="stack-item">
          <dt>Svelte</dt>
          <dd class="font-mono">{project.svelteVersion}</dd>
        </div>
        <span class="stack-sep" aria-hidden="true"></span>
        <div class="stack-item">
          <dt>SvelteKit</dt>
          <dd class="font-mono">{project.sveltekitVersion}</dd>
        </div>
        <span class="stack-sep" aria-hidden="true"></span>
        <div class="stack-item">
          <dt>Vite</dt>
          <dd class="font-mono">{project.viteVersion}</dd>
        </div>
      </dl>
    </div>

    <div class="dep-grid">
      <Card
        eyebrow="Runtime"
        title="Dependencies · {Object.keys(project.dependencies).length}"
      >
        {#snippet actions()}
          <div class="filter-slot">
            <SearchInput bind:value={depFilter} placeholder="Filter…" width="180px" />
          </div>
        {/snippet}
        <ul class="dep-table" aria-label="Dependencies">
          {#each dependencies as dep (dep.name)}
            <li class="dep-row">
              <span class="dep-name">{dep.name}</span>
              <span class="dep-version font-mono">{dep.version}</span>
            </li>
          {:else}
            <li class="dep-empty">No dependencies match.</li>
          {/each}
        </ul>
      </Card>

      <Card
        eyebrow="Dev"
        title="DevDependencies · {Object.keys(project.devDependencies).length}"
      >
        <ul class="dep-table" aria-label="Dev dependencies">
          {#each devDependencies as dep (dep.name)}
            <li class="dep-row">
              <span class="dep-name">{dep.name}</span>
              <span class="dep-version font-mono">{dep.version}</span>
            </li>
          {:else}
            <li class="dep-empty">No dev-dependencies match.</li>
          {/each}
        </ul>
      </Card>
    </div>
  {/if}
</PanelContainer>

<style>
  /* ===== Hero ===== */
  .hero {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-2xl);
    background:
      radial-gradient(80% 100% at 0% 100%, rgba(255, 62, 0, 0.08), transparent 60%),
      linear-gradient(180deg, var(--color-surface), var(--color-surface-secondary));
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-md);
    position: relative;
    overflow: hidden;
  }

  .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px);
    background-size: 14px 14px;
    background-position: 0 0;
    opacity: 0.5;
    mask-image: linear-gradient(135deg, black, transparent 70%);
    -webkit-mask-image: linear-gradient(135deg, black, transparent 70%);
  }

  .hero-left {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    position: relative;
  }

  .hero-eyebrow {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-faint);
    line-height: 1;
    font-weight: 500;
  }

  .hero-title {
    margin: 0;
    line-height: 1;
  }

  .hero-name {
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 400;
    font-size: var(--text-display);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text);
    background: linear-gradient(180deg, var(--color-text), color-mix(in srgb, var(--color-text) 75%, var(--color-accent-400)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .hero-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
  }

  .hero-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: var(--color-surface-active);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--color-text-secondary);
  }

  .sep {
    color: var(--color-text-faint);
  }

  /* Stack ribbon — Svelte / SvelteKit / Vite, separated by hairline rules.
   * Reads like an instrument readout. */
  .hero-stack {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  .stack-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: center;
    min-width: 70px;
  }

  .stack-item dt {
    font-size: 9.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-faint);
  }

  .stack-item dd {
    font-size: var(--text-base);
    color: var(--color-text);
    font-weight: 500;
  }

  .stack-sep {
    width: 1px;
    height: 24px;
    background: var(--color-border);
  }

  /* ===== Hero loading skeleton ===== */
  .hero-skeleton {
    grid-template-columns: 1fr;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .skel {
    display: block;
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 0%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 100%
    );
    background-size: 200% 100%;
    border-radius: var(--radius-md);
    animation: skel-shimmer 1.6s infinite;
  }

  .skel-eyebrow {
    width: 80px;
    height: 10px;
  }
  .skel-title {
    width: 280px;
    height: 44px;
  }
  .skel-meta {
    width: 180px;
    height: 12px;
  }

  @keyframes skel-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* ===== Error / empty state ===== */
  .error-state {
    padding: var(--space-6);
    background:
      radial-gradient(60% 80% at 50% 0%, rgba(248, 113, 113, 0.06), transparent 70%),
      var(--color-surface);
    border: 1px dashed var(--color-error-border);
    border-radius: var(--radius-xl);
    text-align: center;
  }

  .error-eyebrow {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-error);
    margin-bottom: var(--space-2);
    font-weight: 500;
  }

  .error-message {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-xl);
    color: var(--color-text);
    margin-bottom: var(--space-2);
    letter-spacing: var(--tracking-tight);
  }

  .error-hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    max-width: 480px;
    margin: 0 auto;
    line-height: 1.5;
  }

  /* ===== Dep tables ===== */
  .dep-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    align-items: start;
  }

  @media (max-width: 1080px) {
    .dep-grid {
      grid-template-columns: 1fr;
    }
  }

  .filter-slot {
    display: flex;
    align-items: center;
  }

  .dep-table {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 340px;
    overflow-y: auto;
  }

  .dep-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px dashed var(--color-border);
    font-size: var(--text-sm);
    transition: color var(--transition-fast);
  }

  .dep-row:hover {
    color: var(--color-text-accent);
  }

  .dep-row:last-child {
    border-bottom: none;
  }
  .dep-name {
    color: var(--color-text);
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
  }
  .dep-version {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .dep-empty {
    color: var(--color-text-faint);
    font-style: italic;
    padding: var(--space-3) 0;
    text-align: center;
  }
</style>
