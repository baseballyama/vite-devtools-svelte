<script lang="ts">
  import { onMount } from 'svelte'
  import type { ModuleGraphData, ModuleNode } from '../lib/types.js'
  import { getModuleGraph } from '../lib/rpc.js'
  import { basename } from '../lib/format.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'
  import SearchInput from '../components/SearchInput.svelte'

  let data = $state<ModuleGraphData | null>(null)
  let search = $state('')
  let selectedModule = $state<ModuleNode | null>(null)
  let filterType = $state<string>('all')

  function getFiltered(): ModuleNode[] {
    const mods = data?.modules ?? []
    let result = filterType !== 'all' ? mods.filter(m => m.type === filterType) : [...mods]
    if (search) result = result.filter(m => m.id.toLowerCase().includes(search.toLowerCase()))
    return result.sort((a, b) => (b.size || 0) - (a.size || 0))
  }

  function totalModules(): number { return data?.modules?.length ?? 0 }
  function svelteCount(): number { return data?.modules?.filter(m => m.type === 'svelte').length ?? 0 }

  function typeColor(type: string): 'accent' | 'info' | 'success' | 'warning' | 'neutral' {
    if (type === 'svelte') return 'accent'
    if (type === 'ts' || type === 'js') return 'info'
    if (type === 'css') return 'success'
    return 'neutral'
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function refresh() {
    try { data = await getModuleGraph() } catch { /* ignore */ }
  }

  onMount(() => { refresh() })
</script>

<PanelContainer>
  <div class="header">
    <h2>Module Graph</h2>
    <div class="actions">
      <select class="filter-select" bind:value={filterType}>
        <option value="all">All ({totalModules()})</option>
        <option value="svelte">Svelte ({svelteCount()})</option>
        <option value="ts">TypeScript</option>
        <option value="js">JavaScript</option>
        <option value="css">CSS</option>
      </select>
      <SearchInput bind:value={search} placeholder="Search modules..." />
      <ActionButton onclick={refresh}>Refresh</ActionButton>
    </div>
  </div>

  {#if data && data.cycles.length > 0}
    <div class="warning-banner">
      Circular dependencies detected ({data.cycles.length})
      {#each data.cycles.slice(0, 3) as cycle}
        <div class="cycle">{cycle.join(' → ')}</div>
      {/each}
    </div>
  {/if}

  {#if !data}
    <Card><p class="empty">Loading...</p></Card>
  {:else}
    <div class="module-layout">
      <div class="module-list">
        {#each getFiltered() as mod}
          <button class="module-item" class:selected={selectedModule === mod} class:cyclic={mod.isCyclic} onclick={() => selectedModule = selectedModule === mod ? null : mod}>
            <div class="mod-header">
              <Badge variant={typeColor(mod.type)}>{mod.type}</Badge>
              <span class="mod-id">{mod.id}</span>
              {#if mod.isCyclic}<Badge variant="error">cyclic</Badge>{/if}
            </div>
            <div class="mod-meta">
              {#if mod.size}<span class="mod-size">{formatSize(mod.size)}</span>{/if}
              <span class="mod-deps">{mod.imports.length} imports, {mod.importedBy.length} importers</span>
            </div>
          </button>
        {/each}
      </div>

      {#if selectedModule}
        <div class="detail-sidebar">
          <Card title={basename(selectedModule.id)}>
            <div class="detail-row"><span class="detail-label">Path</span><code class="detail-val">{selectedModule.id}</code></div>
            <div class="detail-row"><span class="detail-label">Type</span><Badge variant={typeColor(selectedModule.type)}>{selectedModule.type}</Badge></div>
            {#if selectedModule.size}<div class="detail-row"><span class="detail-label">Size</span><span class="detail-val">{formatSize(selectedModule.size)}</span></div>{/if}

            {#if selectedModule.imports.length > 0}
              <div class="detail-section">
                <span class="detail-label">Imports ({selectedModule.imports.length})</span>
                <ul class="dep-list">
                  {#each selectedModule.imports as imp}
                    <li><code>{basename(imp)}</code></li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if selectedModule.importedBy.length > 0}
              <div class="detail-section">
                <span class="detail-label">Imported By ({selectedModule.importedBy.length})</span>
                <ul class="dep-list">
                  {#each selectedModule.importedBy as imp}
                    <li><code>{basename(imp)}</code></li>
                  {/each}
                </ul>
              </div>
            {/if}
          </Card>
        </div>
      {/if}
    </div>
  {/if}
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); flex-wrap: wrap; gap: var(--space-2); }
  h2 { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); margin: 0; }
  .actions { display: flex; align-items: center; gap: var(--space-2); }
  .empty { color: var(--color-text-muted); font-size: var(--text-sm); }

  .filter-select { padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); font-size: var(--text-xs); }

  .warning-banner { margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--color-warning-bg); color: var(--color-warning-text); border: 1px solid var(--color-warning-border); border-radius: var(--radius-md); font-size: var(--text-sm); }
  .cycle { font-family: var(--font-mono); font-size: var(--text-xs); margin-top: 4px; opacity: 0.8; }

  .module-layout { display: flex; gap: var(--space-3); }
  .module-list { flex: 1; display: flex; flex-direction: column; gap: 2px; max-height: 70vh; overflow-y: auto; }

  .module-item { display: block; width: 100%; text-align: left; padding: var(--space-2) var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; font-family: var(--font-sans); transition: background var(--transition-fast); }
  .module-item:hover { background: var(--color-surface-active); }
  .module-item.selected { border-color: var(--color-accent-500); }
  .module-item.cyclic { border-left: 3px solid var(--color-error); }

  .mod-header { display: flex; align-items: center; gap: var(--space-2); }
  .mod-id { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mod-meta { display: flex; gap: var(--space-3); font-size: var(--text-xs); color: var(--color-text-subtle); margin-top: 2px; }
  .mod-size { font-family: var(--font-mono); }

  .detail-sidebar { width: 300px; flex-shrink: 0; }
  .detail-row { display: flex; justify-content: space-between; align-items: center; padding: var(--space-1) 0; font-size: var(--text-xs); }
  .detail-label { color: var(--color-text-muted); font-weight: 500; }
  .detail-val { color: var(--color-text); font-family: var(--font-mono); font-size: 10px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
  .detail-section { padding: var(--space-2) 0 0; border-top: 1px dashed var(--color-border); margin-top: var(--space-2); }
  .dep-list { list-style: none; padding: 0; margin: var(--space-1) 0 0; font-size: var(--text-xs); }
  .dep-list li { padding: 2px 0; }
  .dep-list code { color: var(--color-text); font-size: 10px; }
</style>
