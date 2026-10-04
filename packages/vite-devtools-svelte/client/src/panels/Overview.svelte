<script lang="ts">
  import {
    getProject,
    getRoutes,
    getAssets,
    getModuleGraph,
    getLiveComponents,
    getCompilerWarnings,
    getRuntimeErrors,
  } from '../lib/rpc.js'
  import type { ProjectInfo } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { router } from '../lib/router.svelte.js'
  import { matcher } from '../lib/match.js'
  import { formatBytes } from '../lib/format.js'
  import type { PanelId } from '../lib/panels.js'
  import type { IconName } from '../lib/icons.js'
  import Panel from '../components/Panel.svelte'
  import Icon from '../components/Icon.svelte'
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Highlight from '../components/Highlight.svelte'

  const project = resource<ProjectInfo | null>(getProject, { initial: null })

  // Cheap, in-memory or directory-scan stats only — the overview is the
  // landing page and must not trigger whole-project static analysis.
  const stats = resource(
    async () => {
      const settle = <T,>(p: Promise<T>) => p.then((v) => v, () => null)
      const [routes, assets, modules, live, warnings, errors] = await Promise.all([
        settle(getRoutes()),
        settle(getAssets()),
        settle(getModuleGraph()),
        settle(getLiveComponents()),
        settle(getCompilerWarnings()),
        settle(getRuntimeErrors()),
      ])
      return {
        routes: routes?.length ?? null,
        pages: routes?.filter((r) => r.hasPage).length ?? null,
        endpoints: routes?.filter((r) => r.hasEndpoint).length ?? null,
        assets: assets?.length ?? null,
        assetBytes: assets?.reduce((s, a) => s + a.size, 0) ?? null,
        modules: modules?.modules.length ?? null,
        cycles: modules?.cycles.length ?? null,
        live: live?.length ?? null,
        liveFiles: live ? new Set(live.map((c) => c.file)).size : null,
        warnings: warnings?.length ?? null,
        errors: errors?.length ?? null,
      }
    },
    { initial: null },
  )

  let depQuery = $state('')
  let depKind = $state<'all' | 'dependencies' | 'devDependencies'>('all')

  const deps = $derived.by(() => {
    const p = project.data
    if (!p) return []
    const out: { name: string; version: string; dev: boolean }[] = []
    if (depKind !== 'devDependencies')
      for (const [name, version] of Object.entries(p.dependencies)) out.push({ name, version, dev: false })
    if (depKind !== 'dependencies')
      for (const [name, version] of Object.entries(p.devDependencies)) out.push({ name, version, dev: true })
    const m = matcher(depQuery)
    return (m ? out.filter((d) => m(d.name, d.version)) : out).sort((a, b) => a.name.localeCompare(b.name))
  })

  interface Tile {
    panel: PanelId
    icon: IconName
    label: string
    value: string
    sub?: string
    tone?: 'red' | 'yellow'
  }

  const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString())

  const tiles = $derived.by<Tile[]>(() => {
    const s = stats.data
    return [
      { panel: 'routes', icon: 'routes', label: 'Routes', value: n(s?.routes), sub: s ? `${n(s.pages)} pages · ${n(s.endpoints)} endpoints` : undefined },
      { panel: 'components', icon: 'components', label: 'Mounted components', value: n(s?.live), sub: s?.liveFiles != null ? `from ${n(s.liveFiles)} files` : undefined },
      { panel: 'modules', icon: 'modules', label: 'Modules', value: n(s?.modules), sub: s?.cycles ? `${n(s.cycles)} circular` : 'no cycles', tone: s?.cycles ? 'yellow' : undefined },
      { panel: 'assets', icon: 'assets', label: 'Static assets', value: n(s?.assets), sub: s?.assetBytes != null ? formatBytes(s.assetBytes) : undefined },
      {
        panel: 'errors',
        icon: 'errors',
        label: 'Problems',
        value: n(s && s.warnings != null && s.errors != null ? s.warnings + s.errors : null),
        sub: s ? `${n(s.errors)} errors · ${n(s.warnings)} warnings` : undefined,
        tone: s?.errors ? 'red' : s?.warnings ? 'yellow' : undefined,
      },
    ]
  })
</script>

<Panel title="Overview" scroll>
  {#snippet actions()}
    <Button icon="refresh" variant="ghost" label="Refresh" onclick={() => (project.refresh(), stats.refresh())} />
  {/snippet}

  {#if project.loading}
    <div class="wrap"><div class="skeleton"></div></div>
  {:else if project.error || !project.data}
    <EmptyState icon="errors" tone="error" title="Dev server not reachable">
      <p class="mono">{project.error}</p>
      <p>This panel needs a running Vite dev server with <code>vite-devtools-svelte</code> installed.</p>
      <Button icon="refresh" onclick={() => project.refresh()}>Retry</Button>
    </EmptyState>
  {:else}
    {@const p = project.data}
    <div class="wrap">
      <header class="hero">
        <div>
          <p class="eyebrow">Project</p>
          <h2 class="name">{p.name || 'Untitled project'}</h2>
          {#if p.version}<p class="faint mono">v{p.version}</p>{/if}
        </div>
        <dl class="stack">
          <div><dt>Svelte</dt><dd class="mono">{p.svelteVersion || '—'}</dd></div>
          <div><dt>SvelteKit</dt><dd class="mono">{p.sveltekitVersion || '—'}</dd></div>
          <div><dt>Vite</dt><dd class="mono">{p.viteVersion || '—'}</dd></div>
        </dl>
      </header>

      <div class="tiles">
        {#each tiles as t (t.panel)}
          <button class="tile" onclick={() => router.go(t.panel)}>
            <span class="tile-head">
              <Icon name={t.icon} size={14} />
              {t.label}
              <span class="go"><Icon name="chevron" size={12} /></span>
            </span>
            <span class="tile-value num" class:red={t.tone === 'red'} class:yellow={t.tone === 'yellow'}>{t.value}</span>
            <span class="tile-sub">{t.sub ?? ' '}</span>
          </button>
        {/each}
      </div>

      <section class="deps" aria-labelledby="deps-title">
        <div class="deps-head">
          <h3 id="deps-title" class="h3">Dependencies</h3>
          <Segmented
            label="Dependency kind"
            bind:value={depKind}
            options={[
              { value: 'all', label: 'All', count: Object.keys(p.dependencies).length + Object.keys(p.devDependencies).length },
              { value: 'dependencies', label: 'Runtime', count: Object.keys(p.dependencies).length },
              { value: 'devDependencies', label: 'Dev', count: Object.keys(p.devDependencies).length },
            ]}
          />
          <SearchField bind:value={depQuery} placeholder="Filter packages…" count={deps.length} />
        </div>
        <ul class="dep-list" aria-label="Dependencies">
          {#each deps as d (d.name + d.dev)}
            <li class="dep">
              <span class="dep-name truncate"><Highlight text={d.name} query={depQuery} /></span>
              {#if d.dev}<Badge>dev</Badge>{/if}
              <span class="dep-ver mono">{d.version}</span>
            </li>
          {:else}
            <li class="dep faint">No packages match.</li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</Panel>

<style>
  .wrap {
    max-width: 1080px;
    padding: 20px 20px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .skeleton {
    height: 120px;
    border-radius: var(--radius-lg);
    background: linear-gradient(90deg, var(--bg-subtle), var(--bg-active), var(--bg-subtle));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
  .eyebrow {
    margin: 0 0 4px;
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }
  .name {
    margin: 0;
    font-size: var(--fs-2xl);
    font-weight: 650;
    letter-spacing: -0.025em;
    line-height: 1.1;
  }
  .hero p {
    margin: 4px 0 0;
  }
  .stack {
    display: flex;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .stack div {
    padding: 8px 16px;
    border-left: 1px solid var(--border);
  }
  .stack div:first-child {
    border-left: 0;
  }
  .stack dt {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .stack dd {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-subtle);
    text-align: left;
    transition:
      border-color var(--dur-fast) var(--ease),
      background var(--dur-fast) var(--ease);
  }
  .tile:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  .tile-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
  }
  .go {
    margin-left: auto;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }
  .tile:hover .go,
  .tile:focus-visible .go {
    opacity: 1;
  }
  .tile-value {
    font-size: var(--fs-xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .tile-value.red {
    color: var(--red);
  }
  .tile-value.yellow {
    color: var(--yellow);
  }
  .tile-sub {
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .deps {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .deps-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
  }
  .h3 {
    margin: 0 auto 0 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .dep-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    columns: 2 360px;
    column-gap: 0;
  }
  .dep {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 14px;
    font-size: var(--fs-sm);
    break-inside: avoid;
  }
  .dep:hover {
    background: var(--bg-hover);
  }
  .dep-name {
    flex: 1;
  }
  .dep-ver {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
</style>
