<script lang="ts">
  import { getAssets } from '../lib/rpc.js'
  import type { AssetInfo } from '../lib/types.js'
  import Badge from '../components/Badge.svelte'
  import SearchInput from '../components/SearchInput.svelte'
  import ListItem from '../components/ListItem.svelte'
  import ScrollList from '../components/ScrollList.svelte'
  import DetailPanel from '../components/DetailPanel.svelte'
  import PanelContainer from '../components/PanelContainer.svelte'

  let assets = $state<AssetInfo[]>([])
  let error = $state<string | null>(null)
  let loading = $state(true)
  let selectedAsset = $state<AssetInfo | null>(null)
  let searchQuery = $state('')
  let filterType = $state<string>('all')

  async function load() {
    try {
      loading = true
      assets = await getAssets()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load assets'
    } finally {
      loading = false
    }
  }

  load()

  let assetTypes = $derived(() => {
    const types = new Set(assets.map(a => getCategory(a.type)))
    return ['all', ...Array.from(types).sort()]
  })

  let filteredAssets = $derived(
    assets.filter(a => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!a.name.toLowerCase().includes(q) && !a.relativePath.toLowerCase().includes(q)) return false
      }
      if (filterType !== 'all' && getCategory(a.type) !== filterType) return false
      return true
    })
  )

  let totalSize = $derived(assets.reduce((sum, a) => sum + a.size, 0))

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  function getCategory(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('font/')) return 'font'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType.startsWith('text/')) return 'text'
    return 'other'
  }

  function isPreviewable(asset: AssetInfo): boolean {
    return asset.type.startsWith('image/')
  }
</script>

<PanelContainer>
  <div class="header">
    <div class="header-left">
      <h2 class="page-title">Assets <span class="count">({assets.length})</span></h2>
      <span class="total-size">{formatSize(totalSize)}</span>
    </div>
    <div class="header-actions">
      <select class="filter-select" bind:value={filterType}>
        {#each assetTypes() as type}
          <option value={type}>{type === 'all' ? 'All types' : type}</option>
        {/each}
      </select>
      <SearchInput bind:value={searchQuery} />
    </div>
  </div>

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if error}
    <p class="status-text error">{error}</p>
  {:else}
    <div class="split-layout">
      <ScrollList>
        {#each filteredAssets as asset}
          <ListItem selected={selectedAsset?.path === asset.path} onclick={() => (selectedAsset = asset)}>
            <div class="asset-info">
              <span class="asset-name">{asset.name}</span>
              <span class="asset-path">{asset.relativePath}</span>
            </div>
            <span class="asset-size">{formatSize(asset.size)}</span>
          </ListItem>
        {/each}
        {#if filteredAssets.length === 0}
          <p class="empty">No assets found</p>
        {/if}
      </ScrollList>

      {#if selectedAsset}
        <DetailPanel>
          <h3 class="detail-title">{selectedAsset.name}</h3>

          {#if isPreviewable(selectedAsset)}
            <div class="preview">
              <img
                src="/__svelte-devtools/asset?path={encodeURIComponent(selectedAsset.path)}"
                alt={selectedAsset.name}
              />
            </div>
          {/if}

          <dl class="detail-dl">
            <div class="dl-row"><dt>Path</dt><dd class="font-mono">{selectedAsset.relativePath}</dd></div>
            <div class="dl-row"><dt>Size</dt><dd>{formatSize(selectedAsset.size)}</dd></div>
            <div class="dl-row"><dt>Type</dt><dd><Badge>{selectedAsset.type}</Badge></dd></div>
            <div class="dl-row"><dt>Modified</dt><dd>{new Date(selectedAsset.mtime).toLocaleString()}</dd></div>
          </dl>
        </DetailPanel>
      {/if}
    </div>
  {/if}
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; }
  .header-left { display: flex; align-items: baseline; gap: var(--space-2); }
  .header-actions { display: flex; gap: var(--space-2); align-items: center; }
  .page-title { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); }
  .count { color: var(--color-text-muted); font-weight: 400; }
  .total-size { color: var(--color-text-faint); font-size: var(--text-xs); font-family: var(--font-mono); }
  .status-text { color: var(--color-text-muted); padding: var(--space-4); }
  .status-text.error { color: var(--color-error); }
  .empty { color: var(--color-text-faint); padding: var(--space-5); text-align: center; }
  .split-layout { display: flex; gap: var(--space-3); flex: 1; overflow: hidden; }

  .filter-select {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    padding: var(--space-1-5) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    outline: none;
  }

  .filter-select:focus { border-color: var(--color-border-input); }
  .filter-select option { background: var(--color-surface); }

  .asset-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .asset-name { font-size: var(--text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .asset-path { color: var(--color-text-faint); font-size: var(--text-xs); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .asset-size { color: var(--color-text-muted); font-size: var(--text-xs); font-family: var(--font-mono); flex-shrink: 0; }

  .detail-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: var(--space-3);
  }

  .preview {
    background: var(--color-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    margin-bottom: var(--space-3);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 80px;
  }

  .preview img { max-width: 100%; max-height: 200px; object-fit: contain; }

  .detail-dl { display: flex; flex-direction: column; gap: var(--space-2); }
  .dl-row { display: flex; flex-direction: column; gap: 2px; }
  dt { color: var(--color-text-muted); font-size: var(--text-xs); }
  dd { color: var(--color-text); font-size: var(--text-sm); word-break: break-all; }
</style>
