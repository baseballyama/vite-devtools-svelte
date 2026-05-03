<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    selected = false,
    onclick,
    children,
  }: {
    selected?: boolean
    onclick?: () => void
    children: Snippet
  } = $props()
</script>

<button
  class="list-item"
  class:selected
  {onclick}
>
  {@render children()}
</button>

<style>
  .list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    border-bottom: 1px dashed var(--color-border);
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: background var(--transition-fast);
  }

  .list-item:last-child {
    border-bottom: none;
  }

  .list-item:hover {
    background: var(--color-surface-hover);
  }

  .list-item.selected {
    background: var(--color-surface-active);
  }
</style>
