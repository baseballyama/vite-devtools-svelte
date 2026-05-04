<script lang="ts">
  import { onMount } from 'svelte'
  import type { LoadProfile } from '../lib/types.js'
  import { getLoadProfiles, clearLoadProfiles } from '../lib/rpc.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let profiles = $state<LoadProfile[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const SLOW_THRESHOLD = 100 // ms

  const sorted = $derived.by(() => {
    return [...profiles].sort((a, b) => b.timestamp - a.timestamp)
  })

  // Waterfall: scale durations relative to max
  const maxDuration = $derived(Math.max(...profiles.map(p => p.duration), 1))

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString()
  }

  async function refresh() {
    try {
      profiles = await getLoadProfiles()
    } catch { /* ignore */ }
  }

  async function clear() {
    await clearLoadProfiles()
    profiles = []
  }

  onMount(() => {
    refresh()
    pollTimer = setInterval(refresh, 2000)
    return () => {
      if (pollTimer) clearInterval(pollTimer)
    }
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>Load Profiler</h2>
    <div class="actions">
      <ActionButton onclick={refresh}>Refresh</ActionButton>
      <ActionButton onclick={clear}>Clear</ActionButton>
    </div>
  </div>

  {#if profiles.length === 0}
    <Card>
      <p class="empty">No load function calls recorded yet. Navigate between routes in your app to trigger load functions.</p>
    </Card>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Route</th>
            <th>Type</th>
            <th>Duration</th>
            <th class="waterfall-col">Waterfall</th>
            <th>Data Size</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as profile}
            <tr class:slow={profile.duration > SLOW_THRESHOLD}>
              <td class="route">{profile.route}</td>
              <td>
                <Badge variant={profile.type === 'server' ? 'info' : 'accent'}>
                  {profile.type}
                </Badge>
              </td>
              <td class="num">
                <span class="duration" class:slow={profile.duration > SLOW_THRESHOLD}>
                  {profile.duration.toFixed(1)}ms
                </span>
              </td>
              <td class="waterfall-col">
                <div class="waterfall-bar-wrapper">
                  <div
                    class="waterfall-bar"
                    class:slow={profile.duration > SLOW_THRESHOLD}
                    style="width: {Math.max((profile.duration / maxDuration) * 100, 2)}%"
                  ></div>
                </div>
              </td>
              <td class="num">{formatSize(profile.dataSize)}</td>
              <td class="time">{formatTime(profile.timestamp)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if profiles.some(p => p.duration > SLOW_THRESHOLD)}
      <div class="warning-banner">
        Slow load functions detected (>{SLOW_THRESHOLD}ms). Consider optimizing data fetching or adding caching.
      </div>
    {/if}
  {/if}
</PanelContainer>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

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

  .route {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .time {
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
  }

  .duration.slow {
    color: var(--color-warning-text);
    font-weight: 600;
  }

  tr.slow {
    background: var(--color-warning-bg);
  }

  .waterfall-col {
    min-width: 120px;
  }

  .waterfall-bar-wrapper {
    height: 12px;
    background: var(--color-surface-active);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .waterfall-bar {
    height: 100%;
    background: var(--color-info);
    border-radius: var(--radius-sm);
    transition: width var(--transition-normal);
  }

  .waterfall-bar.slow {
    background: var(--color-warning);
  }

  tr:last-child td {
    border-bottom: none;
  }

  .warning-banner {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-warning-bg);
    color: var(--color-warning-text);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }
</style>
