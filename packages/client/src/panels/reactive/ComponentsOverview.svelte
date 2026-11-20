<script lang="ts">
  import Button from '../../components/Button.svelte';
  import DataTable from '../../components/DataTable.svelte';
  import EmptyState from '../../components/EmptyState.svelte';
  import Inspector from '../../components/Inspector.svelte';
  import SplitView from '../../components/SplitView.svelte';
  import type { Column, SortState, TableRowState } from '../../components/types.js';
  import { componentName, formatAgo, formatMs, shortPath } from '../../lib/format.js';
  import { reactiveScope } from '../../lib/reactive-scope.svelte.js';
  import {
    baselineNotice,
    groupByFile,
    nodeCount,
    staleLabel,
    totalLabel,
  } from '../../lib/reactive.js';
  import type { Resource } from '../../lib/resource.svelte.js';
  import type { ReactiveSummary, ReactiveSummaryRow } from '../../lib/types.js';

  let {
    summary,
    group,
    onfullgraph,
  }: {
    summary: Resource<ReactiveSummary | null>;
    group: 'file' | 'instance';
    onfullgraph: () => void;
  } = $props();

  let sort = $state<SortState | null>({ id: 'changes', desc: true });
  let selected = $state<string | null>(null);

  interface OverviewRow {
    key: string;
    file: string;
    instances: ReactiveSummaryRow[];
    nodes: ReactiveSummaryRow['nodes'];
    changes: number;
    renders: number;
    renderMs: number;
    lastActiveAt: number | null;
  }

  const rows = $derived.by<OverviewRow[]>(() => {
    const rows = summary.data?.rows ?? [];
    if (group === 'file') return groupByFile(rows).map(g => ({ key: g.file, ...g }));
    return rows.map(r => ({
      key: `#${r.componentId}`,
      file: r.file,
      instances: [r],
      nodes: r.nodes,
      changes: r.changes,
      renders: r.renders,
      renderMs: r.renderMs,
      lastActiveAt: r.lastActiveAt,
    }));
  });
  const current = $derived(selected ? (rows.find(r => r.key === selected) ?? null) : null);

  const columns: Column<OverviewRow>[] = [
    {
      id: 'component',
      label: 'Component',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.file.localeCompare(b.file),
    },
    {
      id: 'instances',
      label: 'Inst.',
      width: '52px',
      align: 'end',
      descFirst: true,
      minWidth: 560,
      sort: (a, b) => a.instances.length - b.instances.length,
    },
    {
      id: 'nodes',
      label: 'Signals',
      width: '72px',
      align: 'end',
      descFirst: true,
      minWidth: 640,
      sort: (a, b) => nodeCount(a.nodes) - nodeCount(b.nodes),
    },
    {
      id: 'changes',
      label: 'Changes',
      width: '84px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.changes - b.changes,
    },
    {
      id: 'renders',
      label: 'Renders',
      width: '72px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.renders - b.renders,
    },
    {
      id: 'renderMs',
      label: 'Render time',
      width: '96px',
      align: 'end',
      descFirst: true,
      minWidth: 720,
      sort: (a, b) => a.renderMs - b.renderMs,
    },
    {
      id: 'lastActive',
      label: 'Last active',
      width: '84px',
      align: 'end',
      descFirst: true,
      minWidth: 800,
      sort: (a, b) => (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0),
    },
  ];

  /** Scoped selections need the page load the id belongs to; without one there is nothing to validate. */
  function select(r: ReactiveSummaryRow, epoch: string | null) {
    if (epoch) reactiveScope.scopeTo(r.componentId, r.file, epoch);
  }
</script>

{#if !summary.data && summary.error}
  <EmptyState icon="warning" title="Overview not available">
    <p>
      The dev server did not return per-component activity ({summary.error}). Pick a component in
      Components (Show reactivity) or open the full graph.
    </p>
    <Button icon="graph" onclick={onfullgraph}>Full graph</Button>
  </EmptyState>
{:else if !summary.data}
  <EmptyState title="Reading activity…" />
{:else}
  {@const s = summary.data}
  {@const baseline = baselineNotice(s.baseline)}
  {@const stale = staleLabel(s)}
  <div class="overview">
    <p class="record">
      {totalLabel(s.components.total)} components · {s.components.withActivity.toLocaleString()} active
      since mount
    </p>
    {#if baseline}<p class="record warn">{baseline}</p>{/if}
    {#if stale}<p class="record warn">{stale}</p>{/if}
    <div class="table">
      <SplitView id="reactive-overview" open={!!current}>
        <DataTable
          items={rows}
          {columns}
          getKey={(r: OverviewRow) => r.key}
          bind:sort
          bind:selected
          label="Most active components"
          onactivate={(r: OverviewRow) =>
            r.instances.length === 1 && select(r.instances[0]!, s.epoch)}
        >
          {#snippet row(r: OverviewRow, { visible }: TableRowState)}
            <span class="truncate">
              <span class="mono">{componentName(r.file)}</span>
              {#if group === 'instance'}<span class="faint num"
                  >{` #${r.instances[0]!.componentId}`}</span
                >{/if}
            </span>
            {#if visible.has('instances')}<span class="end num">{r.instances.length}</span>{/if}
            {#if visible.has('nodes')}
              <span
                class="end num faint"
                title="registered: {r.nodes.state} $state · {r.nodes.derived} $derived · {r.nodes
                  .effect} $effect">{nodeCount(r.nodes)}</span
              >
            {/if}
            <span
              class="end num"
              title="at least this many changes since mount (sampled every 200 ms); not a rate"
              >≥ {r.changes.toLocaleString()}</span
            >
            <span class="end num">{r.renders.toLocaleString()}</span>
            {#if visible.has('renderMs')}<span class="end num faint">{formatMs(r.renderMs)}</span
              >{/if}
            {#if visible.has('lastActive')}<span class="end num faint"
                >{formatAgo(r.lastActiveAt, s.computedAt ?? Date.now())}</span
              >{/if}
          {/snippet}
          {#snippet empty()}<EmptyState
              icon="reactive"
              title="No live component has changed or rendered yet"
            />{/snippet}
        </DataTable>
        {#snippet aside()}
          {#if current}
            <Inspector
              title="<{componentName(current.file)}>"
              subtitle={shortPath(current.file, 3)}
              onclose={() => (selected = null)}
            >
              <h3 class="section-title">
                Listed instances <span class="num">{current.instances.length}</span>
              </h3>
              <ul class="link-list">
                {#each current.instances as r (r.componentId)}
                  <li>
                    <button type="button" disabled={!s.epoch} onclick={() => select(r, s.epoch)}>
                      <span class="mono">#{r.componentId}</span>
                      <span class="sub"
                        >≥ {r.changes.toLocaleString()} changes · {r.renders.toLocaleString()} renders</span
                      >
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
      Listed: {s.rows.length.toLocaleString()}
      {s.rows.length === 1 ? 'component' : 'components'} ({s.truncated
        ? `top ${s.rows.length} of ${s.components.withActivity.toLocaleString()} active`
        : 'all active'}).
      {#if s.other}Other: {s.other.components.toLocaleString()} components with {s.other.nodes.toLocaleString()}
        signals.{:else}Other: unknown.{/if}
      Total registered: {totalLabel(s.components.total)}. Counts restart when an instance is
      destroyed or the app page reloads.
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
  .record {
    margin: 0;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .record.warn {
    color: var(--yellow);
  }
  .foot,
  .note {
    margin: 0;
    padding: 6px 14px;
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .foot {
    border-top: 1px solid var(--border);
  }
</style>
