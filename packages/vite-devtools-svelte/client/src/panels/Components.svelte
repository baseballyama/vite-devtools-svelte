<script lang="ts">
  import { getComponentRelations, getLiveComponents, openInEditor } from '../lib/rpc.js'
  import type { ComponentRelation, ComponentInstance } from '../lib/types.js'
  import { componentName, shortPath } from '../lib/format.js'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'
  import SearchInput from '../components/SearchInput.svelte'
  import ListItem from '../components/ListItem.svelte'
  import ScrollList from '../components/ScrollList.svelte'
  import DetailPanel from '../components/DetailPanel.svelte'
  import PanelContainer from '../components/PanelContainer.svelte'

  let relations = $state<ComponentRelation[]>([])
  let liveComponents = $state<ComponentInstance[]>([])
  let error = $state<string | null>(null)
  let loading = $state(true)
  let selectedComponent = $state<ComponentRelation | null>(null)
  let searchQuery = $state('')
  let viewMode = $state<'static' | 'live'>('static')
  let pollTimer: ReturnType<typeof setInterval> | undefined

  async function load() {
    try {
      loading = true
      relations = await getComponentRelations()
      await refreshLive()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load components'
    } finally {
      loading = false
    }
  }

  async function refreshLive() {
    try { liveComponents = await getLiveComponents() } catch { /* ignore */ }
  }

  load()

  $effect(() => {
    if (viewMode === 'live') {
      pollTimer = setInterval(refreshLive, 2000)
    }
    return () => { if (pollTimer) clearInterval(pollTimer) }
  })

  let filteredRelations = $derived(
    relations.filter(r => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return r.name.toLowerCase().includes(q) || r.file.toLowerCase().includes(q)
    })
  )

  let liveTree = $derived.by(() => {
    const roots: (ComponentInstance & { children: ComponentInstance[] })[] = []
    const map = new Map<number, ComponentInstance & { children: ComponentInstance[] }>()
    for (const comp of liveComponents) map.set(comp.id, { ...comp, children: [] })
    for (const comp of liveComponents) {
      const node = map.get(comp.id)!
      if (comp.parentId !== null && map.has(comp.parentId)) {
        map.get(comp.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    return roots
  })

  // Build a single reverse-index for "imported by" lookups so panel rendering
  // is O(n) overall instead of O(n²) (was: relations.filter().includes() per row).
  const importerIndex = $derived.by(() => {
    const counts = new Map<string, number>()
    const importerMap = new Map<string, ComponentRelation[]>()
    for (const r of relations) {
      for (const imp of r.imports) {
        counts.set(imp, (counts.get(imp) ?? 0) + 1)
        const list = importerMap.get(imp)
        if (list) list.push(r)
        else importerMap.set(imp, [r])
      }
    }
    return { counts, importerMap }
  })

  let importers = $derived(
    selectedComponent ? (importerIndex.importerMap.get(selectedComponent.file) ?? []) : []
  )

  function getImporterCount(file: string): number {
    return importerIndex.counts.get(file) ?? 0
  }

  async function handleOpenFile(filePath: string) {
    try { await openInEditor(filePath) } catch { /* ignore */ }
  }
</script>

<PanelContainer
  count={viewMode === 'static' ? relations.length : liveComponents.length}
  summary={viewMode === 'static' ? 'Static analysis of import relations across your component tree.' : 'Live mounted component tree, refreshed every two seconds.'}
>
  {#snippet actions()}
    <div class="toggle-group">
      <ActionButton active={viewMode === 'static'} small onclick={() => (viewMode = 'static')}>Static</ActionButton>
      <ActionButton active={viewMode === 'live'} small onclick={() => (viewMode = 'live')}>Live</ActionButton>
    </div>
    <SearchInput bind:value={searchQuery} />
  {/snippet}

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if error}
    <p class="status-text error">{error}</p>
  {:else if viewMode === 'static'}
    <div class="split-layout">
      <ScrollList items={filteredRelations} getKey={(c) => c.file}>
        {#snippet item(comp)}
          <ListItem selected={selectedComponent?.file === comp.file} onclick={() => (selectedComponent = comp)}>
            <div class="comp-info">
              <span class="comp-name">{comp.name}</span>
              <span class="comp-file">{comp.file}</span>
            </div>
            <div class="badges">
              {#if comp.imports.length > 0}
                <Badge variant="info">{comp.imports.length} import{comp.imports.length !== 1 ? 's' : ''}</Badge>
              {/if}
              {#if getImporterCount(comp.file) > 0}
                <Badge variant="success">used {getImporterCount(comp.file)}x</Badge>
              {/if}
            </div>
          </ListItem>
        {/snippet}
        {#snippet empty()}
          <p class="empty">No components found</p>
        {/snippet}
      </ScrollList>

      {#if selectedComponent}
        <DetailPanel>
          <h3 class="detail-title">{selectedComponent.name}</h3>
          <button class="open-btn" onclick={() => handleOpenFile(selectedComponent!.file)}>Open in Editor</button>
          <p class="detail-path">{selectedComponent.file}</p>

          {#if selectedComponent.imports.length > 0}
            <h4 class="section-title">Imports ({selectedComponent.imports.length})</h4>
            <div class="dep-list">
              {#each selectedComponent.imports as imp}
                <button class="dep-item" onclick={() => handleOpenFile(imp)}>
                  <span class="dep-name">{componentName(imp)}</span>
                  <span class="dep-path">{imp}</span>
                </button>
              {/each}
            </div>
          {/if}

          {#if importers.length > 0}
            <h4 class="section-title">Used By ({importers.length})</h4>
            <div class="dep-list">
              {#each importers as imp}
                <button class="dep-item" onclick={() => { selectedComponent = imp }}>
                  <span class="dep-name">{imp.name}</span>
                  <span class="dep-path">{imp.file}</span>
                </button>
              {/each}
            </div>
          {/if}
        </DetailPanel>
      {/if}
    </div>

  {:else}
    <div class="live-container">
      {#if liveComponents.length === 0}
        <div class="empty-live">
          <p>No live component data available.</p>
          <p class="hint">Make sure the app is open in another tab.</p>
        </div>
      {:else}
        <div class="tree">
          {#each liveTree as node}
            {@render treeNode(node, 0)}
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</PanelContainer>

{#snippet treeNode(node: ComponentInstance & { children: ComponentInstance[] }, depth: number)}
  <div class="tree-node" style="padding-left: {depth * 16 + 8}px">
    <button class="tree-item" onclick={() => handleOpenFile(node.file)}>
      <span class="tree-dot" class:has-children={node.children.length > 0}></span>
      <span class="tree-name">{node.name}</span>
      <span class="tree-file">{shortPath(node.file)}</span>
    </button>
    {#each node.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  </div>
{/snippet}

<style>
  .toggle-group { display: inline-flex; gap: 4px; padding: 2px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
  .status-text { color: var(--color-text-muted); padding: var(--space-4); }
  .status-text.error { color: var(--color-error); }
  .empty, .empty-live { color: var(--color-text-faint); padding: var(--space-5); text-align: center; }
  .hint { color: var(--color-text-faint); font-size: var(--text-xs); margin-top: var(--space-1); }
  .split-layout { display: flex; gap: var(--space-3); flex: 1; overflow: hidden; }

  .comp-info { display: flex; flex-direction: column; gap: 2px; }
  .comp-name { font-weight: 500; font-size: var(--text-sm); }
  .comp-file { color: var(--color-text-faint); font-size: var(--text-xs); font-family: var(--font-mono); }
  .badges { display: flex; gap: var(--space-1); }

  .detail-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .open-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    background: rgba(255, 62, 0, 0.1);
    color: var(--color-text-accent);
    border: 1px solid rgba(255, 62, 0, 0.2);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    margin-bottom: var(--space-2);
    transition: background var(--transition-fast);
  }

  .open-btn:hover { background: rgba(255, 62, 0, 0.2); }

  .detail-path {
    color: var(--color-text-faint);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    margin-bottom: var(--space-3);
  }

  .section-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    margin-bottom: var(--space-1-5);
    margin-top: var(--space-3);
  }

  .dep-list { display: flex; flex-direction: column; gap: 2px; }

  .dep-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-surface-secondary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    transition: background var(--transition-fast);
  }

  .dep-item:hover { background: var(--color-surface-active); }
  .dep-name { font-weight: 500; }
  .dep-path { color: var(--color-text-faint); font-size: 10px; font-family: var(--font-mono); }

  /* Live tree */
  .live-container {
    flex: 1;
    overflow-y: auto;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    padding: var(--space-2) 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    width: 100%;
    padding: 3px var(--space-2);
    background: none;
    border: none;
    color: var(--color-text);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    transition: background var(--transition-fast);
    border-radius: var(--radius-sm);
  }

  .tree-item:hover { background: var(--color-surface-hover); }

  .tree-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--color-text-faint);
    flex-shrink: 0;
  }

  .tree-dot.has-children { background: var(--color-text-accent); }
  .tree-name { color: var(--color-text-accent); font-weight: 500; }
  .tree-file { color: var(--color-text-faint); font-size: var(--text-xs); font-family: var(--font-mono); }
</style>
