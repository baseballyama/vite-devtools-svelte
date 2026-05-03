<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    active = false,
    small = false,
    onclick,
    children,
  }: {
    active?: boolean
    small?: boolean
    onclick?: () => void
    children: Snippet
  } = $props()
</script>

<button
  class="action-btn"
  class:active
  class:small
  {onclick}
>
  {@render children()}
</button>

<style>
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    opacity: 0.75;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .action-btn:hover {
    opacity: 1;
    background: var(--color-surface-active);
  }

  .action-btn.active {
    color: var(--color-text-accent);
    border-color: var(--color-border-active);
    background: var(--color-surface-active);
    opacity: 1;
  }

  .action-btn.small {
    font-size: var(--text-xs);
    padding: 2px var(--space-1-5);
  }
</style>
