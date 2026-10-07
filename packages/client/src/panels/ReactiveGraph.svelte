<script lang="ts">
  import { untrack } from 'svelte'

  import Button from '../components/Button.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import DataTable from '../components/DataTable.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import GraphView from '../components/GraphView.svelte'
  import Highlight from '../components/Highlight.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import Panel from '../components/Panel.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import SplitView from '../components/SplitView.svelte'
  import type { Column, SortState, TableRowState } from '../components/types.js'
  import { captureInfo } from '../lib/capture.svelte.js'
  import { groupBy } from '../lib/collections.js'
  import { componentName, formatClock } from '../lib/format.js'
  import { haystack, haystackMatcher } from '../lib/match.js'
  import { persisted } from '../lib/persisted.svelte.js'
  import { reactiveScope } from '../lib/reactive-selection.svelte.js'
  import {
    EMPTY_GRAPH,
    baselineNotice,
    fetchGraph,
    fetchSummary,
    fileNeighbourhood,
    hotStates,
    isEpochChanged,
    nodeValueText,
    sameGraph,
    sameValue,
    staleLabel,
    totalLabel,
  } from '../lib/reactive.js'
  import { resource } from '../lib/resource.svelte.js'
  import { router } from '../lib/router.svelte.js'
  import { getStateTimelineDelta, openReactiveInEditor } from '../lib/rpc.js'
  import type {
    ReactiveGraphResult,
    ReactiveNode,
    ReactiveSummary,
    StateTimelineEntry,
  } from '../lib/types.js'
  import { datasetVersion } from '../lib/versions.js'
  import ComponentsOverview from './reactive/ComponentsOverview.svelte'
  import HotStates from './reactive/HotStates.svelte'
  import KindBadge from './reactive/KindBadge.svelte'
  import SignalInspector from './reactive/SignalInspector.svelte'

  /*
   * Information design (docs/ui-status.md "UI information design v2",
   * docs/devframe-migration.md §6.7 A/I/J):
   *  - Overview (default): a cheap whole-app aggregate from runtime counters;
   *    no graph is fetched.
   *  - Component: the graph of ONE selected instance (scoped request).
   *  - Full graph: explicit opt-in, capped by the server and disclosed.
   * Edges are a snapshot of current dependencies ("can affect"), never a
   * recorded cause; what is not captured is labelled "not recorded".
   */

  /** SVG graph layout stays readable (and fast) up to roughly this size. */
  const GRAPH_LIMIT = 400
  /** Every graph poll makes the app walk the requested scope: slow, visible-only. */
  const POLL_MS = 5000
  /** The full graph stops auto-refreshing above this many nodes; refresh / resume still work. */
  const AUTO_PAUSE_ABOVE = 2000
  const SUMMARY = { topK: 50, windowMs: 10000 } as const
  const SUMMARY_POLL_MS = 2000

  type Tab = 'overview' | 'local' | 'full'
  let tab = $state<Tab>(reactiveScope.current ? 'local' : 'overview')
  const scope = $derived(reactiveScope.current)

  // A scope set from the Components inspector (or the overview) opens the component view.
  $effect(() => {
    if (reactiveScope.current) untrack(() => (tab = 'local'))
  })

  // --- Overview ----------------------------------------------------------

  /** Overview of components (runtime summary) or of states (timeline buffer); each works without the other. */
  let overviewOf = $state<'components' | 'states'>('components')

  const summary = resource<ReactiveSummary | null>(() => fetchSummary(SUMMARY), {
    initial: null,
    interval: SUMMARY_POLL_MS,
    when: () => tab === 'overview' && overviewOf === 'components',
  })

  let group = $state<'file' | 'instance'>('file')

  // Hot states: the server's timeline buffer grouped by signal (read from the
  // server buffer only; the app is not asked).
  const timeline = resource<StateTimelineEntry[]>(
    async () => (await getStateTimelineDelta(undefined)).changes,
    {
      initial: [],
      interval: SUMMARY_POLL_MS,
      version: datasetVersion('stateTimeline'),
      when: () => tab === 'overview' && overviewOf === 'states',
    },
  )

  const states = $derived(hotStates(timeline.data))
  // Baseline disclosure for the States view (capture info of the timeline).
  const statesCapture = captureInfo(
    SUMMARY_POLL_MS,
    () => tab === 'overview' && overviewOf === 'states',
  )
  const statesBaseline = $derived(baselineNotice(statesCapture.data.stateTimeline?.baseline))

  // --- Graph (component / full) ------------------------------------------

  let changed = $state.raw(new Set<string>())
  let lastValues = new Map<string, unknown>()
  /** When the app built the latest reply; `null` = unknown. Kept apart so `sameGraph` can ignore it. */
  let builtAt = $state<number | null>(null)

  /** Which graph the current tab asks for: an instance id, `null` = whole app, `undefined` = none. */
  const request = $derived<number | null | undefined>(
    tab === 'full' ? null : tab === 'local' && scope ? scope.componentId : undefined,
  )

  const graph = resource<ReactiveGraphResult>(
    async () => {
      // A component request implies a scope (see `request`).
      const want = untrack(() => request)
      if (want === undefined) return EMPTY_GRAPH
      const g = await fetchGraph(
        want === null ? null : { componentId: want, epoch: untrack(() => scope!.epoch) },
      )
      const valued = g.nodes.filter(n => n.value !== undefined)
      const diff = new Set(
        valued
          .filter(n => lastValues.has(n.id) && !sameValue(lastValues.get(n.id), n.value))
          .map(n => n.id),
      )
      lastValues = new Map(valued.map(n => [n.id, n.value]))
      if (diff.size || changed.size) changed = diff
      builtAt = g.computedAt
      return g
    },
    {
      initial: EMPTY_GRAPH,
      interval: POLL_MS,
      equals: sameGraph,
      when: () => request !== undefined,
    },
  )

  // A different scope is a different dataset: drop flashes and the selection.
  let lastRequest: number | null | undefined
  $effect(() => {
    const r = request
    untrack(() => {
      if (r === lastRequest) return
      lastRequest = r
      lastValues = new Map()
      changed = new Set()
      selected = null
      builtAt = null
      if (r !== undefined) void graph.refresh()
    })
  })

  // The full graph pauses once it grows past the threshold; if the user
  // resumes, respect that for the rest of the session.
  let autoPaused = $state(false)
  let userResumed = false
  $effect(() => {
    if (autoPaused && graph.live) userResumed = true
  })
  $effect(() => {
    if (tab !== 'full' || userResumed || autoPaused || graph.data.nodes.length <= AUTO_PAUSE_ABOVE)
      return
    untrack(() => {
      graph.live = false
      autoPaused = true
    })
  })

  /** Ids restart per page load: a scope from another epoch would point at a different instance. */
  const epochMismatch = $derived(
    tab === 'local' &&
      !!scope &&
      (isEpochChanged(graph.data) || (!!graph.data.epoch && graph.data.epoch !== scope.epoch)),
  )
  /** A reply for another request (still loading after a switch) is not shown. */
  const data = $derived(
    epochMismatch || request === undefined || graph.data.scope !== (request ?? null)
      ? EMPTY_GRAPH
      : graph.data,
  )

  const view = persisted<'auto' | 'graph' | 'list'>('reactive:view', 'auto')
  let query = $state('')
  let type = $state<'all' | ReactiveNode['type']>('all')
  let sort = $state<SortState | null>({ id: 'component', desc: false })
  let selected = $state<string | null>(null)
  /** Full graph only: narrow the loaded nodes to one file (client-side filter). */
  let fileFilter = $state('')

  const byId = $derived(new Map(data.nodes.map(n => [n.id, n])))
  const links = $derived({
    deps: groupBy(
      data.edges,
      e => e.to,
      e => e.from,
    ),
    dependents: groupBy(
      data.edges,
      e => e.from,
      e => e.to,
    ),
  })

  const files = $derived([...new Set(data.nodes.map(n => n.componentFile))].sort())

  const inFile = $derived(
    tab !== 'full' || !fileFilter ? null : fileNeighbourhood(data.nodes, data.edges, fileFilter),
  )

  // One lowercase haystack per node per graph update, so a keystroke is an
  // `includes` per node instead of formatting every value again.
  const hay = $derived(
    new Map(
      data.nodes.map(n => [
        n.id,
        haystack(n.name, n.componentFile, n.value === undefined ? '' : nodeValueText(n.value)),
      ]),
    ),
  )

  const nodes = $derived.by(() => {
    const m = haystackMatcher(query)
    const s = inFile
    return data.nodes.filter(
      n =>
        (!s || s.has(n.id)) &&
        (type === 'all' || n.type === type) &&
        (!m || m(hay.get(n.id) ?? '')),
    )
  })

  const nodeIds = $derived(new Set(nodes.map(n => n.id)))
  const edges = $derived(data.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to)))
  const mode = $derived(
    view.value === 'auto' ? (nodes.length <= 150 ? 'graph' : 'list') : view.value,
  )
  const current = $derived(selected ? (byId.get(selected) ?? null) : null)

  const counts = $derived.by(() => {
    const c = { state: 0, derived: 0, effect: 0, template: 0 }
    for (const n of data.nodes) c[n.type]++
    return c
  })

  const columns: Column<ReactiveNode>[] = [
    { id: 'type', label: 'Kind', width: '68px', sort: (a, b) => a.type.localeCompare(b.type) },
    {
      id: 'name',
      label: 'Name',
      width: 'minmax(120px, 1fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'component',
      label: 'Component',
      width: 'minmax(0, 1fr)',
      minWidth: 560,
      sort: (a, b) =>
        a.componentFile.localeCompare(b.componentFile) || a.name.localeCompare(b.name),
    },
    { id: 'value', label: 'Value', width: 'minmax(0, 1.2fr)' },
    {
      id: 'deps',
      label: 'In / Out',
      width: '64px',
      align: 'end',
      descFirst: true,
      minWidth: 680,
      sort: (a, b) =>
        (links.deps.get(a.id)?.length ?? 0) +
        (links.dependents.get(a.id)?.length ?? 0) -
        (links.deps.get(b.id)?.length ?? 0) -
        (links.dependents.get(b.id)?.length ?? 0),
    },
  ]

  /** Capabilities come with the summary; without one nothing beyond the graph is available. */
  const capabilities = $derived(
    summary.data?.capabilities ?? {
      valueInspection: false,
      signalHistory: false,
      writeCause: false,
    },
  )

  function open(n: ReactiveNode) {
    openReactiveInEditor(n.componentFile, n.name, n.type).catch(() => {})
  }

  function scopeTo(n: ReactiveNode) {
    if (data.epoch) reactiveScope.scopeTo(n.componentId, n.componentFile, data.epoch)
  }

  function clearScope() {
    reactiveScope.set(null)
    tab = 'overview'
  }
</script>

<Panel
  title="Reactivity"
  count={tab !== 'overview'
    ? data.nodes.length
    : overviewOf === 'states'
      ? states.length
      : (summary.data?.components.total ?? undefined)}
>
  {#snippet toolbar()}
    <Segmented
      label="Reactivity view"
      bind:value={tab}
      options={[
        { value: 'overview', label: 'Overview' },
        { value: 'local', label: scope ? scope.label : 'Component' },
        { value: 'full', label: 'Full graph' },
      ]}
    />
    {#if tab === 'overview'}
      <Segmented
        label="Overview of"
        bind:value={overviewOf}
        options={[
          { value: 'components', label: 'Components' },
          { value: 'states', label: 'States' },
        ]}
      />
    {/if}
    {#if tab === 'overview' && overviewOf === 'components'}
      <Segmented
        label="Group"
        bind:value={group}
        options={[
          { value: 'file', label: 'By file' },
          { value: 'instance', label: 'By instance' },
        ]}
      />
    {:else if tab !== 'overview'}
      <Segmented
        label="Signal kind"
        bind:value={type}
        options={[
          { value: 'all', label: 'All' },
          { value: 'state', label: '$state', count: counts.state },
          { value: 'derived', label: '$derived', count: counts.derived },
          { value: 'effect', label: '$effect', count: counts.effect },
          { value: 'template', label: 'markup', count: counts.template },
        ]}
      />
      <SearchField
        bind:value={query}
        placeholder="Filter the {data.nodes.length.toLocaleString()} loaded signals…"
        count={nodes.length}
      />
      {#if tab === 'full'}
        <select
          class="select scope"
          bind:value={fileFilter}
          aria-label="Filter loaded signals by component file"
        >
          <option value="">All loaded files ({files.length})</option>
          {#each files as f (f)}<option value={f}>{componentName(f)}</option>{/each}
        </select>
      {/if}
      <CaptureNotice
        info={{
          captured: data.nodes.length,
          total: data.total?.nodes ?? null,
          truncated: data.truncated,
          policy: data.policy,
        }}
        noun="signals"
        stale={staleLabel(data)}
      />
      {#if autoPaused && !graph.live && tab === 'full'}
        <span
          class="hint"
          title="Polling makes the app rebuild the whole graph; large graphs start paused."
        >
          Paused: {data.nodes.length.toLocaleString()} of {totalLabel(data.total?.nodes)} signals
        </span>
      {/if}
      <Segmented
        label="Layout"
        bind:value={view.value}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'graph', label: 'Graph' },
          { value: 'list', label: 'List' },
        ]}
      />
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if tab === 'overview'}
      <LiveControls res={overviewOf === 'states' ? timeline : summary} />
    {:else if request !== undefined}
      <LiveControls res={graph} />
    {/if}
  {/snippet}

  {#if tab === 'overview'}
    {#if overviewOf === 'states'}
      <HotStates {timeline} {states} baseline={statesBaseline} />
    {:else}
      <ComponentsOverview {summary} {group} onfullgraph={() => (tab = 'full')} />
    {/if}
  {:else if tab === 'local' && !scope}
    <EmptyState icon="reactive" title="Pick a component">
      <p>
        Choose one in the <button type="button" class="link" onclick={() => (tab = 'overview')}
          >Overview</button
        >
        or use <strong>Show reactivity</strong> in the
        <button type="button" class="link" onclick={() => router.go('components')}
          >Components</button
        > inspector. Only that component's signals and the signals they are directly linked to are loaded.
      </p>
    </EmptyState>
  {:else if epochMismatch}
    <EmptyState icon="warning" title="The app page reloaded">
      <p>
        Component ids restart on every page load, so {scope?.label} #{scope?.componentId} may now be a
        different instance. Pick it again.
      </p>
      <Button icon="close" onclick={clearScope}>Clear selection</Button>
    </EmptyState>
  {:else}
    {@render local()}
  {/if}
</Panel>

{#snippet local()}
  <SplitView id="reactive" open={!!current}>
    <div class="local">
      {#if tab === 'local' && scope}
        <div class="scope-bar">
          <span>
            <strong class="mono">{scope.label}</strong>
            <span class="faint num">#{scope.componentId}</span> and the signals it is directly linked
            to
          </span>
          <Button icon="close" variant="ghost" label="Clear selection" onclick={clearScope} />
        </div>
      {/if}
      <p class="legend">
        Edges mean <strong>can affect</strong>: a snapshot of current dependencies, not a recorded
        cause.
        {#if data.edgesOmitted}{data.edgesOmitted.toLocaleString()} edges to signals outside the loaded
          set are not shown.{/if}
        {#if builtAt !== null && data !== EMPTY_GRAPH}Built {formatClock(builtAt)}.{/if}
      </p>
      <div class="body">
        {#if data.nodes.length === 0}
          {#if graph.loading || graph.busy}
            <EmptyState title="Collecting reactive graph…" />
          {:else}
            <EmptyState icon="reactive" title="No signals tracked here">
              <p>Signals created during component init appear here with their dependencies.</p>
            </EmptyState>
          {/if}
        {:else if mode === 'graph'}
          {#if nodes.length === 0}
            <EmptyState icon="search" title="No loaded signals match" />
          {:else if nodes.length > GRAPH_LIMIT}
            <EmptyState
              icon="graph"
              title="{nodes.length.toLocaleString()} signals is too many to lay out"
            >
              <p>
                Pick a single component or filter to under {GRAPH_LIMIT} signals, or use the list view.
              </p>
              <Button icon="list" onclick={() => (view.value = 'list')}>Switch to list</Button>
            </EmptyState>
          {:else}
            <div class="graph">
              <GraphView {nodes} {edges} changedNodeIds={changed} bind:selectedNodeId={selected} />
            </div>
          {/if}
        {:else}
          <DataTable
            items={nodes}
            {columns}
            getKey={(n: ReactiveNode) => n.id}
            bind:sort
            bind:selected
            label="Reactive signals"
            onactivate={open}
          >
            {#snippet row(n: ReactiveNode, { visible }: TableRowState)}
              <span><KindBadge type={n.type} /></span>
              <span class="truncate mono name" class:flash={changed.has(n.id)}
                ><Highlight text={n.name} {query} /></span
              >
              {#if visible.has('component')}<span class="truncate muted"
                  ><Highlight text={componentName(n.componentFile)} {query} /></span
                >{/if}
              <span class="truncate mono value"
                >{n.value === undefined ? '' : nodeValueText(n.value, 120)}</span
              >
              {#if visible.has('deps')}<span class="end num faint"
                  >{links.deps.get(n.id)?.length ?? 0} / {links.dependents.get(n.id)?.length ??
                    0}</span
                >{/if}
            {/snippet}
            {#snippet empty()}<EmptyState icon="search" title="No loaded signals match" />{/snippet}
          </DataTable>
        {/if}
      </div>
    </div>
    {#snippet aside()}
      {#if current}
        <SignalInspector
          node={current}
          {byId}
          deps={links.deps.get(current.id) ?? []}
          dependents={links.dependents.get(current.id) ?? []}
          flash={changed.has(current.id)}
          {capabilities}
          scopedTo={tab === 'local' && scope ? scope.componentId : null}
          canScope={!!data.epoch}
          onselect={(id: string) => (selected = id)}
          onopen={open}
          onscope={scopeTo}
          onclose={() => (selected = null)}
        />
      {/if}
    {/snippet}
  </SplitView>
{/snippet}

<style>
  .scope {
    max-width: 200px;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .local {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .legend {
    margin: 0;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .scope-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px 4px 14px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-fg);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
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
</style>
