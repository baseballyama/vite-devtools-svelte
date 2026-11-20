<script lang="ts">
  import Button from '../components/Button.svelte';
  import CaptureNotice from '../components/CaptureNotice.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Highlight from '../components/Highlight.svelte';
  import Icon from '../components/Icon.svelte';
  import Panel from '../components/Panel.svelte';
  import ResourceEmpty from '../components/ResourceEmpty.svelte';
  import SearchField from '../components/SearchField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import StatList from '../components/StatList.svelte';
  import type { Column, SortState, Stat, TableRowState } from '../components/types.js';
  import { captureInfo } from '../lib/capture-info.js';
  import { uniqueKeys } from '../lib/collections.js';
  import { datasetVersion } from '../lib/dataset-versions.js';
  import { basename, formatBytes, formatClock, formatMs } from '../lib/format.js';
  import { matcher } from '../lib/match.js';
  import { resource } from '../lib/resource.svelte.js';
  import { getLoadProfiles, clearLoadProfiles, openInEditor } from '../lib/rpc.js';
  import type { LoadProfile } from '../lib/types.js';

  const SLOW_MS = 100;

  const loads = resource<LoadProfile[]>(getLoadProfiles, {
    initial: [],
    interval: 2000,
    version: datasetVersion('loadProfiles'),
  });

  const capture = captureInfo(2000);
  let query = $state('');
  let type = $state<'all' | LoadProfile['type']>('all');
  let sort = $state<SortState | null>({ id: 'time', desc: true });
  let selected = $state<string | null>(null);

  const keyed = $derived.by(() => {
    const keys = uniqueKeys(loads.data, p => `${p.timestamp}:${p.route}:${p.file}`);
    return loads.data.map((p, i) => ({ ...p, name: basename(p.file), key: keys[i]! }));
  });
  type Row = (typeof keyed)[number];

  const rows = $derived.by(() => {
    const m = matcher(query);
    return keyed.filter(p => (type === 'all' || p.type === type) && (!m || m(p.route, p.name)));
  });

  const stats = $derived.by<Stat[] | null>(() => {
    const d = rows.map(r => r.duration).sort((a, b) => a - b);
    if (!d.length) return null;
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(p * d.length))]!;
    const slowTone = (ms: number) => (ms > SLOW_MS ? 'red' : null);
    const slow = d.filter(x => x > SLOW_MS).length;
    return [
      { label: 'Calls', value: d.length.toLocaleString() },
      { label: 'Average', value: formatMs(d.reduce((s, x) => s + x, 0) / d.length) },
      { label: 'p50', value: formatMs(q(0.5)) },
      { label: 'p95', value: formatMs(q(0.95)), tone: slowTone(q(0.95)) },
      { label: 'Max', value: formatMs(d.at(-1)), tone: slowTone(d.at(-1)!) },
      { label: `> ${SLOW_MS} ms`, value: slow, tone: slow > 0 ? 'red' : null },
    ];
  });

  const maxDuration = $derived(keyed.reduce((m, p) => Math.max(m, p.duration), 1));

  const columns: Column<Row>[] = [
    {
      id: 'route',
      label: 'Route',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.route.localeCompare(b.route),
    },
    {
      id: 'file',
      label: 'File',
      width: 'minmax(0, 168px)',
      sort: (a, b) => a.name.localeCompare(b.name),
    },
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
  ];

  const open = (r: Row) => openInEditor(r.file).catch(() => {});

  async function clear() {
    await clearLoadProfiles().catch(() => {});
    loads.set([]);
  }
</script>

<Panel title="Load functions">
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
    <SearchField bind:value={query} placeholder="Filter routes or files…" count={rows.length} />
    <CaptureNotice info={capture.data.loadProfiles} noun="load calls" />
  {/snippet}
  {#snippet actions()}
    <Button icon="trash" variant="ghost" label="Clear recorded data" onclick={clear} />
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
        onrowkeydown={(e: KeyboardEvent, r: Row) => e.key === 'Enter' && (open(r), true)}
      >
        {#snippet row(p: Row, { visible }: TableRowState)}
          <span class="truncate mono route"><Highlight text={p.route} {query} /></span>
          <span class="cell">
            <!-- The list is one tab stop (Enter on a row opens its file), so the
                 chip is a mouse target only and never takes focus from it. -->
            <button
              type="button"
              class="file"
              tabindex="-1"
              title="Open in editor: {p.file}"
              onmousedown={e => e.preventDefault()}
              onclick={e => (e.stopPropagation(), open(p))}
              ><Icon name="editor" size={12} /><span class="name mono"
                ><Highlight text={p.name} {query} /></span
              ></button
            >
          </span>
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
  .cell {
    min-width: 0;
  }
  .file {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .file:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--fg);
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
