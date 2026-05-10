<script lang="ts">
  import { onMount } from 'svelte'
  import type { RenderProfile } from '../lib/types.js'
  import { getRenderProfiles, openInEditor } from '../lib/rpc.js'
  import { shortPath } from '../lib/format.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let profiles = $state<RenderProfile[]>([])
  let sortBy = $state<'renderCount' | 'totalRenderTime' | 'initTime' | 'lastRenderTime'>('renderCount')
  let sortAsc = $state(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const sorted = $derived.by(() => {
    const copy = [...profiles]
    copy.sort((a, b) => {
      const va = a[sortBy]
      const vb = b[sortBy]
      return sortAsc ? va - vb : vb - va
    })
    return copy
  })

  function toggleSort(key: typeof sortBy) {
    if (sortBy === key) {
      sortAsc = !sortAsc
    } else {
      sortBy = key
      sortAsc = false
    }
  }

  function sortIndicator(key: typeof sortBy): string {
    if (sortBy !== key) return ''
    return sortAsc ? ' ▲' : ' ▼'
  }

  async function handleOpenFile(file: string) {
    try { await openInEditor(file) } catch { /* ignore */ }
  }

  async function refresh() {
    try {
      profiles = await getRenderProfiles()
    } catch { /* ignore */ }
  }

  onMount(() => {
    refresh()
    pollTimer = setInterval(refresh, 1000)
    return () => {
      if (pollTimer) clearInterval(pollTimer)
    }
  })
</script>

<PanelContainer summary="Per-component init time, render counts, and last paint duration — sortable to surface hot spots.">
  {#snippet actions()}
    <ActionButton onclick={refresh}>Refresh</ActionButton>
  {/snippet}

  {#if profiles.length === 0}
    <Card>
      <p class="empty">No render data yet. Interact with your app to generate profiling data.</p>
    </Card>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="name-col">Component</th>
            <th class="sortable" onclick={() => toggleSort('initTime')}>
              Init{sortIndicator('initTime')}
            </th>
            <th class="sortable" onclick={() => toggleSort('renderCount')}>
              Renders{sortIndicator('renderCount')}
            </th>
            <th class="sortable" onclick={() => toggleSort('totalRenderTime')}>
              Total Time{sortIndicator('totalRenderTime')}
            </th>
            <th class="sortable" onclick={() => toggleSort('lastRenderTime')}>
              Last{sortIndicator('lastRenderTime')}
            </th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as profile}
            <tr>
              <td class="name-col">
                <button class="file-link" onclick={() => handleOpenFile(profile.file)}>
                  <span class="component-name">{profile.name}</span>
                  <span class="file-path">{shortPath(profile.file)}</span>
                </button>
              </td>
              <td class="num">{profile.initTime.toFixed(2)}ms</td>
              <td class="num">
                <span class="render-count" class:hot={profile.renderCount > 10}>{profile.renderCount}</span>
              </td>
              <td class="num">{profile.totalRenderTime.toFixed(2)}ms</td>
              <td class="num">{profile.lastRenderTime.toFixed(2)}ms</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</PanelContainer>

<style>
  .empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  thead {
    background: var(--color-surface);
  }

  th {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
    user-select: none;
  }

  th.sortable {
    cursor: pointer;
    text-align: right;
  }

  th.sortable:hover {
    color: var(--color-text);
  }

  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
  }

  td.num {
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .name-col {
    min-width: 180px;
  }

  .file-link {
    display: block;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-align: left;
    width: 100%;
  }

  .file-link:hover .component-name {
    color: var(--color-accent-400);
  }

  .file-link:hover .file-path {
    color: var(--color-accent-400);
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .component-name {
    display: block;
    font-weight: 500;
    color: var(--color-text);
    transition: color var(--transition-fast);
  }

  .file-path {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
    font-family: var(--font-mono);
    transition: color var(--transition-fast);
  }

  .render-count {
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: var(--color-surface-active);
  }

  .render-count.hot {
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
  }

  tr:last-child td {
    border-bottom: none;
  }
</style>
