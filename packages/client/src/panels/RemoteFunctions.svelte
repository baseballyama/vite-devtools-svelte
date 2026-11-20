<script lang="ts">
  import Badge from '../components/Badge.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Highlight from '../components/Highlight.svelte';
  import Icon from '../components/Icon.svelte';
  import Panel from '../components/Panel.svelte';
  import RefreshButton from '../components/RefreshButton.svelte';
  import ResourceEmpty from '../components/ResourceEmpty.svelte';
  import SearchField from '../components/SearchField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import type { Column, SortState, TableRowState, Tone } from '../components/types.js';
  import { countBy } from '../lib/collections.js';
  import { basename } from '../lib/format.js';
  import { kindOptions } from '../lib/kind-options.js';
  import { matcher } from '../lib/match.js';
  import { resource } from '../lib/resource.svelte.js';
  import { getRemoteFunctions, openInEditor } from '../lib/rpc.js';
  import type { RemoteFunctionInfo, RemoteFunctionsResult } from '../lib/types.js';

  // Polled: an entry gains its id once the app loads its module.
  const remote = resource<RemoteFunctionsResult | null>(getRemoteFunctions, {
    initial: null,
    interval: 3000,
  });

  const KINDS: Record<string, { label: string; tone: Tone; group: Group }> = {
    query: { label: 'query', tone: 'blue', group: 'query' },
    query_batch: { label: 'query.batch', tone: 'blue', group: 'query' },
    query_live: { label: 'query.live', tone: 'cyan', group: 'query' },
    command: { label: 'command', tone: 'purple', group: 'command' },
    form: { label: 'form', tone: 'green', group: 'form' },
    prerender: { label: 'prerender', tone: 'yellow', group: 'prerender' },
  };
  const GROUPS = ['query', 'command', 'form', 'prerender', 'other'] as const;
  type Group = (typeof GROUPS)[number];
  const GROUP_LABELS: Record<Group, string> = {
    query: 'Queries',
    command: 'Commands',
    form: 'Forms',
    prerender: 'Prerender',
    other: 'Other',
  };
  const kindOf = (type: string) =>
    KINDS[type] ?? { label: type, tone: 'neutral' as Tone, group: 'other' as Group };

  // open-in-editor only serves files inside the project root; a workspace
  // package linked into node_modules resolves outside it.
  const outsideRoot = (file: string) =>
    file.startsWith('../') || file.startsWith('/') || file[1] === ':';

  let query = $state('');
  let group = $state<'all' | Group>('all');
  let sort = $state<SortState | null>({ id: 'source', desc: false });
  let selected = $state<string | null>(null);

  const functions = $derived(remote.data?.functions ?? []);
  const errors = $derived(remote.data?.errors ?? []);

  const keyed = $derived(
    functions.map(f => ({ ...f, key: `${f.file}#${f.name}`, fileName: basename(f.file) })),
  );
  type Row = (typeof keyed)[number];

  const groupOptions = $derived(
    kindOptions(
      GROUPS,
      countBy(functions, f => kindOf(f.type).group),
      group,
      g => GROUP_LABELS[g],
    ),
  );

  const rows = $derived.by(() => {
    const m = matcher(query);
    return keyed.filter(
      f =>
        (group === 'all' || kindOf(f.type).group === group) &&
        (!m || m(f.name, f.file, f.package ?? '', f.id ?? '')),
    );
  });

  const columns: Column<Row>[] = [
    {
      id: 'name',
      label: 'Function',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'kind',
      label: 'Kind',
      width: '96px',
      sort: (a, b) => kindOf(a.type).label.localeCompare(kindOf(b.type).label),
    },
    {
      id: 'source',
      label: 'Source',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
    },
    {
      id: 'endpoint',
      label: 'Endpoint',
      width: 'minmax(0, 0.8fr)',
      minWidth: 640,
      sort: (a, b) => Number(b.loaded) - Number(a.loaded),
    },
  ];

  const open = (f: Pick<RemoteFunctionInfo, 'file' | 'line'>) => {
    if (!outsideRoot(f.file)) openInEditor(f.file, f.line).catch(() => {});
  };
</script>

<Panel title="Remote functions">
  {#snippet toolbar()}
    <Segmented label="Kind" bind:value={group} options={groupOptions} />
    <SearchField bind:value={query} placeholder="Filter functions or files…" count={rows.length} />
  {/snippet}
  {#snippet actions()}
    <RefreshButton res={remote} label="Rescan remote functions" />
  {/snippet}

  {#if remote.data && !remote.data.enabled}
    <EmptyState icon="remote" title="Remote functions are off">
      <p>
        Set <code>experimental.remoteFunctions</code> to <code>true</code> in your SvelteKit config.
      </p>
    </EmptyState>
  {:else}
    <div class="layout">
      {#if errors.length > 0}
        <div class="errors" role="status">
          <Icon name="warning" size={14} />
          <span>Could not parse:</span>
          {#each errors as e (e.file)}
            <button
              type="button"
              class="file"
              title="{e.message}: {e.file}"
              disabled={outsideRoot(e.file)}
              onclick={() => open(e)}><span class="mono truncate">{e.file}</span></button
            >
          {/each}
        </div>
      {/if}
      <div class="table">
        <DataTable
          items={rows}
          {columns}
          getKey={(r: Row) => r.key}
          bind:sort
          bind:selected
          label="Remote functions"
          onrowkeydown={(e: KeyboardEvent, r: Row) => e.key === 'Enter' && (open(r), true)}
        >
          {#snippet row(f: Row, { visible }: TableRowState)}
            <span class="truncate mono name"><Highlight text={f.name} {query} /></span>
            <span><Badge tone={kindOf(f.type).tone}>{kindOf(f.type).label}</Badge></span>
            <span class="cell source">
              <!-- The list is one tab stop (Enter on a row opens its file), so the
                   chip is a mouse target only and never takes focus from it. -->
              <button
                type="button"
                class="file"
                tabindex="-1"
                disabled={outsideRoot(f.file)}
                title={outsideRoot(f.file)
                  ? `Outside the project root, so it cannot be opened: ${f.file}`
                  : `Open in editor: ${f.file}${f.line ? `:${f.line}` : ''}`}
                onmousedown={e => e.preventDefault()}
                onclick={e => (e.stopPropagation(), open(f))}
                ><Icon name="editor" size={12} /><span class="mono truncate"
                  ><Highlight text={f.fileName} {query} />{#if f.line}<span class="faint"
                      >:{f.line}</span
                    >{/if}</span
                ></button
              >
              {#if f.package}<Badge title="Shipped by this package"
                  ><Highlight text={f.package} {query} /></Badge
                >{/if}
            </span>
            {#if visible.has('endpoint')}
              {#if f.id}
                <span class="truncate mono muted endpoint" title="/_app/remote/{f.id}"
                  ><Highlight text={f.id} {query} /></span
                >
              {:else}
                <span class="faint" title="The app has not loaded this module yet"
                  >Not loaded yet</span
                >
              {/if}
            {/if}
          {/snippet}
          {#snippet empty()}
            <ResourceEmpty
              res={remote}
              total={functions.length}
              loading="Looking for remote functions…"
              failed="Could not list remote functions"
              icon="remote"
              title="No remote functions"
              noMatch="No remote functions match"
            >
              <p>
                Export <code>query</code>, <code>command</code>, <code>form</code> or
                <code>prerender</code> functions from a <code>.remote.ts</code> file to see them here.
              </p>
            </ResourceEmpty>
          {/snippet}
        </DataTable>
      </div>
    </div>
  {/if}
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
  .errors {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--yellow-bg);
    color: var(--yellow);
    font-size: var(--fs-xs);
  }
  .errors .file {
    height: 18px;
    color: var(--fg);
  }
  .name {
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .cell {
    min-width: 0;
  }
  .source {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .file {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
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
  .file:disabled {
    cursor: default;
  }
  .file:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--fg);
  }
  .endpoint {
    font-size: var(--fs-xs);
  }
</style>
