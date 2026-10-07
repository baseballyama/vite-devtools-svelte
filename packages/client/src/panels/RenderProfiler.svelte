<script lang="ts">
  import { datasetVersion } from '../lib/versions.js'
  import { getRenderProfiles, openInEditor } from '../lib/rpc.js'
  import type { RenderProfile } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { matcher } from '../lib/match.js'
  import { formatMs, formatClock, shortPath } from '../lib/format.js'
  import Panel from '../components/Panel.svelte'
  import SplitView from '../components/SplitView.svelte'
  import DataTable, { type Column, type SortState } from '../components/DataTable.svelte'
  import Inspector from '../components/Inspector.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import Button from '../components/Button.svelte'
  import Badge from '../components/Badge.svelte'
  import Highlight from '../components/Highlight.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import { captureInfo } from '../lib/capture.svelte.js'

  const profiles = resource<RenderProfile[]>(getRenderProfiles, { initial: [], interval: 1000, version: datasetVersion('renderProfiles') })

  const capture = captureInfo(1000)

  // Instances of the same component file can be folded together, which is
  // what you usually want in a big app (1 000 <Row> instances → one line).
  let group = $state<'instance' | 'component'>('component')
  let query = $state('')
  let sort = $state<SortState | null>({ id: 'total', desc: true })
  let selected = $state<string | null>(null)

  interface Row {
    key: string
    name: string
    file: string
    instances: number
    initTime: number
    renderCount: number
    totalRenderTime: number
    lastRenderTime: number
    lastRenderAt: number
    ids: number[]
  }

  const all = $derived.by<Row[]>(() => {
    if (group === 'instance') {
      return profiles.data.map((p) => ({
        key: String(p.componentId),
        name: p.name,
        file: p.file,
        instances: 1,
        initTime: p.initTime,
        renderCount: p.renderCount,
        totalRenderTime: p.totalRenderTime,
        lastRenderTime: p.lastRenderTime,
        lastRenderAt: p.lastRenderAt,
        ids: [p.componentId],
      }))
    }
    const m = new Map<string, Row>()
    for (const p of profiles.data) {
      const r = m.get(p.file)
      if (!r) {
        m.set(p.file, { key: p.file, name: p.name, file: p.file, instances: 1, initTime: p.initTime, renderCount: p.renderCount, totalRenderTime: p.totalRenderTime, lastRenderTime: p.lastRenderTime, lastRenderAt: p.lastRenderAt, ids: [p.componentId] })
      } else {
        r.instances++
        r.initTime += p.initTime
        r.renderCount += p.renderCount
        r.totalRenderTime += p.totalRenderTime
        r.ids.push(p.componentId)
        if (p.lastRenderAt > r.lastRenderAt) {
          r.lastRenderAt = p.lastRenderAt
          r.lastRenderTime = p.lastRenderTime
        }
      }
    }
    return [...m.values()]
  })

  const rows = $derived.by(() => {
    const m = matcher(query)
    return m ? all.filter((r) => m(r.name, r.file)) : all
  })

  const maxTotal = $derived(all.reduce((m, r) => Math.max(m, r.totalRenderTime), 0.0001))
  const totals = $derived(all.reduce((s, r) => ({ renders: s.renders + r.renderCount, time: s.time + r.totalRenderTime }), { renders: 0, time: 0 }))
  const current = $derived(selected ? (all.find((r) => r.key === selected) ?? null) : null)

  const avg = (r: Row) => (r.renderCount ? r.totalRenderTime / r.renderCount : 0)

  const columns: Column<Row>[] = [
    { id: 'name', label: 'Component', width: 'minmax(0, 1fr)', sort: (a, b) => a.name.localeCompare(b.name) },
    { id: 'instances', label: 'Inst.', width: '52px', align: 'end', descFirst: true, minWidth: 640, sort: (a, b) => a.instances - b.instances },
    { id: 'init', label: 'Init', width: '72px', align: 'end', descFirst: true, minWidth: 720, sort: (a, b) => a.initTime - b.initTime },
    { id: 'renders', label: 'Renders', width: '68px', align: 'end', descFirst: true, sort: (a, b) => a.renderCount - b.renderCount },
    { id: 'avg', label: 'Avg', width: '72px', align: 'end', descFirst: true, minWidth: 560, sort: (a, b) => avg(a) - avg(b) },
    { id: 'total', label: 'Total', width: '150px', align: 'end', descFirst: true, sort: (a, b) => a.totalRenderTime - b.totalRenderTime },
  ]

  function heat(ms: number) {
    return ms >= 16 ? 'hot' : ms >= 4 ? 'warm' : ''
  }
</script>

<Panel title="Render" count={profiles.data.length}>
  {#snippet toolbar()}
    <Segmented
      label="Group by"
      bind:value={group}
      options={[
        { value: 'component', label: 'By component' },
        { value: 'instance', label: 'By instance' },
      ]}
    />
    <SearchField bind:value={query} placeholder="Filter components…" count={rows.length} />
    <CaptureNotice info={capture.data.renderProfiles} noun="profiles" />
    <span class="summary num">{totals.renders.toLocaleString()} renders · {formatMs(totals.time)}</span>
  {/snippet}
  {#snippet actions()}
    <LiveControls res={profiles} />
  {/snippet}

  <SplitView id="render" open={!!current}>
    <DataTable items={rows} {columns} getKey={(r) => r.key} bind:sort bind:selected label="Render profiles" onactivate={(r) => openInEditor(r.file).catch(() => {})}>
      {#snippet row(r, { visible })}
        <span class="name">
          <span class="cname"><Highlight text={r.name} {query} /></span>
          <span class="file truncate"><Highlight text={shortPath(r.file)} {query} /></span>
        </span>
        {#if visible.has('instances')}<span class="end num muted">{r.instances}</span>{/if}
        {#if visible.has('init')}<span class="end num muted">{formatMs(r.initTime)}</span>{/if}
        <span class="end num">{r.renderCount.toLocaleString()}</span>
        {#if visible.has('avg')}<span class="end num {heat(avg(r))}">{formatMs(avg(r))}</span>{/if}
        <span class="total end">
          <span class="bar {heat(avg(r))}" style:width="{Math.max(2, (r.totalRenderTime / maxTotal) * 60)}px"></span>
          <span class="num">{formatMs(r.totalRenderTime)}</span>
        </span>
      {/snippet}
      {#snippet empty()}
        {#if profiles.loading}
          <EmptyState title="Waiting for render data…" />
        {:else if profiles.data.length === 0}
          <EmptyState icon="render" title="No renders recorded yet"><p>Interact with your app — every component mount and update is timed.</p></EmptyState>
        {:else}
          <EmptyState icon="search" title="No components match" />
        {/if}
      {/snippet}
    </DataTable>
    {#snippet aside()}
      {#if current}
        <Inspector title={current.name} subtitle={current.file} onclose={() => (selected = null)}>
          {#snippet badges()}
            {#if group === 'component'}<Badge>{current.instances} instance{current.instances === 1 ? '' : 's'}</Badge>{/if}
            {#if avg(current) >= 16}<Badge tone="red">over frame budget</Badge>{:else if avg(current) >= 4}<Badge tone="yellow">slow</Badge>{/if}
          {/snippet}
          {#snippet actions()}
            <Button icon="editor" onclick={() => openInEditor(current.file).catch(() => {})}>Open in editor</Button>
          {/snippet}
          <div class="stats">
            <div><span>Renders</span><strong class="num">{current.renderCount.toLocaleString()}</strong></div>
            <div><span>Total</span><strong class="num">{formatMs(current.totalRenderTime)}</strong></div>
            <div><span>Average</span><strong class="num {heat(avg(current))}">{formatMs(avg(current))}</strong></div>
            <div><span>Last</span><strong class="num {heat(current.lastRenderTime)}">{formatMs(current.lastRenderTime)}</strong></div>
            <div><span>Init{group === 'component' ? ' (sum)' : ''}</span><strong class="num">{formatMs(current.initTime)}</strong></div>
            <div><span>Last render</span><strong class="num">{current.lastRenderAt ? formatClock(current.lastRenderAt) : '—'}</strong></div>
          </div>
          <p class="note">Share of all render time: <strong class="num">{((current.totalRenderTime / Math.max(totals.time, 0.0001)) * 100).toFixed(1)}%</strong></p>
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

<style>
  .summary {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .cname {
    font-weight: 500;
    white-space: nowrap;
  }
  .file {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .total {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--green);
    opacity: 0.7;
  }
  .bar.warm {
    background: var(--yellow);
  }
  .bar.hot {
    background: var(--red);
  }
  .warm {
    color: var(--yellow);
  }
  .hot {
    color: var(--red);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 1px;
    margin: 12px 14px 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--border);
  }
  .stats div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    background: var(--bg-subtle);
  }
  .stats span {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .stats strong {
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .note {
    margin: 12px 14px 0;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
  }
</style>
