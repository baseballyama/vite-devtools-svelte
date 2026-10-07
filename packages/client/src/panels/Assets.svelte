<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import DataTable from '../components/DataTable.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Highlight from '../components/Highlight.svelte'
  import Icon from '../components/Icon.svelte'
  import Inspector from '../components/Inspector.svelte'
  import Panel from '../components/Panel.svelte'
  import RefreshButton from '../components/RefreshButton.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import SplitView from '../components/SplitView.svelte'
  import type { Column, SortState, TableRowState } from '../components/types.js'
  import { countBy } from '../lib/collections.js'
  import { formatBytes } from '../lib/format.js'
  import type { IconName } from '../lib/icons.js'
  import { matcher } from '../lib/match.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getAssets, openInEditor } from '../lib/rpc.js'
  import type { AssetInfo } from '../lib/types.js'

  const assets = resource<AssetInfo[]>(getAssets, { initial: [] })

  type Category = 'image' | 'font' | 'video' | 'audio' | 'text' | 'other'
  function category(mime: string): Category {
    const head = mime.split('/')[0]
    return head === 'image' ||
      head === 'font' ||
      head === 'video' ||
      head === 'audio' ||
      head === 'text'
      ? head
      : 'other'
  }
  const catIcon: Record<Category, IconName> = {
    image: 'assets',
    font: 'file',
    video: 'play',
    audio: 'play',
    text: 'file',
    other: 'file',
  }

  let query = $state('')
  let cat = $state<'all' | Category>('all')
  let sort = $state<SortState | null>({ id: 'size', desc: true })
  let selected = $state<string | null>(null)

  const counts = $derived(countBy(assets.data, a => category(a.type)))

  const catOptions = $derived([
    { value: 'all' as const, label: 'All', count: assets.data.length },
    ...(['image', 'font', 'video', 'audio', 'text', 'other'] as const)
      .filter(c => counts.get(c))
      .map(c => ({
        value: c,
        label: c.charAt(0).toUpperCase() + c.slice(1),
        count: counts.get(c),
      })),
  ])

  const rows = $derived.by(() => {
    const m = matcher(query)
    return assets.data.filter(
      a => (cat === 'all' || category(a.type) === cat) && (!m || m(a.relativePath, a.type)),
    )
  })

  const rowsBytes = $derived(rows.reduce((s, a) => s + a.size, 0))
  const maxSize = $derived(assets.data.reduce((m, a) => Math.max(m, a.size), 1))
  const current = $derived(selected ? (assets.data.find(a => a.path === selected) ?? null) : null)

  const columns: Column<AssetInfo>[] = [
    {
      id: 'name',
      label: 'File',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.relativePath.localeCompare(b.relativePath),
    },
    {
      id: 'type',
      label: 'Type',
      width: '120px',
      minWidth: 640,
      sort: (a, b) => a.type.localeCompare(b.type),
    },
    {
      id: 'mtime',
      label: 'Modified',
      width: '96px',
      align: 'end',
      minWidth: 760,
      descFirst: true,
      sort: (a, b) => a.mtime - b.mtime,
    },
    {
      id: 'size',
      label: 'Size',
      width: '140px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.size - b.size,
    },
  ]

  // Public dev-server URL (docs/devframe-migration.md §6.1: `AssetInfo.url`).
  // Static files are served from the root, so fall back to that.
  function assetUrl(a: AssetInfo) {
    return a.url || '/' + a.relativePath
  }
</script>

<Panel title="Assets" count={assets.data.length}>
  {#snippet toolbar()}
    <Segmented label="Asset type" bind:value={cat} options={catOptions} />
    <SearchField bind:value={query} placeholder="Filter assets…" count={rows.length} />
  {/snippet}
  {#snippet actions()}
    <span class="total num" title="Total size of shown assets">{formatBytes(rowsBytes)}</span>
    <RefreshButton res={assets} label="Rescan static directory" />
  {/snippet}

  <SplitView id="assets" open={!!current}>
    <DataTable
      items={rows}
      {columns}
      getKey={(a: AssetInfo) => a.path}
      bind:sort
      bind:selected
      label="Static assets"
      onactivate={(a: AssetInfo) => openInEditor(a.path).catch(() => {})}
    >
      {#snippet row(a: AssetInfo, { visible }: TableRowState)}
        <span class="file">
          <Icon name={catIcon[category(a.type)]} size={14} />
          <span class="truncate"><Highlight text={a.relativePath} {query} /></span>
        </span>
        {#if visible.has('type')}<span class="muted truncate mono small">{a.type}</span>{/if}
        {#if visible.has('mtime')}<span class="end faint num small"
            >{new Date(a.mtime).toLocaleDateString()}</span
          >{/if}
        <span class="size end">
          <span class="bar" style:width="{Math.max(2, (a.size / maxSize) * 56)}px"></span>
          <span class="num">{formatBytes(a.size)}</span>
        </span>
      {/snippet}
      {#snippet empty()}
        {#if assets.loading}
          <EmptyState title="Scanning static directory…" />
        {:else if assets.error}
          <EmptyState title="Could not read assets" error={assets.error} />
        {:else}
          <EmptyState
            icon="assets"
            title={assets.data.length ? 'No assets match' : 'No static assets'}
          />
        {/if}
      {/snippet}
    </DataTable>
    {#snippet aside()}
      {#if current}
        <Inspector
          title={current.name}
          subtitle={current.relativePath}
          onclose={() => (selected = null)}
        >
          {#snippet badges()}
            <Badge>{current.type}</Badge>
            <Badge tone={current.size > 500_000 ? 'yellow' : 'neutral'}
              >{formatBytes(current.size)}</Badge
            >
          {/snippet}
          {#snippet actions()}
            <Button
              icon="external"
              onclick={() => window.open(assetUrl(current), '_blank', 'noopener')}>Open URL</Button
            >
            <Button icon="editor" onclick={() => openInEditor(current.path).catch(() => {})}
              >Reveal</Button
            >
          {/snippet}
          {#if current.type.startsWith('image/')}
            <div class="preview">
              <img src={assetUrl(current)} alt={current.name} loading="lazy" />
            </div>
          {/if}
          <h3 class="section-title">Details</h3>
          <dl class="kv">
            <dt>Public URL</dt>
            <dd class="mono">{assetUrl(current)}</dd>
            <dt>Size</dt>
            <dd class="num">
              {formatBytes(current.size)}
              <span class="faint">({current.size.toLocaleString()} bytes)</span>
            </dd>
            <dt>Modified</dt>
            <dd>{new Date(current.mtime).toLocaleString()}</dd>
            <dt>Disk path</dt>
            <dd class="mono faint">{current.path}</dd>
          </dl>
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

<style>
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--fg);
  }
  .file :global(.icon) {
    color: var(--fg-faint);
  }
  .small {
    font-size: var(--fs-xs);
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
    background: var(--accent);
    opacity: 0.55;
  }
  .total {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    margin-right: 4px;
  }
  .preview {
    margin: 12px 14px 0;
    display: grid;
    place-items: center;
    min-height: 120px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--bg-inset);
    background-image:
      linear-gradient(
        45deg,
        var(--bg-active) 25%,
        transparent 25%,
        transparent 75%,
        var(--bg-active) 75%
      ),
      linear-gradient(
        45deg,
        var(--bg-active) 25%,
        transparent 25%,
        transparent 75%,
        var(--bg-active) 75%
      );
    background-size: 16px 16px;
    background-position:
      0 0,
      8px 8px;
  }
  .preview img {
    max-width: 100%;
    max-height: 260px;
    object-fit: contain;
  }
</style>
