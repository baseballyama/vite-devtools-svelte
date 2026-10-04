<script lang="ts">
  import { untrack } from 'svelte'
  import { getReactiveGraph, openReactiveInEditor } from '../lib/rpc.js'
  import type { ReactiveGraph, ReactiveNode } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { persisted } from '../lib/persisted.svelte.js'
  import { matcher } from '../lib/match.js'
  import { componentName, formatValue, prettyValue } from '../lib/format.js'
  import Panel from '../components/Panel.svelte'
  import SplitView from '../components/SplitView.svelte'
  import DataTable, { type Column, type SortState } from '../components/DataTable.svelte'
  import Inspector from '../components/Inspector.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import Button from '../components/Button.svelte'
  import Badge, { type Tone } from '../components/Badge.svelte'
  import Highlight from '../components/Highlight.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import GraphView from '../components/GraphView.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import { captureInfo } from '../lib/capture.svelte.js'

  /** SVG graph layout stays readable (and fast) up to roughly this size. */
  const GRAPH_LIMIT = 400
  /**
   * Every poll makes the app rebuild its whole reactive graph (§6.4): poll
   * slowly, only while visible (resource), and pause auto-refresh for large
   * graphs — manual refresh / resume via LiveControls still work.
   */
  const POLL_MS = 5000
  const AUTO_PAUSE_ABOVE = 2000

  let changed = $state.raw(new Set<string>())
  let lastValues = new Map<string, unknown>()

  const graph = resource<ReactiveGraph>(
    async () => {
      const g = await getReactiveGraph()
      const next = new Map<string, unknown>()
      const diff = new Set<string>()
      for (const n of g.nodes) {
        if (n.value === undefined) continue
        const v = JSON.stringify(n.value)
        next.set(n.id, v)
        if (lastValues.has(n.id) && lastValues.get(n.id) !== v) diff.add(n.id)
      }
      lastValues = next
      if (diff.size || changed.size) changed = diff
      return g
    },
    { initial: { nodes: [], edges: [] }, interval: POLL_MS },
  )

  // Pause once the graph grows past the threshold; if the user resumes,
  // respect that for the rest of the session.
  let autoPaused = $state(false)
  let userResumed = false
  $effect(() => {
    if (autoPaused && graph.live) userResumed = true
  })
  $effect(() => {
    if (userResumed || autoPaused || graph.data.nodes.length <= AUTO_PAUSE_ABOVE) return
    untrack(() => {
      graph.live = false
      autoPaused = true
    })
  })

  const capture = captureInfo(POLL_MS)

  const view = persisted<'auto' | 'graph' | 'list'>('reactive:view', 'auto')
  let query = $state('')
  let type = $state<'all' | ReactiveNode['type']>('all')
  let sort = $state<SortState | null>({ id: 'component', desc: false })
  let selected = $state<string | null>(null)
  /** Restrict to one component (+ signals it is directly linked to). */
  let scope = $state('')

  const byId = $derived(new Map(graph.data.nodes.map((n) => [n.id, n])))
  const links = $derived.by(() => {
    const deps = new Map<string, string[]>()
    const dependents = new Map<string, string[]>()
    for (const e of graph.data.edges) {
      ;(deps.get(e.to) ?? deps.set(e.to, []).get(e.to)!).push(e.from)
      ;(dependents.get(e.from) ?? dependents.set(e.from, []).get(e.from)!).push(e.to)
    }
    return { deps, dependents }
  })

  const components = $derived([...new Set(graph.data.nodes.map((n) => n.componentFile))].sort())

  const inScope = $derived.by(() => {
    if (!scope) return null
    const ids = new Set<string>()
    for (const n of graph.data.nodes) if (n.componentFile === scope) ids.add(n.id)
    for (const e of graph.data.edges) {
      if (ids.has(e.from) || ids.has(e.to)) {
        ids.add(e.from)
        ids.add(e.to)
      }
    }
    return ids
  })

  const nodes = $derived.by(() => {
    const m = matcher(query)
    const s = inScope
    return graph.data.nodes.filter(
      (n) =>
        (!s || s.has(n.id)) &&
        (type === 'all' || n.type === type) &&
        (!m || m(n.name, n.componentFile, n.value === undefined ? '' : formatValue(n.value))),
    )
  })

  const nodeIds = $derived(new Set(nodes.map((n) => n.id)))
  const edges = $derived(graph.data.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)))
  const mode = $derived(view.value === 'auto' ? (nodes.length <= 150 ? 'graph' : 'list') : view.value)
  const current = $derived(selected ? (byId.get(selected) ?? null) : null)

  const counts = $derived.by(() => {
    const c = { state: 0, derived: 0, effect: 0 }
    for (const n of graph.data.nodes) c[n.type]++
    return c
  })

  const tones: Record<ReactiveNode['type'], Tone> = { state: 'blue', derived: 'green', effect: 'red' }

  const columns: Column<ReactiveNode>[] = [
    { id: 'type', label: 'Kind', width: '68px', sort: (a, b) => a.type.localeCompare(b.type) },
    { id: 'name', label: 'Name', width: 'minmax(120px, 1fr)', sort: (a, b) => a.name.localeCompare(b.name) },
    { id: 'component', label: 'Component', width: 'minmax(0, 1fr)', minWidth: 560, sort: (a, b) => a.componentFile.localeCompare(b.componentFile) || a.name.localeCompare(b.name) },
    { id: 'value', label: 'Value', width: 'minmax(0, 1.2fr)' },
    { id: 'deps', label: 'In / Out', width: '64px', align: 'end', descFirst: true, minWidth: 680, sort: (a, b) => (links.deps.get(a.id)?.length ?? 0) + (links.dependents.get(a.id)?.length ?? 0) - (links.deps.get(b.id)?.length ?? 0) - (links.dependents.get(b.id)?.length ?? 0) },
  ]

  function open(n: ReactiveNode) {
    openReactiveInEditor(n.componentFile, n.name, n.type).catch(() => {})
  }
</script>

<Panel title="Reactivity" count={graph.data.nodes.length}>
  {#snippet toolbar()}
    <Segmented
      label="Signal kind"
      bind:value={type}
      options={[
        { value: 'all', label: 'All' },
        { value: 'state', label: '$state', count: counts.state },
        { value: 'derived', label: '$derived', count: counts.derived },
        { value: 'effect', label: '$effect', count: counts.effect },
      ]}
    />
    <SearchField bind:value={query} placeholder="Filter signals, components, values…" count={nodes.length} />
    <select class="select scope" bind:value={scope} aria-label="Limit to component">
      <option value="">All components ({components.length})</option>
      {#each components as f (f)}<option value={f}>{componentName(f)}</option>{/each}
    </select>
    <CaptureNotice info={capture.data.reactiveNodes} noun="signals" />
    {#if autoPaused && !graph.live}
      <span class="paused-hint" title="Polling rebuilds the app's whole reactive graph; large graphs start paused.">
        Paused: {graph.data.nodes.length.toLocaleString()} signals
      </span>
    {/if}
    <Segmented
      label="View"
      bind:value={view.value}
      options={[
        { value: 'auto', label: 'Auto' },
        { value: 'graph', label: 'Graph' },
        { value: 'list', label: 'List' },
      ]}
    />
  {/snippet}
  {#snippet actions()}
    <LiveControls res={graph} />
  {/snippet}

  <SplitView id="reactive" open={!!current}>
    {#if graph.data.nodes.length === 0}
      {#if graph.loading}
        <EmptyState title="Collecting reactive graph…" />
      {:else}
        <EmptyState icon="reactive" title="No signals tracked yet">
          <p>Open your app — <code>$state</code>, <code>$derived</code> and <code>$effect</code> appear here with their dependencies.</p>
        </EmptyState>
      {/if}
    {:else if mode === 'graph'}
      {#if nodes.length > GRAPH_LIMIT}
        <EmptyState icon="graph" title="{nodes.length.toLocaleString()} signals is too many to lay out">
          <p>Pick a component in the toolbar or filter to under {GRAPH_LIMIT} signals, or use the list view.</p>
          <Button icon="list" onclick={() => (view.value = 'list')}>Switch to list</Button>
        </EmptyState>
      {:else}
        <div class="graph">
          <GraphView {nodes} {edges} changedNodeIds={changed} bind:selectedNodeId={selected} />
        </div>
      {/if}
    {:else}
      <DataTable items={nodes} {columns} getKey={(n) => n.id} bind:sort bind:selected label="Reactive signals" onactivate={open}>
        {#snippet row(n, { visible })}
          <span><Badge tone={tones[n.type]}>{n.type}</Badge></span>
          <span class="truncate mono name" class:flash={changed.has(n.id)}><Highlight text={n.name} {query} /></span>
          {#if visible.has('component')}<span class="truncate muted"><Highlight text={componentName(n.componentFile)} {query} /></span>{/if}
          <span class="truncate mono value">{n.value === undefined ? '' : formatValue(n.value, 120)}</span>
          {#if visible.has('deps')}<span class="end num faint">{links.deps.get(n.id)?.length ?? 0} / {links.dependents.get(n.id)?.length ?? 0}</span>{/if}
        {/snippet}
        {#snippet empty()}<EmptyState icon="search" title="No signals match" />{/snippet}
      </DataTable>
    {/if}
    {#snippet aside()}
      {#if current}
        <Inspector title={current.name} subtitle={current.componentFile} onclose={() => (selected = null)}>
          {#snippet badges()}
            <Badge tone={tones[current.type]}>${current.type}</Badge>
            <Badge>component #{current.componentId}</Badge>
          {/snippet}
          {#snippet actions()}
            <Button icon="editor" onclick={() => open(current)}>Go to definition</Button>
          {/snippet}
          {#if current.value !== undefined}
            <h3 class="section-title">Current value</h3>
            <pre class="code-block" class:flash={changed.has(current.id)}>{prettyValue(current.value)}</pre>
          {/if}
          {@render rel('Depends on', links.deps.get(current.id) ?? [])}
          {@render rel('Triggers', links.dependents.get(current.id) ?? [])}
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

{#snippet rel(title: string, ids: string[])}
  <h3 class="section-title">{title} <span class="num">{ids.length}</span></h3>
  {#if ids.length}
    <ul class="link-list">
      {#each ids as id (id)}
        {@const n = byId.get(id)}
        {#if n}
          <li>
            <button onclick={() => (selected = id)}>
              <Badge tone={tones[n.type]}>{n.type}</Badge>
              <span class="truncate mono">{n.name}</span>
              <span class="sub truncate">{componentName(n.componentFile)}</span>
            </button>
          </li>
        {/if}
      {/each}
    </ul>
  {:else}
    <p class="none">None</p>
  {/if}
{/snippet}

<style>
  .scope {
    max-width: 200px;
  }
  .paused-hint {
    font-size: var(--fs-xs);
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .graph {
    height: 100%;
    padding: 8px;
  }
  .name {
    font-size: var(--fs-sm);
  }
  .value {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
  .flash {
    animation: flash 1s var(--ease);
  }
  @keyframes flash {
    from {
      background: var(--yellow-bg);
      color: var(--yellow);
    }
  }
  .none {
    margin: 0;
    padding: 0 14px;
    color: var(--fg-faint);
    font-size: var(--fs-sm);
  }
</style>
