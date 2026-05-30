<script lang="ts">
  let size = $state(200)
  let query = $state('')

  const items = $derived(
    Array.from({ length: size }, (_, i) => ({
      id: i,
      label: `Item #${i.toString().padStart(4, '0')}`,
      hue: (i * 13) % 360,
    })),
  )

  const filtered = $derived(
    query
      ? items.filter((it) => it.label.toLowerCase().includes(query.toLowerCase()))
      : items,
  )
</script>

<div class="card">
  <h3>大量リスト（Render Profiler 確認用）</h3>
  <div class="controls">
    <label>
      件数: {size}
      <input type="range" min="50" max="2000" step="50" bind:value={size} />
    </label>
    <input type="search" placeholder="絞り込み" bind:value={query} />
  </div>
  <div class="list">
    {#each filtered as item (item.id)}
      <div class="row" style="--hue:{item.hue}">
        <span class="dot"></span>
        <span>{item.label}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .controls {
    display: flex;
    gap: 12px;
    margin-bottom: 10px;
    align-items: center;
  }
  .controls label {
    flex: 1;
    font-size: 13px;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .list {
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .row:last-child {
    border-bottom: none;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: hsl(var(--hue), 70%, 60%);
  }
</style>
