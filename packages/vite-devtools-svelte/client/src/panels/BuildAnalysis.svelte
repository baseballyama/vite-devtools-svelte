<script lang="ts">
  import { onMount } from 'svelte'
  import type { BuildAnalysis } from '../lib/types.js'
  import { getBuildAnalysis } from '../lib/rpc.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let analysis = $state<BuildAnalysis | null>(null)
  let loading = $state(false)

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const maxSize = $derived(analysis ? Math.max(...analysis.chunks.map(c => c.size), 1) : 1)

  function extColor(name: string): 'info' | 'success' | 'warning' | 'accent' {
    if (name.endsWith('.js')) return 'info'
    if (name.endsWith('.css')) return 'success'
    if (name.endsWith('.html')) return 'warning'
    return 'accent'
  }

  async function refresh() {
    loading = true
    try { analysis = await getBuildAnalysis() } catch { /* ignore */ }
    loading = false
  }

  onMount(() => { refresh() })
</script>

<PanelContainer summary="Bundle composition by chunk — entry points, sizes, and gzipped weight.">
  {#snippet actions()}
    {#if analysis}
      <span class="total font-mono">Σ {formatSize(analysis.totalSize)}</span>
    {/if}
    <ActionButton onclick={refresh}>Refresh</ActionButton>
  {/snippet}

  {#if loading}
    <Card><p class="empty">Loading...</p></Card>
  {:else if analysis && analysis.chunks.length > 0}
    <div class="chunk-list">
      {#each analysis.chunks as chunk}
        <div class="chunk-item">
          <div class="chunk-header">
            <Badge variant={extColor(chunk.name)}>{chunk.name.split('.').pop()}</Badge>
            <span class="chunk-name">{chunk.file}</span>
            {#if chunk.isEntry}<Badge variant="accent">entry</Badge>{/if}
            <span class="chunk-size">{formatSize(chunk.size)}</span>
          </div>
          <div class="chunk-bar-wrapper">
            <div class="chunk-bar" style="width: {Math.max((chunk.size / maxSize) * 100, 1)}%"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <Card>
      <p class="empty">No build output found. Run <code>pnpm build</code> to generate build artifacts, then refresh.</p>
    </Card>
  {/if}
</PanelContainer>

<style>
  .total {
    display: inline-flex; align-items: center;
    padding: 3px var(--space-2);
    background: var(--color-surface-active);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
  .empty { color: var(--color-text-muted); font-size: var(--text-sm); }
  .empty code { background: var(--color-surface-active); padding: 1px 6px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); }

  .chunk-list { display: flex; flex-direction: column; gap: var(--space-2); }
  .chunk-item { padding: var(--space-2) var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
  .chunk-header { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
  .chunk-name { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chunk-size { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-muted); flex-shrink: 0; }

  .chunk-bar-wrapper { height: 8px; background: var(--color-surface-active); border-radius: var(--radius-sm); overflow: hidden; }
  .chunk-bar { height: 100%; background: var(--color-info); border-radius: var(--radius-sm); transition: width var(--transition-normal); }
</style>
