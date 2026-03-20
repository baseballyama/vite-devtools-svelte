<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let items = $state<{ id: number; value: number; color: string }[]>([])
  let nextId = $state(1)
  let autoAdd = $state(false)
  let intervalId: ReturnType<typeof setInterval> | null = null

  let total = $derived(items.reduce((sum, item) => sum + item.value, 0))
  let average = $derived(items.length > 0 ? total / items.length : 0)
  let max = $derived(items.length > 0 ? Math.max(...items.map(i => i.value)) : 0)

  const colors = ['#ff3e00', '#4fc08d', '#42b883', '#61afef', '#c678dd', '#e5c07b']

  function addItem() {
    const value = Math.floor(Math.random() * 100) + 1
    const color = colors[items.length % colors.length]
    items = [...items, { id: nextId++, value, color }]
  }

  function removeItem(id: number) {
    items = items.filter(i => i.id !== id)
  }

  function clearAll() {
    items = []
  }

  $effect(() => {
    if (autoAdd) {
      intervalId = setInterval(addItem, 800)
    } else if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  })

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId)
  })
</script>

<div class="dynamic-list">
  <h3>Dynamic List</h3>
  <div class="toolbar">
    <button onclick={addItem}>Add</button>
    <button class="secondary" onclick={clearAll}>Clear</button>
    <label class="auto-toggle">
      <input type="checkbox" bind:checked={autoAdd} />
      Auto-add
    </label>
  </div>
  <div class="stats">
    <span>Items: {items.length}</span>
    <span>Total: {total}</span>
    <span>Avg: {average.toFixed(1)}</span>
    <span>Max: {max}</span>
  </div>
  <div class="bars">
    {#each items as item (item.id)}
      <button class="bar" onclick={() => removeItem(item.id)} title="Click to remove">
        <div class="fill" style="width: {item.value}%; background: {item.color};"></div>
        <span class="bar-label">{item.value}</span>
      </button>
    {/each}
    {#if items.length === 0}
      <p class="empty">Add items to see reactive stats</p>
    {/if}
  </div>
</div>

<style>
  .dynamic-list {
    background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px; padding: 16px;
  }
  h3 { color: #ff3e00; margin-bottom: 12px; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
  button {
    background: #ff3e00; color: white; border: none; border-radius: 4px;
    padding: 6px 12px; cursor: pointer; font-size: 12px;
  }
  button:hover { background: #e03500; }
  .secondary { background: #444; }
  .secondary:hover { background: #555; }
  .auto-toggle {
    font-size: 12px; color: #888; display: flex; align-items: center; gap: 4px; margin-left: auto; cursor: pointer;
  }
  .stats {
    display: flex; gap: 12px; font-size: 11px; color: #888; margin-bottom: 10px;
    padding: 6px 8px; background: #12122a; border-radius: 4px; font-family: monospace;
  }
  .bars { display: flex; flex-direction: column; gap: 3px; max-height: 160px; overflow-y: auto; }
  .bar {
    position: relative; height: 22px; background: #12122a; border-radius: 3px;
    border: none; cursor: pointer; text-align: left; width: 100%; padding: 0;
  }
  .bar:hover { opacity: 0.8; }
  .fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
  .bar-label {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    font-size: 10px; color: #ccc; font-family: monospace;
  }
  .empty { font-size: 12px; color: #555; text-align: center; padding: 16px 0; }
</style>
