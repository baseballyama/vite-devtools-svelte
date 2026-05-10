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
  <span class="list-rail" aria-hidden="true"></span>
  {@render children()}
</button>

<style>
  .list-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3) var(--space-2) calc(var(--space-3) + 4px);
    background: none;
    border: none;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: background var(--transition-fast);
  }

  .list-rail {
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: var(--radius-full);
    background: var(--color-rail);
    opacity: 0;
    transform: scaleY(0.4);
    transform-origin: center;
    transition:
      opacity var(--transition-normal),
      transform var(--transition-slow);
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

  .list-item.selected .list-rail {
    opacity: 1;
    transform: scaleY(1);
  }
</style>
