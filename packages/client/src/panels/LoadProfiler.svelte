<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import DataTable from '../components/DataTable.svelte'
  import Highlight from '../components/Highlight.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import Panel from '../components/Panel.svelte'
  import ResourceEmpty from '../components/ResourceEmpty.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import StatList from '../components/StatList.svelte'
  import type { Column, SortState, Stat, TableRowState } from '../components/types.js'
  import { captureInfo } from '../lib/capture.svelte.js'
  import { uniqueKeys } from '../lib/collections.js'
  import { formatBytes, formatClock, formatMs } from '../lib/format.js'
  import { matcher } from '../lib/match.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getLoadProfiles, clearLoadProfiles, openInEditor } from '../lib/rpc.js'
  import type { LoadProfile } from '../lib/types.js'
  import { datasetVersion } from '../lib/versions.js'

  const SLOW_MS = 100

  const loads = resource<LoadProfile[]>(getLoadProfiles, {
    initial: [],
    interval: 2000,
    version: datasetVersion('loadProfiles'),
  })

  const capture = captureInfo(2000)
  let query = $state('')
  let type = $state<'all' | LoadProfile['type']>('all')
  let slowOnly = $state(false)
  let sort = $state<SortState | null>({ id: 'time', desc: true })
  let selected = $state<string | null>(null)

  const keyed = $derived.by(() => {
    const keys = uniqueKeys(loads.data, p => `${p.timestamp}:${p.route}:${p.type}`)
    return loads.data.map((p, i) => ({ ...p, key: keys[i]! }))
  })
  type Row = (typeof keyed)[number]

  const rows = $derived.by(() => {
    const m = matcher(query)
    return keyed.filter(
      p =>
        (type === 'all' || p.type === type) &&
        (!slowOnly || p.duration > SLOW_MS) &&
        (!m || m(p.route, p.file)),
    )
  })

  const stats = $derived.by<Stat[] | null>(() => {
    const d = rows.map(r => r.duration).sort((a, b) => a - b)
    if (!d.length) return null
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(p * d.length))]!
    const slowTone = (ms: number) => (ms > SLOW_MS ? 'red' : null)
    const slow = d.filter(x => x > SLOW_MS).length
    return [
      { label: 'Calls', value: d.length.toLocaleString() },
      { label: 'Average', value: formatMs(d.reduce((s, x) => s + x, 0) / d.length) },
      { label: 'p50', value: formatMs(q(0.5)) },
      { label: 'p95', value: formatMs(q(0.95)), tone: slowTone(q(0.95)) },
      { label: 'Max', value: formatMs(d.at(-1)), tone: slowTone(d.at(-1)!) },
      { label: `> ${SLOW_MS} ms`, value: slow, tone: slow > 0 ? 'red' : null },
    ]
  })

  const maxDuration = $derived(keyed.reduce((m, p) => Math.max(m, p.duration), 1))
  const slowTotal = $derived(loads.data.filter(p => p.duration > SLOW_MS).length)

  const columns: Column<Row>[] = [
    {
      id: 'route',
      label: 'Route',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.route.localeCompare(b.route),
    },
    { id: 'type', label: 'Type', width: '84px', sort: (a, b) => a.type.localeCompare(b.type) },
    {
      id: 'duration',
      label: 'Duration',
      width: 'minmax(140px, 0.6fr)',
      descFirst: true,
      sort: (a, b) => a.duration - b.duration,
    },
    {
      id: 'size',
      label: 'Data',
      width: '80px',
      align: 'end',
      descFirst: true,
      minWidth: 620,
      sort: (a, b) => a.dataSize - b.dataSize,
    },
    {
      id: 'time',
      label: 'At',
      width: '76px',
      align: 'end',
      descFirst: true,
      minWidth: 520,
      sort: (a, b) => a.timestamp - b.timestamp,
    },
  ]

  async function clear() {
    await clearLoadProfiles().catch(() => {})
    loads.set([])
  }
</script>

<Panel title="Load functions" count={loads.data.length}>
  {#snippet toolbar()}
    <Segmented
      label="Load type"
      bind:value={type}
      options={[
        { value: 'all', label: 'All' },
        { value: 'server', label: 'Server' },
        { value: 'universal', label: 'Universal' },
      ]}
    />
    <SearchField bind:value={query} placeholder="Filter routes…" count={rows.length} />
    <CaptureNotice info={capture.data.loadProfiles} noun="load calls" />
    <Button
      icon="warning"
      pressed={slowOnly}
      onclick={() => (slowOnly = !slowOnly)}
      title="Only loads slower than {SLOW_MS} ms"
    >
      Slow {slowTotal ? `(${slowTotal})` : ''}
    </Button>
  {/snippet}
  {#snippet actions()}
    <LiveControls res={loads} onclear={clear} />
  {/snippet}

  <div class="layout">
    {#if stats}<StatList items={stats} variant="strip" />{/if}
    <div class="table">
      <DataTable
        items={rows}
        {columns}
        getKey={(r: Row) => r.key}
        bind:sort
        bind:selected
        label="Load function calls"
        onactivate={(r: Row) => openInEditor(r.file).catch(() => {})}
      >
        {#snippet row(p: Row, { visible }: TableRowState)}
          <span class="truncate mono route" title={p.file}
            ><Highlight text={p.route} {query} /></span
          >
          <span><Badge tone={p.type === 'server' ? 'blue' : 'cyan'}>{p.type}</Badge></span>
          <span class="dur">
            <span class="track"
              ><span
                class="bar"
                class:slow={p.duration > SLOW_MS}
                style:width="{Math.max(1.5, (p.duration / maxDuration) * 100)}%"
              ></span></span
            >
            <span class="num" class:slow={p.duration > SLOW_MS}>{formatMs(p.duration)}</span>
          </span>
          {#if visible.has('size')}<span class="end num muted">{formatBytes(p.dataSize)}</span>{/if}
          {#if visible.has('time')}<span class="end num faint">{formatClock(p.timestamp)}</span
            >{/if}
        {/snippet}
        {#snippet empty()}
          <ResourceEmpty
            res={loads}
            total={loads.data.length}
            loading="Waiting for load calls…"
            failed="Could not load load-function timings"
            icon="loads"
            title="No load calls recorded yet"
            noMatch="No loads match"
          >
            <p>Navigate between routes in your app to time their <code>load</code> functions.</p>
          </ResourceEmpty>
        {/snippet}
      </DataTable>
    </div>
  </div>
</Panel>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .table {
    flex: 1;
    min-height: 0;
  }
  .route {
    font-size: var(--fs-xs);
  }
  .dur {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .track {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-active);
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--blue);
  }
  .bar.slow {
    background: var(--red);
  }
  .dur .num {
    width: 64px;
    text-align: right;
    font-size: var(--fs-xs);
  }
  .slow {
    color: var(--red);
  }
</style>
