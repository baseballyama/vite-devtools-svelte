<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    active = false,
    small = false,
    primary = false,
    onclick,
    children,
  }: {
    active?: boolean
    small?: boolean
    primary?: boolean
    onclick?: () => void
    children: Snippet
  } = $props()
</script>

<button
  class="action-btn"
  class:active
  class:small
  class:primary
  {onclick}
>
  {@render children()}
</button>

<style>
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 5px var(--space-2-5, 10px);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast);
    white-space: nowrap;
  }

  .action-btn:hover {
    color: var(--color-text);
    border-color: var(--color-border-strong);
    background: var(--color-surface-secondary);
  }

  .action-btn:active {
    transform: translateY(0.5px);
  }

  .action-btn.active {
    color: var(--color-text-accent);
    border-color: var(--color-border-active);
    background: rgba(255, 62, 0, 0.06);
    box-shadow: inset 0 0 0 1px rgba(255, 62, 0, 0.15);
  }

  .action-btn.primary {
    background: linear-gradient(180deg, var(--color-accent-500), var(--color-accent-600));
    color: white;
    border-color: var(--color-accent-700);
    box-shadow: var(--shadow-sm), 0 0 0 1px rgba(255, 158, 130, 0.3) inset;
  }

  .action-btn.primary:hover {
    background: linear-gradient(180deg, var(--color-accent-400), var(--color-accent-500));
    color: white;
    border-color: var(--color-accent-600);
  }

  .action-btn.small {
    font-size: var(--text-xs);
    padding: 3px var(--space-2);
  }
</style>
