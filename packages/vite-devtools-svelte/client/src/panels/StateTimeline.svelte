<script lang="ts">
  import { onMount } from 'svelte'
  import type { StateChange } from '../lib/types.js'
  import { getStateTimeline, clearStateTimeline, openReactiveInEditor } from '../lib/rpc.js'
  import { componentName } from '../lib/format.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let changes = $state<StateChange[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let selectedChange = $state<StateChange | null>(null)

  const sorted = $derived([...changes].reverse())

  function formatValue(v: unknown): string {
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    const s = JSON.stringify(v)
    return s.length > 60 ? s.slice(0, 59) + '…' : s
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
  }

  async function refresh() {
    try { changes = await getStateTimeline() } catch { /* ignore */ }
  }

  async function handleOpenReactive(file: string, name: string) {
    try { await openReactiveInEditor(file, name, 'state') } catch { /* ignore */ }
  }

  async function clear() {
    await clearStateTimeline()
    changes = []
    selectedChange = null
  }

  onMount(() => {
    refresh()
    pollTimer = setInterval(refresh, 1000)
    return () => { if (pollTimer) clearInterval(pollTimer) }
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>State Timeline</h2>
    <div class="actions">
      <span class="count">{changes.length} changes</span>
      <ActionButton onclick={refresh}>Refresh</ActionButton>
      <ActionButton onclick={clear}>Clear</ActionButton>
    </div>
  </div>

  {#if changes.length === 0}
    <Card>
      <p class="empty">No state changes recorded yet. Interact with your app to see $state changes here.</p>
    </Card>
  {:else}
    <div class="timeline-layout">
      <div class="timeline-list">
        {#each sorted as change, i (change.id + ':' + change.timestamp)}
          {@const toggle = () => selectedChange = selectedChange === change ? null : change}
          {@const openInEditor = () => handleOpenReactive(change.componentFile, change.name)}
          <div
            class="timeline-entry"
            class:selected={selectedChange === change}
            role="button"
            tabindex="0"
            aria-pressed={selectedChange === change}
            onclick={toggle}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggle()
              }
            }}
          >
            <div class="entry-header">
              <span class="entry-name">{change.name}</span>
              <Badge variant={change.oldValue === null ? 'success' : 'info'}>
                {change.oldValue === null ? 'init' : 'update'}
              </Badge>
            </div>
            <div class="entry-meta">
              <button
                type="button"
                class="entry-file-link"
                onclick={(e) => { e.stopPropagation(); openInEditor() }}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                title="Open {change.componentFile} in editor"
              >
                {componentName(change.componentFile)}
              </button>
              <span class="entry-time">{formatTime(change.timestamp)}</span>
            </div>
            <div class="entry-values">
              <span class="old-val">{formatValue(change.oldValue)}</span>
              <span class="arrow">→</span>
              <span class="new-val">{formatValue(change.newValue)}</span>
            </div>
          </div>
        {/each}
      </div>

      {#if selectedChange}
        <div class="detail-sidebar">
          <Card title={selectedChange.name}>
            <div class="detail-row">
              <span class="detail-label">Component</span>
              <button class="detail-file-link" onclick={() => handleOpenReactive(selectedChange!.componentFile, selectedChange!.name)}>{componentName(selectedChange.componentFile)}</button>
            </div>
            <div class="detail-row">
              <span class="detail-label">Time</span>
              <span class="detail-val">{formatTime(selectedChange.timestamp)}</span>
            </div>
            <div class="detail-section">
              <span class="detail-label">Old Value</span>
              <pre class="detail-code">{JSON.stringify(selectedChange.oldValue, null, 2)}</pre>
            </div>
            <div class="detail-section">
              <span class="detail-label">New Value</span>
              <pre class="detail-code new">{JSON.stringify(selectedChange.newValue, null, 2)}</pre>
            </div>
          </Card>
        </div>
      {/if}
    </div>
  {/if}
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  h2 { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); margin: 0; }
  .actions { display: flex; align-items: center; gap: var(--space-2); }
  .count { font-size: var(--text-xs); color: var(--color-text-subtle); }
  .empty { color: var(--color-text-muted); font-size: var(--text-sm); }

  .timeline-layout { display: flex; gap: var(--space-3); }
  .timeline-list { flex: 1; display: flex; flex-direction: column; gap: 2px; max-height: 70vh; overflow-y: auto; }

  .timeline-entry {
    display: block; width: 100%; text-align: left; padding: var(--space-2) var(--space-3);
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md);
    cursor: pointer; font-family: var(--font-sans); transition: background var(--transition-fast);
  }
  .timeline-entry:hover { background: var(--color-surface-active); }
  .timeline-entry.selected { border-color: var(--color-accent-500); background: var(--color-surface-active); }

  .entry-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
  .entry-name { font-weight: 600; font-size: var(--text-sm); color: var(--color-text); }
  .entry-meta { display: flex; justify-content: space-between; font-size: var(--text-xs); color: var(--color-text-subtle); margin-bottom: 4px; }
  .entry-file-link {
    font-family: var(--font-mono);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-accent-400);
    font-size: var(--text-xs);
    padding: 0;
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  .entry-file-link:hover { color: var(--color-accent-300); }
  .entry-time { font-family: var(--font-mono); }

  .entry-values { display: flex; align-items: center; gap: var(--space-1); font-family: var(--font-mono); font-size: var(--text-xs); }
  .old-val { color: var(--color-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
  .arrow { color: var(--color-text-muted); flex-shrink: 0; }
  .new-val { color: var(--color-accent-400); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }

  .detail-sidebar { width: 300px; flex-shrink: 0; }
  .detail-row { display: flex; justify-content: space-between; padding: var(--space-1) 0; font-size: var(--text-xs); }
  .detail-label { color: var(--color-text-muted); font-weight: 500; }
  .detail-val { color: var(--color-text); font-family: var(--font-mono); }
  .detail-section { padding: var(--space-2) 0 0; border-top: 1px dashed var(--color-border); margin-top: var(--space-2); }
  .detail-code {
    margin: var(--space-1) 0 0; padding: var(--space-2); background: var(--color-base);
    border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs);
    color: var(--color-text-subtle); overflow-x: auto; white-space: pre-wrap; max-height: 150px; overflow-y: auto;
  }
  .detail-code.new { color: var(--color-accent-400); }
  .detail-file-link {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-accent-400);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    padding: 0;
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  .detail-file-link:hover { color: var(--color-accent-300); }
</style>
