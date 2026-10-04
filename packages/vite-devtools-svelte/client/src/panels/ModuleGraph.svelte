<script lang="ts">
  import { getModuleGraph, openInEditor } from '../lib/rpc.js'
  import type { ModuleGraphData, ModuleNode } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { matcher } from '../lib/match.js'
  import { basename, formatBytes } from '../lib/format.js'
  import Panel from '../components/Panel.svelte'
  import SplitView from '../components/SplitView.svelte'
  import DataTable, { type Column, type SortState } from '../components/DataTable.svelte'
  import Inspector from '../components/Inspector.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import Button from '../components/Button.svelte'
  import Badge, { type Tone } from '../components/Badge.svelte'
  import Icon from '../components/Icon.svelte'
  import Highlight from '../components/Highlight.svelte'
  import EmptyState from '../components/EmptyState.svelte'

  const graph = resource<ModuleGraphData>(getModuleGraph, { initial: { modules: [], cycles: [] } })

  type TypeFilter = 'all' | ModuleNode['type']
  let query = $state('')
  let type = $state<TypeFilter>('all')
  let cyclicOnly = $state(false)
  let sort = $state<SortState | null>({ id: 'size', desc: true })
  let selected = $state<string | null>(null)

  const byId = $derived(new Map(graph.data.modules.map((m) => [m.id, m])))

  const typeCounts = $derived.by(() => {
    const c: Record<string, number> = {}
    for (const m of graph.data.modules) c[m.type] = (c[m.type] ?? 0) + 1
    return c
  })

  const typeOptions = $derived([
    { value: 'all' as TypeFilter, label: 'All', count: graph.data.modules.length },
    ...(['svelte', 'ts', 'js', 'css', 'other'] as const)
      .filter((t) => typeCounts[t])
      .map((t) => ({ value: t as TypeFilter, label: t === 'svelte' ? 'Svelte' : t.toUpperCase(), count: typeCounts[t] })),
  ])

  const rows = $derived.by(() => {
    const m = matcher(query)
    return graph.data.modules.filter(
      (mod) => (type === 'all' || mod.type === type) && (!cyclicOnly || mod.isCyclic) && (!m || m(mod.id)),
    )
  })

  const maxSize = $derived(graph.data.modules.reduce((m, x) => Math.max(m, x.size ?? 0), 1))
  const current = $derived(selected ? (byId.get(selected) ?? null) : null)
  const currentCycles = $derived(current ? graph.data.cycles.filter((c) => c.includes(current.id)) : [])

  const tones: Record<ModuleNode['type'], Tone> = { svelte: 'accent', ts: 'blue', js: 'yellow', css: 'purple', other: 'neutral' }

  const columns: Column<ModuleNode>[] = [
    { id: 'id', label: 'Module', width: 'minmax(0, 1fr)', sort: (a, b) => a.id.localeCompare(b.id) },
    { id: 'imports', label: 'Imports', width: '64px', align: 'end', descFirst: true, minWidth: 560, sort: (a, b) => a.imports.length - b.imports.length },
    { id: 'importers', label: 'Importers', width: '72px', align: 'end', descFirst: true, sort: (a, b) => a.importedBy.length - b.importedBy.length },
    { id: 'size', label: 'Size', width: '132px', align: 'end', descFirst: true, sort: (a, b) => (a.size ?? 0) - (b.size ?? 0) },
  ]

  function select(id: string) {
    if (!byId.has(id)) return
    // Make sure the target is visible under the current filters.
    if (!rows.some((m) => m.id === id)) {
      query = ''
      type = 'all'
      cyclicOnly = false
    }
    selected = id
  }

  function open(m: ModuleNode) {
    openInEditor(m.file).catch(() => {})
  }
</script>

<Panel title="Modules" count={graph.data.modules.length}>
  {#snippet toolbar()}
    <Segmented label="Module type" bind:value={type} options={typeOptions} />
    <SearchField bind:value={query} placeholder="Filter modules…" count={rows.length} />
    {#if graph.data.cycles.length}
      <Button icon="cycle" pressed={cyclicOnly} onclick={() => (cyclicOnly = !cyclicOnly)}>
        {graph.data.cycles.length} circular
      </Button>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button icon="refresh" variant="ghost" label="Refresh module graph" disabled={graph.busy} onclick={() => graph.refresh()} />
  {/snippet}

  <SplitView id="modules" open={!!current}>
    <DataTable items={rows} {columns} getKey={(m) => m.id} bind:sort bind:selected label="Modules" onactivate={open}>
      {#snippet row(m, { visible })}
        <span class="mod">
          <Badge tone={tones[m.type]}>{m.type}</Badge>
          <span class="truncate mono id"><Highlight text={m.id} {query} /></span>
          {#if m.isCyclic}<span class="cyc" title="Part of a circular import"><Icon name="cycle" size={12} /></span>{/if}
        </span>
        {#if visible.has('imports')}<span class="end num muted">{m.imports.length || ''}</span>{/if}
        <span class="end num muted">{m.importedBy.length || ''}</span>
        <span class="size end">
          {#if m.size}<span class="bar" style:width="{Math.max(2, (m.size / maxSize) * 56)}px"></span>{/if}
          <span class="num">{m.size ? formatBytes(m.size) : '—'}</span>
        </span>
      {/snippet}
      {#snippet empty()}
        {#if graph.loading}
          <EmptyState title="Reading module graph…" />
        {:else if graph.error}
          <EmptyState icon="errors" tone="error" title="Could not read module graph"><p class="mono">{graph.error}</p></EmptyState>
        {:else}
          <EmptyState icon="modules" title={graph.data.modules.length ? 'No modules match' : 'No modules transformed yet'}>
            {#if !graph.data.modules.length}<p>Open the app so Vite transforms its modules, then refresh.</p>{/if}
          </EmptyState>
        {/if}
      {/snippet}
    </DataTable>
    {#snippet aside()}
      {#if current}
        <Inspector title={basename(current.id)} subtitle={current.id} onclose={() => (selected = null)}>
          {#snippet badges()}
            <Badge tone={tones[current.type]}>{current.type}</Badge>
            {#if current.size}<Badge>{formatBytes(current.size)}</Badge>{/if}
            {#if current.isCyclic}<Badge tone="yellow">circular</Badge>{/if}
          {/snippet}
          {#snippet actions()}
            <Button icon="editor" onclick={() => open(current)}>Open in editor</Button>
          {/snippet}
          {#each currentCycles as cycle, i (i)}
            <h3 class="section-title"><Icon name="cycle" size={12} /> Cycle {i + 1}</h3>
            <ol class="cycle">
              {#each cycle as id, j (j)}
                <li><button class:me={id === current.id} onclick={() => select(id)}>{basename(id)}</button></li>
              {/each}
            </ol>
          {/each}
          {@render deps('Imports', current.imports)}
          {@render deps('Imported by', current.importedBy)}
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

{#snippet deps(title: string, ids: string[])}
  <h3 class="section-title">{title} <span class="num">{ids.length}</span></h3>
  {#if ids.length}
    <ul class="link-list">
      {#each ids.slice(0, 500) as id (id)}
        {@const m = byId.get(id)}
        <li>
          <button onclick={() => select(id)} disabled={!m} title={id}>
            {#if m}<Badge tone={tones[m.type]}>{m.type}</Badge>{/if}
            <span class="truncate">{basename(id)}</span>
            <span class="sub truncate mono">{id}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if ids.length > 500}<p class="more">+{ids.length - 500} more</p>{/if}
  {:else}
    <p class="more">None</p>
  {/if}
{/snippet}

<style>
  .mod {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .id {
    font-size: var(--fs-xs);
  }
  .cyc {
    color: var(--yellow);
    display: inline-flex;
  }
  .size {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--blue);
    opacity: 0.6;
  }
  .cycle {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;
    margin: 0;
    padding: 0 14px;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .cycle li:not(:last-child)::after {
    content: '→';
    margin: 0 5px;
    color: var(--fg-faint);
  }
  .cycle button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font: inherit;
  }
  .cycle button:hover {
    color: var(--accent-fg);
    text-decoration: underline;
  }
  .cycle .me {
    color: var(--yellow);
  }
  .link-list .sub {
    max-width: 50%;
  }
  .more {
    margin: 4px 14px 0;
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
</style>
