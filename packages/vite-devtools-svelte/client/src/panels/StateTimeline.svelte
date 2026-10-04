<script lang="ts">
  import { getStateTimelineDelta, clearStateTimeline, openReactiveInEditor } from '../lib/rpc.js'
  import type { StateChange, StateTimelineEntry } from '../lib/types.js'
  import { datasetVersion } from '../lib/versions.js'
  import { resource } from '../lib/resource.svelte.js'
  import { matcher } from '../lib/match.js'
  import { componentName, formatClock, formatValue, prettyValue } from '../lib/format.js'
  import Panel from '../components/Panel.svelte'
  import SplitView from '../components/SplitView.svelte'
  import VirtualList from '../components/VirtualList.svelte'
  import Inspector from '../components/Inspector.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Button from '../components/Button.svelte'
  import Badge from '../components/Badge.svelte'
  import Highlight from '../components/Highlight.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import { captureInfo } from '../lib/capture.svelte.js'

  /** Mirrors the server buffer (docs/devframe-migration.md §6.4). */
  const MAX_ENTRIES = 500

  // Cursor-based pulls: the server answers from its own buffer (never pulls
  // the app) and only sends entries after `cursor`; `reset` replaces the
  // local list. The fetcher returns the same array when nothing arrived, so
  // the resource skips re-deriving without serialising the buffer.
  //
  // Defensive against stale cursors (review D1/D2: server-side reset or a
  // restarted dev server whose seq overtook ours): a changed server
  // identity, a cursor moving backwards, or a non-increasing seq in an
  // append all mean "our cursor is from another timeline" → refetch the full
  // buffer instead of appending.
  let cursor: number | undefined
  let serverId: string | undefined
  let buffer: StateTimelineEntry[] = []

  /** Optional identity (`serverId`/`instanceId`) if §6.4 adds one; feature-detected. */
  const identityOf = (d: object): string | undefined => {
    const x = d as { serverId?: unknown; instanceId?: unknown }
    const id = x.serverId ?? x.instanceId
    return id == null ? undefined : String(id)
  }

  async function pull(): Promise<StateTimelineEntry[]> {
    let d = await getStateTimelineDelta(cursor)
    const id = identityOf(d)
    const lastSeq = buffer.at(-1)?.seq
    const stale =
      !d.reset &&
      cursor !== undefined &&
      ((id !== undefined && serverId !== undefined && id !== serverId) ||
        d.cursor < cursor ||
        (d.changes.length > 0 && lastSeq !== undefined && d.changes[0].seq <= lastSeq))
    if (stale) d = await getStateTimelineDelta(undefined)
    serverId = identityOf(d)
    cursor = d.cursor
    if (d.reset || stale) buffer = d.changes.slice(-MAX_ENTRIES)
    else if (d.changes.length) buffer = buffer.concat(d.changes).slice(-MAX_ENTRIES)
    return buffer
  }

  const timeline = resource<StateTimelineEntry[]>(
    pull,
    { initial: [], interval: 1000, version: datasetVersion('stateTimeline'), equals: (a, b) => a === b },
  )

  const capture = captureInfo(1000)
  let query = $state('')
  let selected = $state<string | null>(null)

  // Keyed by the server's monotonically increasing `seq`, stable across
  // trims and resets of the buffer.
  interface Entry {
    key: string
    c: StateChange
  }

  const entries = $derived.by(() => {
    const out: Entry[] = []
    const m = matcher(query)
    const data = timeline.data
    for (let i = data.length - 1; i >= 0; i--) {
      const c = data[i]
      if (m && !m(c.name, c.componentFile, formatValue(c.newValue, 200))) continue
      out.push({ key: String(c.seq), c })
    }
    return out
  })

  const current = $derived(selected ? (entries.find((e) => e.key === selected)?.c ?? null) : null)
  const signals = $derived(new Set(timeline.data.map((c) => c.id)).size)

  async function clear() {
    await clearStateTimeline().catch(() => {})
    cursor = undefined
    buffer = []
    timeline.set(buffer)
    selected = null
  }

  function open(c: StateChange) {
    openReactiveInEditor(c.componentFile, c.name, 'state').catch(() => {})
  }
</script>

<Panel title="State timeline" count={timeline.data.length}>
  {#snippet toolbar()}
    <SearchField bind:value={query} placeholder="Filter by signal, component or value…" count={entries.length} />
    <CaptureNotice info={capture.data.stateTimeline} noun="changes" />
    <span class="summary">{signals} signal{signals === 1 ? '' : 's'}</span>
  {/snippet}
  {#snippet actions()}
    <LiveControls res={timeline} onclear={clear} />
  {/snippet}

  <SplitView id="timeline" open={!!current}>
    <div class="list">
      <div class="head" aria-hidden="true">
        <span>Time</span><span>Signal</span><span>Change</span>
      </div>
      <div class="body">
        <VirtualList items={entries} getKey={(e) => e.key} bind:selected label="State changes, newest first" onactivate={(e) => open(e.c)}>
          {#snippet row({ c })}
            <span class="time num">{formatClock(c.timestamp, true)}</span>
            <span class="sig">
              <span class="mono name"><Highlight text={c.name} {query} /></span>
              <span class="comp truncate"><Highlight text={componentName(c.componentFile)} {query} /></span>
            </span>
            <span class="change mono truncate">
              {#if c.oldValue === null}
                <Badge tone="green">init</Badge>
              {:else}
                <span class="old">{formatValue(c.oldValue, 40)}</span><span class="arrow">→</span>
              {/if}
              <span class="new"><Highlight text={formatValue(c.newValue, 80)} {query} /></span>
            </span>
          {/snippet}
          {#snippet empty()}
            {#if timeline.data.length === 0}
              <EmptyState icon="timeline" title="No state changes yet"><p>Interact with your app — every <code>$state</code> write is recorded here, newest first.</p></EmptyState>
            {:else}
              <EmptyState icon="search" title="No changes match" />
            {/if}
          {/snippet}
        </VirtualList>
      </div>
    </div>
    {#snippet aside()}
      {#if current}
        <Inspector title={current.name} subtitle={current.componentFile} onclose={() => (selected = null)}>
          {#snippet badges()}
            <Badge tone={current.oldValue === null ? 'green' : 'blue'}>{current.oldValue === null ? 'init' : 'update'}</Badge>
            <Badge>{formatClock(current.timestamp, true)}</Badge>
          {/snippet}
          {#snippet actions()}
            <Button icon="editor" onclick={() => open(current)}>Go to definition</Button>
          {/snippet}
          <h3 class="section-title">Before</h3>
          <pre class="code-block old-block">{prettyValue(current.oldValue)}</pre>
          <h3 class="section-title">After</h3>
          <pre class="code-block new-block">{prettyValue(current.newValue)}</pre>
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

<style>
  .list {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head,
  .list :global([role='option']) {
    display: grid;
    grid-template-columns: 92px minmax(140px, 0.6fr) minmax(0, 1fr);
    column-gap: 12px;
  }
  .head {
    height: 28px;
    align-items: center;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--fg-faint);
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .summary {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .time {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
  }
  .sig {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .name {
    color: var(--blue);
    white-space: nowrap;
  }
  .comp {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .change {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    min-width: 0;
  }
  .old {
    color: var(--fg-faint);
    text-decoration: line-through;
    text-decoration-color: var(--border-strong);
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arrow {
    color: var(--fg-faint);
  }
  .new {
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .old-block {
    color: var(--fg-muted);
  }
  .new-block {
    border-color: color-mix(in srgb, var(--green) 35%, transparent);
  }
</style>
