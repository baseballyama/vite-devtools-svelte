<script lang="ts">
  import type { OGPreview } from '../lib/types.js'
  import { getOGPreview, getRoutes } from '../lib/rpc.js'
  import { onMount } from 'svelte'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let routes = $state<string[]>([])
  let selectedRoute = $state('/')
  let customUrl = $state('')
  let preview = $state<OGPreview | null>(null)
  let loading = $state(false)

  async function fetchPreview() {
    const url = customUrl || `${window.location.origin}${selectedRoute}`
    loading = true
    try { preview = await getOGPreview(url) } catch { preview = null }
    loading = false
  }

  onMount(async () => {
    try {
      const r = await getRoutes()
      routes = r.filter(r => r.hasPage).map(r => r.path)
    } catch { /* ignore */ }
  })
</script>

<PanelContainer summary="See how each route's social card looks across X, Discord, Slack, and link unfurlers.">
  <div class="controls">
    <select class="route-select" bind:value={selectedRoute}>
      {#each routes as route}
        <option value={route}>{route}</option>
      {/each}
    </select>
    <span class="or">or</span>
    <input class="url-input" type="text" bind:value={customUrl} placeholder="Custom URL" />
    <ActionButton onclick={fetchPreview}>{loading ? '...' : 'Preview'}</ActionButton>
  </div>

  {#if preview}
    <div class="preview-layout">
      <!-- Twitter/Social Card Preview -->
      <Card title="Social Card Preview">
        <div class="social-card">
          {#if preview.image}
            <div class="card-image">
              <img src={preview.image} alt={preview.title || ''} />
            </div>
          {:else}
            <div class="card-image no-image">No og:image</div>
          {/if}
          <div class="card-body">
            <div class="card-title">{preview.title || 'No title'}</div>
            <div class="card-desc">{preview.description || 'No description'}</div>
            <div class="card-url">{preview.url}</div>
          </div>
        </div>
      </Card>

      <!-- Meta Tags -->
      <Card title="Meta Tags ({preview.tags.length})">
        {#if preview.tags.length === 0}
          <p class="empty">No meta tags found</p>
        {:else}
          <div class="tag-list">
            {#each preview.tags as tag}
              <div class="tag-row">
                <code class="tag-prop">{tag.property}</code>
                <span class="tag-content">{tag.content}</span>
              </div>
            {/each}
          </div>
        {/if}
      </Card>

      <!-- Issues -->
      {#if preview.issues.length > 0}
        <Card title="Issues ({preview.issues.length})">
          <div class="issue-list">
            {#each preview.issues as issue}
              <div class="issue-item">
                <Badge variant="warning">missing</Badge>
                <span>{issue}</span>
              </div>
            {/each}
          </div>
        </Card>
      {/if}
    </div>
  {:else if !loading}
    <Card><p class="empty">Select a route and click Preview to check Open Graph tags.</p></Card>
  {/if}
</PanelContainer>

<style>
  .empty { color: var(--color-text-muted); font-size: var(--text-sm); }

  .controls { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
  .route-select, .url-input { padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); font-size: var(--text-sm); font-family: var(--font-mono); }
  .url-input { flex: 1; }
  .url-input:focus, .route-select:focus { outline: none; border-color: var(--color-accent-500); }
  .or { color: var(--color-text-subtle); font-size: var(--text-xs); }

  .preview-layout { display: flex; flex-direction: column; gap: var(--space-3); }

  .social-card { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; max-width: 500px; }
  .card-image { height: 200px; background: var(--color-surface); display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .card-image img { width: 100%; height: 100%; object-fit: cover; }
  .card-image.no-image { color: var(--color-text-subtle); font-size: var(--text-sm); }
  .card-body { padding: var(--space-2) var(--space-3); }
  .card-title { font-weight: 600; font-size: var(--text-sm); color: var(--color-text); margin-bottom: 4px; }
  .card-desc { font-size: var(--text-xs); color: var(--color-text-muted); margin-bottom: 4px; line-height: 1.4; }
  .card-url { font-size: 10px; color: var(--color-text-subtle); font-family: var(--font-mono); }

  .tag-list { display: flex; flex-direction: column; gap: 2px; }
  .tag-row { display: flex; gap: var(--space-2); padding: var(--space-1) 0; border-bottom: 1px dashed var(--color-border); font-size: var(--text-xs); }
  .tag-prop { color: var(--color-accent-400); min-width: 140px; flex-shrink: 0; }
  .tag-content { color: var(--color-text); word-break: break-all; }

  .issue-list { display: flex; flex-direction: column; gap: var(--space-1); }
  .issue-item { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--color-text); }
</style>
