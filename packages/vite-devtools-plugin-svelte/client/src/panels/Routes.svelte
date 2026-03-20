<script lang="ts">
  import { getRoutes, openInEditor } from '../lib/rpc.js'
  import type { RouteInfo, RouteFile } from '../lib/types.js'
  import Badge from '../components/Badge.svelte'
  import SearchInput from '../components/SearchInput.svelte'
  import ListItem from '../components/ListItem.svelte'
  import ScrollList from '../components/ScrollList.svelte'
  import DetailPanel from '../components/DetailPanel.svelte'
  import PanelContainer from '../components/PanelContainer.svelte'

  let routes = $state<RouteInfo[]>([])
  let error = $state<string | null>(null)
  let loading = $state(true)
  let selectedRoute = $state<RouteInfo | null>(null)
  let searchQuery = $state('')

  async function load() {
    try {
      loading = true
      routes = await getRoutes()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load routes'
    } finally {
      loading = false
    }
  }

  load()

  let filteredRoutes = $derived(
    routes.filter(r => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return r.path.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
    })
  )

  function getFileTypeLabel(type: RouteFile['type']): string {
    const labels: Record<string, string> = {
      'page': '+page.svelte',
      'layout': '+layout.svelte',
      'page-load-server': '+page.server',
      'layout-load-server': '+layout.server',
      'page-load': '+page.ts',
      'layout-load': '+layout.ts',
      'endpoint': '+server',
      'error': '+error.svelte',
    }
    return labels[type] || type
  }

  function getFileTypeBadgeVariant(type: string): 'accent' | 'success' | 'info' | 'warning' | 'error' | 'neutral' {
    if (type.includes('server') || type === 'endpoint') return 'success'
    if (type.includes('layout')) return 'info'
    if (type === 'page') return 'accent'
    if (type === 'error') return 'error'
    return 'neutral'
  }

  async function handleOpenFile(filePath: string) {
    try { await openInEditor(filePath) } catch { /* ignore */ }
  }
</script>

<PanelContainer>
  <div class="header">
    <h2 class="page-title">Routes <span class="count">({routes.length})</span></h2>
    <SearchInput bind:value={searchQuery} placeholder="Search routes..." />
  </div>

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if error}
    <p class="status-text error">{error}</p>
  {:else}
    <div class="split-layout">
      <ScrollList>
        {#each filteredRoutes as route}
          <ListItem selected={selectedRoute?.id === route.id} onclick={() => (selectedRoute = route)}>
            <span class="route-path">{route.path}</span>
            <div class="badges">
              {#if route.hasPage}<Badge variant="accent">Page</Badge>{/if}
              {#if route.hasLayout}<Badge variant="info">Layout</Badge>{/if}
              {#if route.hasEndpoint}<Badge variant="success">API</Badge>{/if}
              {#if route.hasServerPage || route.hasPageLoad}<Badge variant="info">Load</Badge>{/if}
              {#each route.params as param}
                <Badge variant="warning">{param.rest ? '...' : ''}{param.name}</Badge>
              {/each}
            </div>
          </ListItem>
        {/each}
        {#if filteredRoutes.length === 0}
          <p class="empty">No routes found</p>
        {/if}
      </ScrollList>

      {#if selectedRoute}
        <DetailPanel>
          <h3 class="detail-title">{selectedRoute.path}</h3>
          <dl class="detail-dl">
            <div class="dl-row"><dt>Directory</dt><dd>{selectedRoute.id}</dd></div>
            <div class="dl-row"><dt>Pattern</dt><dd class="font-mono">{selectedRoute.pattern}</dd></div>
            {#if selectedRoute.params.length > 0}
              <div class="dl-row">
                <dt>Params</dt>
                <dd class="param-list">
                  {#each selectedRoute.params as param}
                    <Badge variant="warning">{param.rest ? '...' : ''}{param.name}{param.optional ? '?' : ''}</Badge>
                  {/each}
                </dd>
              </div>
            {/if}
          </dl>

          <h4 class="section-title">Files</h4>
          <div class="file-list">
            {#each selectedRoute.files as file}
              <button class="file-item" onclick={() => handleOpenFile(file.path)}>
                <Badge variant={getFileTypeBadgeVariant(file.type)}>{getFileTypeLabel(file.type)}</Badge>
                <span class="file-action">Open</span>
              </button>
            {/each}
          </div>
        </DetailPanel>
      {/if}
    </div>
  {/if}
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; }
  .page-title { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); }
  .count { color: var(--color-text-muted); font-weight: 400; }
  .status-text { color: var(--color-text-muted); padding: var(--space-4); }
  .status-text.error { color: var(--color-error); }
  .empty { color: var(--color-text-faint); padding: var(--space-5); text-align: center; }

  .split-layout { display: flex; gap: var(--space-3); flex: 1; overflow: hidden; }

  .route-path { font-family: var(--font-mono); font-size: var(--text-sm); }
  .badges { display: flex; gap: var(--space-1); flex-shrink: 0; }

  .detail-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: var(--space-3);
    font-family: var(--font-mono);
  }

  .detail-dl { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3); }
  .dl-row { display: flex; flex-direction: column; gap: 2px; }
  dt { color: var(--color-text-muted); font-size: var(--text-xs); }
  dd { color: var(--color-text); font-size: var(--text-sm); }
  .param-list { display: flex; gap: var(--space-1); flex-wrap: wrap; }

  .section-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .file-list { display: flex; flex-direction: column; gap: var(--space-1); }

  .file-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-surface-secondary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: background var(--transition-fast);
  }

  .file-item:hover { background: var(--color-surface-active); }

  .file-action {
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    transition: color var(--transition-fast);
  }

  .file-item:hover .file-action { color: var(--color-text-accent); }
</style>
