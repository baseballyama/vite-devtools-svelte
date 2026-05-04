<script lang="ts">
  import { onMount } from 'svelte'
  import type { CompilerWarning, RuntimeError } from '../lib/types.js'
  import { getCompilerWarnings, getRuntimeErrors, clearErrors } from '../lib/rpc.js'
  import { shortPath } from '../lib/format.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let warnings = $state<CompilerWarning[]>([])
  let errors = $state<RuntimeError[]>([])
  let activeTab = $state<'warnings' | 'errors'>('warnings')
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString()
  }

  async function refresh() {
    try {
      [warnings, errors] = await Promise.all([getCompilerWarnings(), getRuntimeErrors()])
    } catch { /* ignore */ }
  }

  async function clear() {
    await clearErrors()
    warnings = []
    errors = []
  }

  onMount(() => {
    refresh()
    pollTimer = setInterval(refresh, 3000)
    return () => { if (pollTimer) clearInterval(pollTimer) }
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>Errors & Warnings</h2>
    <div class="actions">
      <div class="tab-buttons">
        <button class="tab-btn" class:active={activeTab === 'warnings'} onclick={() => activeTab = 'warnings'}>
          Warnings <Badge variant="warning">{warnings.length}</Badge>
        </button>
        <button class="tab-btn" class:active={activeTab === 'errors'} onclick={() => activeTab = 'errors'}>
          Errors <Badge variant="error">{errors.length}</Badge>
        </button>
      </div>
      <ActionButton onclick={refresh}>Refresh</ActionButton>
      <ActionButton onclick={clear}>Clear</ActionButton>
    </div>
  </div>

  {#if activeTab === 'warnings'}
    {#if warnings.length === 0}
      <Card><p class="empty">No compiler warnings. Your code is clean!</p></Card>
    {:else}
      <div class="list">
        {#each warnings as warning}
          <div class="item warning-item">
            <div class="item-header">
              <Badge variant="warning">{warning.code}</Badge>
              {#if warning.file}
                <span class="item-file">{shortPath(warning.file)}{warning.line ? `:${warning.line}` : ''}</span>
              {/if}
            </div>
            <p class="item-message">{warning.message}</p>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    {#if errors.length === 0}
      <Card><p class="empty">No runtime errors captured.</p></Card>
    {:else}
      <div class="list">
        {#each [...errors].reverse() as error}
          <div class="item error-item">
            <div class="item-header">
              <Badge variant="error">error</Badge>
              <span class="item-time">{formatTime(error.timestamp)}</span>
              {#if error.file}
                <span class="item-file">{shortPath(error.file)}{error.line ? `:${error.line}` : ''}</span>
              {/if}
            </div>
            <p class="item-message">{error.message}</p>
            {#if error.stack}
              <details class="stack-details">
                <summary>Stack trace</summary>
                <pre class="stack-trace">{error.stack}</pre>
              </details>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); flex-wrap: wrap; gap: var(--space-2); }
  h2 { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); margin: 0; }
  .actions { display: flex; align-items: center; gap: var(--space-2); }
  .empty { color: var(--color-text-muted); font-size: var(--text-sm); }

  .tab-buttons { display: flex; gap: 2px; background: var(--color-surface); border-radius: var(--radius-md); padding: 2px; }
  .tab-btn {
    display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2);
    background: none; border: none; border-radius: var(--radius-sm); color: var(--color-text-muted);
    font-family: var(--font-sans); font-size: var(--text-xs); cursor: pointer;
  }
  .tab-btn.active { background: var(--color-surface-active); color: var(--color-text); }

  .list { display: flex; flex-direction: column; gap: var(--space-2); max-height: 70vh; overflow-y: auto; }

  .item {
    padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border);
    border-radius: var(--radius-md); background: var(--color-surface);
  }
  .warning-item { border-left: 3px solid var(--color-warning); }
  .error-item { border-left: 3px solid var(--color-error); }

  .item-header { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
  .item-file { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-subtle); }
  .item-time { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-subtle); }
  .item-message { font-size: var(--text-sm); color: var(--color-text); margin: 0; line-height: 1.4; word-break: break-word; }

  .stack-details { margin-top: var(--space-1); }
  .stack-details summary { font-size: var(--text-xs); color: var(--color-text-muted); cursor: pointer; }
  .stack-trace {
    margin: var(--space-1) 0 0; padding: var(--space-2); background: var(--color-base);
    border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 10px;
    color: var(--color-text-subtle); overflow-x: auto; white-space: pre-wrap; max-height: 200px; overflow-y: auto;
  }
</style>
