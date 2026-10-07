<script lang="ts">
  import DataTable from '../../components/DataTable.svelte'
  import EmptyState from '../../components/EmptyState.svelte'
  import type { Column, SortState, TableRowState } from '../../components/types.js'
  import { componentName, formatClock, formatValue } from '../../lib/format.js'
  import { reactiveScope } from '../../lib/reactive-selection.svelte.js'
  import type { HotState } from '../../lib/reactive.js'
  import type { Resource } from '../../lib/resource.svelte.js'
  import { getLiveComponentsMeta } from '../../lib/rpc.js'
  import type { StateTimelineEntry } from '../../lib/types.js'

  /**
   * Hot states: the server's timeline buffer grouped by signal. It is the
   * latest changes across all signals, sampled every 200 ms, so counts are
   * "seen in the buffer", not totals or rates.
   */
  let {
    timeline,
    states,
    baseline,
  }: {
    timeline: Resource<StateTimelineEntry[]>
    states: HotState[]
    /** Baseline disclosure of the timeline capture, if any. */
    baseline: string | null
  } = $props()

  let sort = $state<SortState | null>({ id: 'changes', desc: true })
  let selected = $state<string | null>(null)

  const bufferSince = $derived(timeline.data.length ? timeline.data[0]!.timestamp : null)

  const columns: Column<HotState>[] = [
    {
      id: 'name',
      label: 'State',
      width: 'minmax(120px, 1fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'component',
      label: 'Component',
      width: 'minmax(0, 1fr)',
      minWidth: 560,
      sort: (a, b) => a.file.localeCompare(b.file),
    },
    {
      id: 'changes',
      label: 'Changes',
      width: '84px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.changes - b.changes,
    },
    { id: 'value', label: 'Last value', width: 'minmax(0, 1fr)', minWidth: 680 },
    {
      id: 'at',
      label: 'Last seen',
      width: '96px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.last.seq - b.last.seq,
    },
  ]

  // Timeline entries carry no page-load id, so the selection takes the served
  // epoch at the moment of the click; the server refuses the scoped request if
  // it no longer matches (staleReason 'epoch-changed').
  async function open(h: HotState) {
    if (h.componentId === null) return
    const epoch = (await getLiveComponentsMeta().catch(() => null))?.epoch
    if (epoch) reactiveScope.scopeTo(h.componentId, h.file, epoch)
  }
</script>

{#if !timeline.data.length && timeline.error}
  <EmptyState icon="warning" title="State timeline not available">
    <p>The dev server did not return the timeline buffer ({timeline.error}).</p>
  </EmptyState>
{:else}
  <div class="overview">
    {#if baseline}<p class="baseline" role="status">{baseline}</p>{/if}
    <div class="table">
      <DataTable
        items={states}
        {columns}
        getKey={(h: HotState) => h.key}
        bind:sort
        bind:selected
        label="Most changed states in the timeline buffer"
        onactivate={open}
      >
        {#snippet row(h: HotState, { visible }: TableRowState)}
          <span class="truncate mono name">{h.name}</span>
          {#if visible.has('component')}<span class="truncate muted"
              >{componentName(h.file)}{#if h.componentId !== null}<span class="faint num"
                  >{` #${h.componentId}`}</span
                >{/if}</span
            >{/if}
          <span
            class="end num"
            title="changes of this state in the buffer (sampled every 200 ms); not a total or a rate"
            >≥ {h.changes.toLocaleString()}</span
          >
          {#if visible.has('value')}<span class="truncate mono value"
              >{formatValue(h.last.newValue, 80)}</span
            >{/if}
          <span class="end num faint">{formatClock(h.last.timestamp)}</span>
        {/snippet}
        {#snippet empty()}<EmptyState
            icon="timeline"
            title={timeline.loading ? 'Reading the timeline…' : 'No $state changes in the buffer'}
          />{/snippet}
      </DataTable>
    </div>
    <p class="foot">
      From the State timeline buffer: the latest {timeline.data.length.toLocaleString()} sampled changes
      (every 200 ms) across all signals, since
      {bufferSince === null ? 'unknown (buffer empty)' : formatClock(bufferSince)}. Older changes
      and signals that changed less recently may be missing; counts are not totals or rates.
      Activate a row to open its component.
      {#if timeline.error}Last refresh failed ({timeline.error}); showing the previous buffer.{/if}
    </p>
  </div>
{/if}

<style>
  .overview {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .table {
    flex: 1;
    min-height: 0;
  }
  .baseline {
    margin: 0;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--yellow-bg);
    color: var(--yellow);
    font-size: var(--fs-xs);
  }
  .foot {
    margin: 0;
    padding: 6px 14px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .name {
    font-size: var(--fs-sm);
  }
  .value {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
</style>
