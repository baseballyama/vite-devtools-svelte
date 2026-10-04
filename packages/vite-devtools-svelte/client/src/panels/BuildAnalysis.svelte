<script lang="ts">
  import { getBuildAnalysis } from '../lib/rpc.js'
  import type { BuildAnalysis, BuildChunk } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { matcher } from '../lib/match.js'
  import { formatBytes, basename } from '../lib/format.js'
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

  const build = resource<BuildAnalysis | null>(getBuildAnalysis, { initial: null })

  let query = $state('')
  let kind = $state<'all' | 'js' | 'css' | 'other'>('all')
  let sort = $state<SortState | null>({ id: 'size', desc: true })
  let selected = $state<string | null>(null)

  const ext = (c: BuildChunk) => c.file.split('.').pop() ?? ''
  const kindOf = (c: BuildChunk) => (ext(c) === 'js' || ext(c) === 'mjs' ? 'js' : ext(c) === 'css' ? 'css' : 'other')
  const tones: Record<string, Tone> = { js: 'yellow', css: 'purple', other: 'neutral' }

  const chunks = $derived(build.data?.chunks ?? [])
  const rows = $derived.by(() => {
    const m = matcher(query)
    return chunks.filter((c) => (kind === 'all' || kindOf(c) === kind) && (!m || m(c.file, c.name, ...c.modules)))
  })
  const total = $derived(build.data?.totalSize ?? 0)
  const maxSize = $derived(chunks.reduce((m, c) => Math.max(m, c.size), 1))
  const current = $derived(selected ? (chunks.find((c) => c.file === selected) ?? null) : null)

  const byKind = $derived.by(() => {
    const k = { js: 0, css: 0, other: 0 }
    for (const c of chunks) k[kindOf(c)] += c.size
    return k
  })

  const columns: Column<BuildChunk>[] = [
    { id: 'file', label: 'Chunk', width: 'minmax(0, 1fr)', sort: (a, b) => a.file.localeCompare(b.file) },
    { id: 'modules', label: 'Modules', width: '72px', align: 'end', descFirst: true, minWidth: 560, sort: (a, b) => a.modules.length - b.modules.length },
    { id: 'share', label: 'Share', width: '64px', align: 'end', descFirst: true, minWidth: 640, sort: (a, b) => a.size - b.size },
    { id: 'size', label: 'Size', width: '150px', align: 'end', descFirst: true, sort: (a, b) => a.size - b.size },
  ]
</script>

<Panel title="Build" count={chunks.length}>
  {#snippet toolbar()}
    <Segmented
      label="Chunk type"
      bind:value={kind}
      options={[
        { value: 'all', label: 'All' },
        { value: 'js', label: 'JS', count: chunks.filter((c) => kindOf(c) === 'js').length },
        { value: 'css', label: 'CSS', count: chunks.filter((c) => kindOf(c) === 'css').length },
        { value: 'other', label: 'Other', count: chunks.filter((c) => kindOf(c) === 'other').length },
      ]}
    />
    <SearchField bind:value={query} placeholder="Filter chunks or modules…" count={rows.length} />
  {/snippet}
  {#snippet actions()}
    {#if build.data?.timestamp}<span class="stamp">built {new Date(build.data.timestamp).toLocaleString()}</span>{/if}
    <Button icon="refresh" variant="ghost" label="Re-read build output" disabled={build.busy} onclick={() => build.refresh()} />
  {/snippet}

  {#if !build.loading && chunks.length === 0}
    <EmptyState icon="build" title="No build output found">
      <p>Run <code>vite build</code> (or <code>pnpm build</code>) to produce chunks, then refresh.</p>
      <Button icon="refresh" onclick={() => build.refresh()}>Refresh</Button>
    </EmptyState>
  {:else}
    <div class="layout">
      <div class="composition" aria-label="Bundle composition">
        <div class="total"><span class="muted">Total</span> <strong class="num">{formatBytes(total)}</strong></div>
        <div class="stack" role="img" aria-label="JS {formatBytes(byKind.js)}, CSS {formatBytes(byKind.css)}, other {formatBytes(byKind.other)}">
          {#each ['js', 'css', 'other'] as const as k (k)}
            {#if byKind[k]}<span class="seg {k}" style:flex-grow={byKind[k]} title="{k}: {formatBytes(byKind[k])}"></span>{/if}
          {/each}
        </div>
        <div class="legend">
          {#each ['js', 'css', 'other'] as const as k (k)}
            <span><i class="dot {k}"></i>{k.toUpperCase()} <span class="num muted">{formatBytes(byKind[k])}</span></span>
          {/each}
        </div>
      </div>
      <div class="table">
        <SplitView id="build" open={!!current}>
          <DataTable items={rows} {columns} getKey={(c) => c.file} bind:sort bind:selected label="Build chunks">
            {#snippet row(c, { visible })}
              <span class="chunk">
                <Badge tone={tones[kindOf(c)]}>{ext(c)}</Badge>
                <span class="truncate mono file"><Highlight text={c.file} {query} /></span>
                {#if c.isEntry}<Badge tone="accent">entry</Badge>{/if}
              </span>
              {#if visible.has('modules')}<span class="end num muted">{c.modules.length}</span>{/if}
              {#if visible.has('share')}<span class="end num faint">{total ? ((c.size / total) * 100).toFixed(1) : 0}%</span>{/if}
              <span class="size end">
                <span class="bar {kindOf(c)}" style:width="{Math.max(2, (c.size / maxSize) * 60)}px"></span>
                <span class="num" class:big={c.size > 250_000}>{formatBytes(c.size)}</span>
              </span>
            {/snippet}
            {#snippet empty()}<EmptyState icon={build.loading ? undefined : 'search'} title={build.loading ? 'Reading build output…' : 'No chunks match'} />{/snippet}
          </DataTable>
          {#snippet aside()}
            {#if current}
              <Inspector title={basename(current.file)} subtitle={current.file} onclose={() => (selected = null)}>
                {#snippet badges()}
                  <Badge tone={tones[kindOf(current)]}>{ext(current)}</Badge>
                  <Badge>{formatBytes(current.size)}</Badge>
                  {#if current.isEntry}<Badge tone="accent">entry</Badge>{/if}
                {/snippet}
                <h3 class="section-title">Modules <span class="num">{current.modules.length}</span></h3>
                <ul class="mods">
                  {#each current.modules.slice(0, 1000) as m, i (i)}
                    <li class="mono truncate" title={m}><Highlight text={m} {query} /></li>
                  {/each}
                </ul>
              </Inspector>
            {/if}
          {/snippet}
        </SplitView>
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
    border-top: 1px solid var(--border);
  }
  .composition {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 10px 16px;
  }
  .total strong {
    font-size: var(--fs-lg);
  }
  .stack {
    display: flex;
    flex: 1 1 240px;
    height: 8px;
    gap: 2px;
    border-radius: 4px;
    overflow: hidden;
  }
  .seg {
    flex-basis: 0;
  }
  .legend {
    display: flex;
    gap: 12px;
    font-size: var(--fs-xs);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .js {
    background: var(--yellow);
  }
  .css {
    background: var(--purple);
  }
  .other {
    background: var(--fg-faint);
  }
  .stamp {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .chunk {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .file {
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
    opacity: 0.7;
  }
  .big {
    color: var(--yellow);
  }
  .mods {
    list-style: none;
    margin: 0;
    padding: 0 14px;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .mods li {
    padding: 2px 0;
  }
</style>
