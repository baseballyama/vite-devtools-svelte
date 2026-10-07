<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import Highlight from '../components/Highlight.svelte'
  import Inspector from '../components/Inspector.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import Panel from '../components/Panel.svelte'
  import ResourceEmpty from '../components/ResourceEmpty.svelte'
  import SearchField from '../components/SearchField.svelte'
  import SplitView from '../components/SplitView.svelte'
  import VirtualList from '../components/VirtualList.svelte'
  import { captureInfo } from '../lib/capture.svelte.js'
  import { componentName, formatClock, formatValue, prettyValue } from '../lib/format.js'
  import { haystack, haystackMatcher } from '../lib/match.js'
  import { baselineNotice } from '../lib/reactive.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getStateTimelineDelta, clearStateTimeline, openReactiveInEditor } from '../lib/rpc.js'
  import type { StateChange, StateTimelineEntry } from '../lib/types.js'
  import { datasetVersion } from '../lib/versions.js'

  /** Mirrors the server buffer (docs/devframe-migration.md §6.4). */
  const MAX_ENTRIES = 500

  // Cursor-based pulls: the server answers from its own buffer (never pulls
  // the app) and only sends entries after `cursor`; for a cursor it cannot
  // continue (a clear, an evicted page load, a restart) it answers with the
  // whole buffer and `reset`. The fetcher returns the same array when nothing
  // arrived, so the resource skips re-deriving without serialising the buffer.
  let cursor: number | undefined
  let buffer: StateTimelineEntry[] = []

  async function pull(): Promise<StateTimelineEntry[]> {
    const d = await getStateTimelineDelta(cursor)
    cursor = d.cursor
    if (d.reset) buffer = d.changes.slice(-MAX_ENTRIES)
    else if (d.changes.length) buffer = buffer.concat(d.changes).slice(-MAX_ENTRIES)
    return buffer
  }

  const timeline = resource<StateTimelineEntry[]>(pull, {
    initial: [],
    interval: 1000,
    version: datasetVersion('stateTimeline'),
    equals: (a, b) => a === b,
  })

  const capture = captureInfo(1000)
  const baseline = $derived(baselineNotice(capture.data.stateTimeline?.baseline))
  let query = $state('')
  let selected = $state<string | null>(null)

  // Values are snapshots of up to 32 KB; stringify each entry once, not on
  // every keystroke and row render. Entries are immutable once received.
  interface Preview {
    old: string
    next: string
    hay: string
  }
  const previews = new WeakMap<StateChange, Preview>()
  function preview(c: StateChange): Preview {
    let p = previews.get(c)
    if (!p) {
      p = {
        old: c.oldValue === null ? '' : formatValue(c.oldValue, 40),
        next: formatValue(c.newValue, 80),
        hay: haystack(c.name, c.componentFile, formatValue(c.newValue, 200)),
      }
      previews.set(c, p)
    }
    return p
  }

  /** Newest first, filtered. */
  const entries = $derived.by(() => {
    const m = haystackMatcher(query)
    const newest = timeline.data.toReversed()
    return m ? newest.filter(c => m(preview(c).hay)) : newest
  })

  // Keyed by the server's monotonically increasing `seq`, stable across
  // trims and resets of the buffer.
  const keyOf = (c: StateTimelineEntry) => String(c.seq)
  const current = $derived(selected ? (entries.find(c => keyOf(c) === selected) ?? null) : null)
  const signals = $derived(new Set(timeline.data.map(c => c.id)).size)

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
    <SearchField
      bind:value={query}
      placeholder="Filter by signal, component or value…"
      count={entries.length}
    />
    <CaptureNotice info={capture.data.stateTimeline} noun="changes" />
    {#if baseline}<span class="baseline" role="status">{baseline}</span>{/if}
    <span class="summary">{signals} signal{signals === 1 ? '' : 's'}</span>
    <span
      class="summary"
      title="The app checks $state every 200 ms: several writes within one check are one entry, and times are when a change was detected. The dev server keeps the latest {MAX_ENTRIES} changes across all signals."
    >
      sampled every 200 ms · latest {MAX_ENTRIES}
    </span>
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
        <VirtualList
          items={entries}
          getKey={keyOf}
          bind:selected
          label="State changes, newest first"
          onactivate={open}
        >
          {#snippet row(c: StateTimelineEntry)}
            <span class="time num">{formatClock(c.timestamp, true)}</span>
            <span class="sig">
              <span class="mono name"><Highlight text={c.name} {query} /></span>
              <span class="comp truncate"
                ><Highlight text={componentName(c.componentFile)} {query} /></span
              >
            </span>
            <span class="change mono truncate">
              {#if c.oldValue === null}
                <Badge tone="green">init</Badge>
              {:else}
                <span class="old">{preview(c).old}</span><span class="arrow">→</span>
              {/if}
              <span class="new"><Highlight text={preview(c).next} {query} /></span>
            </span>
          {/snippet}
          {#snippet empty()}
            <ResourceEmpty
              res={timeline}
              total={timeline.data.length}
              loading="Waiting for state changes…"
              failed="Could not load the state timeline"
              icon="timeline"
              title="No state changes yet"
              noMatch="No changes match"
            >
              <p>
                Interact with your app — every <code>$state</code> write is recorded here, newest first.
              </p>
            </ResourceEmpty>
          {/snippet}
        </VirtualList>
      </div>
    </div>
    {#snippet aside()}
      {#if current}
        <Inspector
          title={current.name}
          subtitle={current.componentFile}
          onclose={() => (selected = null)}
        >
          {#snippet badges()}
            <Badge tone={current.oldValue === null ? 'green' : 'blue'}
              >{current.oldValue === null ? 'init' : 'update'}</Badge
            >
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
  .baseline {
    font-size: var(--fs-xs);
    color: var(--yellow);
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
