<script lang="ts">
  import { untrack } from 'svelte'
  import { openReactiveInEditor } from '../lib/rpc.js'
  import type { ReactiveGraphResult, ReactiveNode, ReactiveSummary, ReactiveSummaryRow } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { persisted } from '../lib/persisted.svelte.js'
  import { haystack, haystackMatcher } from '../lib/match.js'
  import { componentName, formatClock, formatMs, formatValue, prettyValue, shortPath } from '../lib/format.js'
  import { EMPTY_GRAPH, baselineNotice, fetchGraph, fetchSummary, groupByFile, isEpochChanged, isValueSummary, nodeCount, nodeValueText, sameGraph, sameValue } from '../lib/reactive.js'
  import { reactiveScope } from '../lib/reactive-selection.svelte.js'
  import { router } from '../lib/router.svelte.js'
  import { getLiveComponentsMeta, getStateTimelineDelta } from '../lib/rpc.js'
  import { datasetVersion } from '../lib/versions.js'
  import type { StateTimelineEntry } from '../lib/types.js'
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
  let summarySort = $state<SortState | null>({ id: 'changes', desc: true })
  let summarySelected = $state<string | null>(null)

  interface OverviewRow {
    key: string
    file: string
    instances: ReactiveSummaryRow[]
    nodes: ReactiveSummaryRow['nodes']
    changes: number
    renders: number
    renderMs: number
  }

  const overviewRows = $derived.by<OverviewRow[]>(() => {
    const rows = summary.data?.rows ?? []
    if (group === 'file') return groupByFile(rows).map((g) => ({ key: g.file, ...g }))
    return rows.map((r) => ({ key: `#${r.componentId}`, file: r.file, instances: [r], nodes: r.nodes, changes: r.changes, renders: r.renders, renderMs: r.renderMs }))
  })
  const overviewCurrent = $derived(summarySelected ? (overviewRows.find((r) => r.key === summarySelected) ?? null) : null)

  const overviewColumns: Column<OverviewRow>[] = [
    { id: 'component', label: 'Component', width: 'minmax(0, 1fr)', sort: (a, b) => a.file.localeCompare(b.file) },
    { id: 'instances', label: 'Inst.', width: '52px', align: 'end', descFirst: true, minWidth: 560, sort: (a, b) => a.instances.length - b.instances.length },
    { id: 'nodes', label: 'Signals', width: '72px', align: 'end', descFirst: true, minWidth: 640, sort: (a, b) => nodeCount(a.nodes) - nodeCount(b.nodes) },
    { id: 'changes', label: 'Changes', width: '84px', align: 'end', descFirst: true, sort: (a, b) => a.changes - b.changes },
    { id: 'renders', label: 'Renders', width: '72px', align: 'end', descFirst: true, sort: (a, b) => a.renders - b.renders },
    { id: 'renderMs', label: 'Render time', width: '96px', align: 'end', descFirst: true, minWidth: 720, sort: (a, b) => a.renderMs - b.renderMs },
  ]

  // Hot states: the server's timeline buffer grouped by signal. It is the
  // latest changes across all signals, sampled every 200 ms, so counts are
  // "seen in the buffer", not totals or rates. Read from the server buffer
  // only (the app is not asked).
  const timeline = resource<StateTimelineEntry[]>(async () => (await getStateTimelineDelta(undefined)).changes, {
    initial: [],
    interval: SUMMARY_POLL_MS,
    version: datasetVersion('stateTimeline'),
    when: () => tab === 'overview' && overviewOf === 'states',
  })

  interface HotState {
    key: string
    name: string
    file: string
    componentId: number | null
    changes: number
    last: StateTimelineEntry
  }

  const hotStates = $derived.by<HotState[]>(() => {
    const m = new Map<string, HotState>()
    for (const c of timeline.data) {
      const h = m.get(c.id)
      if (h) {
        h.changes++
        if (c.seq > h.last.seq) h.last = c
      } else {
        // Node ids are `<componentId>:<name>` (runtime trackState).
        const cid = Number(c.id.slice(0, c.id.indexOf(':')))
        m.set(c.id, { key: c.id, name: c.name, file: c.componentFile, componentId: Number.isInteger(cid) ? cid : null, changes: 1, last: c })
      }
    }
    return [...m.values()]
  })
  // Baseline disclosure for the States view (capture info of the timeline).
  const statesCapture = captureInfo(SUMMARY_POLL_MS, () => tab === 'overview' && overviewOf === 'states')
  const statesBaseline = $derived(baselineNotice(statesCapture.data.stateTimeline?.baseline))
  const bufferSince = $derived(timeline.data.length ? timeline.data[0].timestamp : null)
  let stateSort = $state<SortState | null>({ id: 'changes', desc: true })
  let stateSelected = $state<string | null>(null)

  const stateColumns: Column<HotState>[] = [
    { id: 'name', label: 'State', width: 'minmax(120px, 1fr)', sort: (a, b) => a.name.localeCompare(b.name) },
    { id: 'component', label: 'Component', width: 'minmax(0, 1fr)', minWidth: 560, sort: (a, b) => a.file.localeCompare(b.file) },
    { id: 'changes', label: 'Changes', width: '84px', align: 'end', descFirst: true, sort: (a, b) => a.changes - b.changes },
    { id: 'value', label: 'Last value', width: 'minmax(0, 1fr)', minWidth: 680 },
    { id: 'at', label: 'Last seen', width: '96px', align: 'end', descFirst: true, sort: (a, b) => a.last.seq - b.last.seq },
  ]

  // Timeline entries carry no page-load id, so the selection takes the served
  // epoch at the moment of the click; the server refuses the scoped request if
  // it no longer matches (staleReason 'epoch-changed').
  async function selectState(h: HotState) {
    if (h.componentId === null) return
    const epoch = (await getLiveComponentsMeta().catch(() => null))?.epoch
    if (!epoch) return
    reactiveScope.set({ componentId: h.componentId, epoch, label: `<${componentName(h.file)}>`, file: h.file })
  }

  /** Scoped selections need the page load the id belongs to; without one there is nothing to validate. */
  function select(r: ReactiveSummaryRow, epoch: string | null) {
    if (!epoch) return
    reactiveScope.set({ componentId: r.componentId, epoch, label: `<${componentName(r.file)}>`, file: r.file })
  }

  // --- Graph (component / full) ------------------------------------------

  let changed = $state.raw(new Set<string>())
  let lastValues = new Map<string, unknown>()
  /** When the app built the latest reply; `null` = unknown. Kept apart so `sameGraph` can ignore it. */
  let builtAt = $state<number | null>(null)

  /** Which graph the current tab asks for: an instance id, `null` = whole app, `undefined` = none. */
  const request = $derived<number | null | undefined>(tab === 'full' ? null : tab === 'local' && scope?.epoch ? scope.componentId : undefined)

  const graph = resource<ReactiveGraphResult>(
    async () => {
      const want = untrack(() => request)
      const epoch = untrack(() => scope?.epoch)
      if (want === undefined || (want !== null && !epoch)) return EMPTY_GRAPH
      const g = await fetchGraph(want === null ? null : { componentId: want, epoch: epoch! })
      const next = new Map<string, unknown>()
      const diff = new Set<string>()
      for (const n of g.nodes) {
        if (n.value === undefined) continue
        next.set(n.id, n.value)
        if (lastValues.has(n.id) && !sameValue(lastValues.get(n.id), n.value)) diff.add(n.id)
      }
      lastValues = next
      if (diff.size || changed.size) changed = diff
      builtAt = g.computedAt
      return g
    },
    { initial: EMPTY_GRAPH, interval: POLL_MS, equals: sameGraph, when: () => request !== undefined },
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
      if (r !== undefined) graph.refresh()
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
    if (tab !== 'full' || userResumed || autoPaused || graph.data.nodes.length <= AUTO_PAUSE_ABOVE) return
    untrack(() => {
      graph.live = false
      autoPaused = true
    })
  })

  /** Ids restart per page load: a scope from another epoch would point at a different instance. */
  const epochMismatch = $derived(
    tab === 'local' && !!scope?.epoch && (isEpochChanged(graph.data) || (!!graph.data.epoch && graph.data.epoch !== scope.epoch)),
  )
  /** A reply for another request (still loading after a switch) is not shown. */
  const data = $derived(epochMismatch || request === undefined || graph.data.scope !== (request ?? null) ? EMPTY_GRAPH : graph.data)

  const view = persisted<'auto' | 'graph' | 'list'>('reactive:view', 'auto')
  let query = $state('')
  let type = $state<'all' | ReactiveNode['type']>('all')
  let sort = $state<SortState | null>({ id: 'component', desc: false })
  let selected = $state<string | null>(null)
  /** Full graph only: narrow the loaded nodes to one file (client-side filter). */
  let fileFilter = $state('')

  const byId = $derived(new Map(data.nodes.map((n) => [n.id, n])))
  const links = $derived.by(() => {
    const deps = new Map<string, string[]>()
    const dependents = new Map<string, string[]>()
    for (const e of data.edges) {
      ;(deps.get(e.to) ?? deps.set(e.to, []).get(e.to)!).push(e.from)
      ;(dependents.get(e.from) ?? dependents.set(e.from, []).get(e.from)!).push(e.to)
    }
    return { deps, dependents }
  })

  const files = $derived([...new Set(data.nodes.map((n) => n.componentFile))].sort())

  const inFile = $derived.by(() => {
    if (tab !== 'full' || !fileFilter) return null
    const ids = new Set<string>()
    for (const n of data.nodes) if (n.componentFile === fileFilter) ids.add(n.id)
    for (const e of data.edges) {
      if (ids.has(e.from) || ids.has(e.to)) {
        ids.add(e.from)
        ids.add(e.to)
      }
    }
    return ids
  })

  // One lowercase haystack per node per graph update, so a keystroke is an
  // `includes` per node instead of formatting every value again.
  const hay = $derived(new Map(data.nodes.map((n) => [n.id, haystack(n.name, n.componentFile, n.value === undefined ? '' : nodeValueText(n.value))])))

  const nodes = $derived.by(() => {
    const m = haystackMatcher(query)
    const s = inFile
    return data.nodes.filter((n) => (!s || s.has(n.id)) && (type === 'all' || n.type === type) && (!m || m(hay.get(n.id) ?? '')))
  })

  const nodeIds = $derived(new Set(nodes.map((n) => n.id)))
  const edges = $derived(data.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)))
  const mode = $derived(view.value === 'auto' ? (nodes.length <= 150 ? 'graph' : 'list') : view.value)
  const current = $derived(selected ? (byId.get(selected) ?? null) : null)

  const counts = $derived.by(() => {
    const c = { state: 0, derived: 0, effect: 0 }
    for (const n of data.nodes) c[n.type]++
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

  /** Capabilities come with the summary; without one nothing beyond the graph is available. */
  const capabilities = $derived(summary.data?.capabilities ?? { valueInspection: false, signalHistory: false, writeCause: false })
  const totalLabel = (n: number | null | undefined) => (n == null ? 'unknown' : n.toLocaleString())
  const staleLabel = (s?: { stale?: boolean; staleReason?: string } | null) =>
    s?.stale ? (s.staleReason === 'no-runtime' ? 'no app page is connected' : 'the app did not answer in time; showing the previous reply') : null

  function open(n: ReactiveNode) {
    openReactiveInEditor(n.componentFile, n.name, n.type).catch(() => {})
  }

  function scopeTo(n: ReactiveNode) {
    if (!data.epoch) return
    reactiveScope.set({ componentId: n.componentId, epoch: data.epoch, label: `<${componentName(n.componentFile)}>`, file: n.componentFile })
  }

  function clearScope() {
    reactiveScope.set(null)
    tab = 'overview'
  }
</script>

<Panel
  title="Reactivity"
  count={tab !== 'overview' ? data.nodes.length : overviewOf === 'states' ? hotStates.length : (summary.data?.components.total ?? undefined)}
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
        ]}
      />
      <SearchField bind:value={query} placeholder="Filter the {data.nodes.length.toLocaleString()} loaded signals…" count={nodes.length} />
      {#if tab === 'full'}
        <select class="select scope" bind:value={fileFilter} aria-label="Filter loaded signals by component file">
          <option value="">All loaded files ({files.length})</option>
          {#each files as f (f)}<option value={f}>{componentName(f)}</option>{/each}
        </select>
      {/if}
      <CaptureNotice
        info={{ captured: data.nodes.length, total: data.total?.nodes ?? null, truncated: data.truncated, policy: data.policy }}
        noun="signals"
        stale={staleLabel(data)}
      />
      {#if autoPaused && !graph.live && tab === 'full'}
        <span class="hint" title="Polling makes the app rebuild the whole graph; large graphs start paused.">
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
    {@render overview()}
  {:else if tab === 'local' && !scope}
    <EmptyState icon="reactive" title="Pick a component">
      <p>
        Choose one in the <button class="link" onclick={() => (tab = 'overview')}>Overview</button> or use <strong>Show reactivity</strong> in the
        <button class="link" onclick={() => router.go('components')}>Components</button> inspector. Only that component's signals and the signals they are
        directly linked to are loaded.
      </p>
    </EmptyState>
  {:else if tab === 'local' && scope && !scope.epoch}
    <EmptyState icon="warning" title="This selection has no page-load id">
      <p>Component ids are only valid within one page load. Pick {scope.label} again in Components once the tree has refreshed.</p>
      <Button icon="close" onclick={clearScope}>Clear selection</Button>
    </EmptyState>
  {:else if epochMismatch}
    <EmptyState icon="warning" title="The app page reloaded">
      <p>Component ids restart on every page load, so {scope?.label} #{scope?.componentId} may now be a different instance. Pick it again.</p>
      <Button icon="close" onclick={clearScope}>Clear selection</Button>
    </EmptyState>
  {:else}
    {@render local()}
  {/if}
</Panel>

{#snippet overview()}
  {#if overviewOf === 'states'}
    {@render hotStatesView()}
  {:else}
    {@render componentsOverview()}
  {/if}
{/snippet}

{#snippet componentsOverview()}
  {@const s = summary.data}
  {#if !s && summary.error}
    <EmptyState icon="warning" title="Overview not available">
      <p>The dev server did not return per-component activity ({summary.error}). Pick a component in Components (Show reactivity) or open the full graph.</p>
      <Button icon="graph" onclick={() => (tab = 'full')}>Full graph</Button>
    </EmptyState>
  {:else if !s}
    <EmptyState title="Reading activity…" />
  {:else}
    <div class="overview">
      <dl class="record" aria-label="What this overview covers">
        <div><dt>Window</dt><dd>last {Math.round(s.window.ms / 1000)} s · sampled while active for {Math.round(s.window.sampledActiveMs / 1000)} s</dd></div>
        <div><dt>Changes</dt><dd>$state sampled every 200 ms; several writes within one sample count once</dd></div>
        <div><dt>Coverage</dt><dd>state created during component init; module-level <code>.svelte.ts</code> state is not tracked</dd></div>
        <div><dt>Components</dt><dd>{s.components.withActivity.toLocaleString()} active of {totalLabel(s.components.total)} registered</dd></div>
        <div>
          <dt>Not available yet</dt>
          <dd>
            {[!s.capabilities.valueInspection && 'full values', !s.capabilities.signalHistory && 'per-signal history', !s.capabilities.writeCause && 'update cause'].filter(Boolean).join(', ') || 'none'}
            (not reported by this dev server)
          </dd>
        </div>
        {#if baselineNotice(s.baseline)}<div class="warn"><dt>Baseline</dt><dd>{baselineNotice(s.baseline)}</dd></div>{/if}
        {#if staleLabel(s)}<div class="warn"><dt>Stale</dt><dd>{staleLabel(s)}</dd></div>{/if}
      </dl>
      <div class="table">
        <SplitView id="reactive-overview" open={!!overviewCurrent}>
          <DataTable
            items={overviewRows}
            columns={overviewColumns}
            getKey={(r) => r.key}
            bind:sort={summarySort}
            bind:selected={summarySelected}
            label="Most active components"
            onactivate={(r) => r.instances.length === 1 && select(r.instances[0], s.epoch)}
          >
            {#snippet row(r, { visible })}
              <span class="truncate">
                <span class="mono">{componentName(r.file)}</span>
                {#if group === 'instance'}<span class="faint num">{` #${r.instances[0].componentId}`}</span>{/if}
              </span>
              {#if visible.has('instances')}<span class="end num">{r.instances.length}</span>{/if}
              {#if visible.has('nodes')}
                <span class="end num faint" title="registered: {r.nodes.state} $state · {r.nodes.derived} $derived · {r.nodes.effect} $effect">{nodeCount(r.nodes)}</span>
              {/if}
              <span class="end num" title="at least this many changes in the window (sampled every 200 ms); not a rate">≥ {r.changes.toLocaleString()}</span>
              <span class="end num">{r.renders.toLocaleString()}</span>
              {#if visible.has('renderMs')}<span class="end num faint">{formatMs(r.renderMs)}</span>{/if}
            {/snippet}
            {#snippet empty()}<EmptyState icon="reactive" title="No component was active in the window" />{/snippet}
          </DataTable>
          {#snippet aside()}
            {#if overviewCurrent}
              <Inspector title="<{componentName(overviewCurrent.file)}>" subtitle={shortPath(overviewCurrent.file, 3)} onclose={() => (summarySelected = null)}>
                <h3 class="section-title">Listed instances <span class="num">{overviewCurrent.instances.length}</span></h3>
                <ul class="link-list">
                  {#each overviewCurrent.instances as r (r.componentId)}
                    <li>
                      <button disabled={!s.epoch} onclick={() => select(r, s.epoch)}>
                        <span class="mono">#{r.componentId}</span>
                        <span class="sub">≥ {r.changes.toLocaleString()} changes · {r.renders.toLocaleString()} renders</span>
                      </button>
                    </li>
                  {/each}
                </ul>
                <p class="note">
                  {s.epoch
                    ? 'Select an instance to load its signals and the signals they are directly linked to.'
                    : 'The dev server reported no page-load id, so instances cannot be selected here; use Show reactivity in Components.'}
                </p>
              </Inspector>
            {/if}
          {/snippet}
        </SplitView>
      </div>
      <p class="foot">
        Listed: {s.rows.length.toLocaleString()} {s.rows.length === 1 ? 'component' : 'components'} ({s.truncated ? `top ${s.rows.length} of ${s.components.withActivity.toLocaleString()} active` : 'all active'}).
        {#if s.other}Other: {s.other.components.toLocaleString()} components with {s.other.nodes.toLocaleString()} signals.{:else}Other: unknown.{/if}
        Total registered: {totalLabel(s.components.total)}. Counts restart when the app page reloads.
      </p>
    </div>
  {/if}
{/snippet}

{#snippet hotStatesView()}
  {#if !timeline.data.length && timeline.error}
    <EmptyState icon="warning" title="State timeline not available">
      <p>The dev server did not return the timeline buffer ({timeline.error}).</p>
    </EmptyState>
  {:else}
  <div class="overview">
  {#if statesBaseline}<p class="baseline" role="status">{statesBaseline}</p>{/if}
  <div class="table">
      <DataTable
        items={hotStates}
        columns={stateColumns}
        getKey={(h) => h.key}
        bind:sort={stateSort}
        bind:selected={stateSelected}
        label="Most changed states in the timeline buffer"
        onactivate={selectState}
      >
        {#snippet row(h, { visible })}
          <span class="truncate mono name">{h.name}</span>
          {#if visible.has('component')}<span class="truncate muted">{componentName(h.file)}{#if h.componentId !== null}<span class="faint num">{` #${h.componentId}`}</span>{/if}</span>{/if}
          <span class="end num" title="changes of this state in the buffer (sampled every 200 ms); not a total or a rate">≥ {h.changes.toLocaleString()}</span>
          {#if visible.has('value')}<span class="truncate mono value">{formatValue(h.last.newValue, 80)}</span>{/if}
          <span class="end num faint">{formatClock(h.last.timestamp)}</span>
        {/snippet}
        {#snippet empty()}<EmptyState icon="timeline" title={timeline.loading ? 'Reading the timeline…' : 'No $state changes in the buffer'} />{/snippet}
      </DataTable>
  </div>
  <p class="foot">
    From the State timeline buffer: the latest {timeline.data.length.toLocaleString()} sampled changes (every 200 ms) across all signals, since
    {bufferSince === null ? 'unknown (buffer empty)' : formatClock(bufferSince)}.
    Older changes and signals that changed less recently may be missing; counts are not totals or rates. Activate a row to open its component.
    {#if timeline.error}Last refresh failed ({timeline.error}); showing the previous buffer.{/if}
  </p>
  </div>
  {/if}
{/snippet}

{#snippet local()}
  <SplitView id="reactive" open={!!current}>
    <div class="local">
      {#if tab === 'local' && scope}
        <div class="scope-bar">
          <span>
            <strong class="mono">{scope.label}</strong>
            <span class="faint num">#{scope.componentId}</span> and the signals it is directly linked to
          </span>
          <Button icon="close" variant="ghost" label="Clear selection" onclick={clearScope} />
        </div>
      {/if}
      <p class="legend">
        Edges mean <strong>can affect</strong>: a snapshot of current dependencies, not a recorded cause.
        {#if data.edgesOmitted}{data.edgesOmitted.toLocaleString()} edges to signals outside the loaded set are not shown.{/if}
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
          {#if nodes.length > GRAPH_LIMIT}
            <EmptyState icon="graph" title="{nodes.length.toLocaleString()} signals is too many to lay out">
              <p>Pick a single component or filter to under {GRAPH_LIMIT} signals, or use the list view.</p>
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
              <span class="truncate mono value">{n.value === undefined ? '' : nodeValueText(n.value, 120)}</span>
              {#if visible.has('deps')}<span class="end num faint">{links.deps.get(n.id)?.length ?? 0} / {links.dependents.get(n.id)?.length ?? 0}</span>{/if}
            {/snippet}
            {#snippet empty()}<EmptyState icon="search" title="No loaded signals match" />{/snippet}
          </DataTable>
        {/if}
      </div>
    </div>
    {#snippet aside()}
      {#if current}
        <Inspector title={current.name} subtitle={shortPath(current.componentFile, 3)} onclose={() => (selected = null)}>
          {#snippet badges()}
            <Badge tone={tones[current.type]}>${current.type}</Badge>
            <Badge>component #{current.componentId}</Badge>
          {/snippet}
          {#snippet actions()}
            <Button icon="editor" onclick={() => open(current)}>Go to definition (by name)</Button>
            {#if (tab === 'full' || current.componentId !== scope?.componentId) && data.epoch}
              <Button icon="reactive" onclick={() => scopeTo(current)}>Show this component</Button>
            {/if}
          {/snippet}
          {#if current.value !== undefined}
            <h3 class="section-title">Current value</h3>
            <pre class="code-block" class:flash={changed.has(current.id)}>{isValueSummary(current.value) ? current.value : prettyValue(current.value)}</pre>
            {#if !capabilities.valueInspection && isValueSummary(current.value)}
              <p class="none">Full value: not available yet. This dev server reports only a summary for objects and arrays.</p>
            {/if}
          {/if}
          <h3 class="section-title">Cause</h3>
          <p class="none">
            {capabilities.writeCause
              ? 'Recorded writes appear here.'
              : 'Not recorded. This dev server does not capture which write changed a signal; the links below are dependencies, not causes.'}
          </p>
          {@render rel('Reads (can affect this)', links.deps.get(current.id) ?? [])}
          {@render rel('Can affect', links.dependents.get(current.id) ?? [])}
          <h3 class="section-title">History</h3>
          <p class="none">
            {#if current.type === 'state'}
              {#if !capabilities.signalHistory}Per-signal history: not available yet.{/if}
              Sampled changes of all signals (latest 500) are in the
              <button class="link" onclick={() => router.go('timeline')}>State timeline</button>.
            {:else}
              Not recorded for ${current.type}.
            {/if}
          </p>
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
{/snippet}

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
              <span class="sub truncate">{componentName(n.componentFile)}{tab === 'local' && n.componentId !== scope?.componentId ? ' · other component' : ''}</span>
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
  .hint {
    font-size: var(--fs-xs);
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .overview,
  .local {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .table,
  .body {
    flex: 1;
    min-height: 0;
  }
  .record {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    margin: 0;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .record div {
    display: flex;
    gap: 6px;
  }
  .record dt {
    color: var(--fg-faint);
  }
  .record dd {
    margin: 0;
    color: var(--fg-muted);
  }
  .record .warn dd {
    color: var(--yellow);
  }
  .foot,
  .legend,
  .note {
    margin: 0;
    padding: 6px 14px;
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .foot {
    border-top: 1px solid var(--border);
  }
  .baseline {
    margin: 0;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--yellow-bg);
    color: var(--yellow);
    font-size: var(--fs-xs);
  }
  .legend {
    border-bottom: 1px solid var(--border);
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
  .none {
    margin: 0;
    padding: 0 14px;
    color: var(--fg-faint);
    font-size: var(--fs-sm);
  }
</style>
