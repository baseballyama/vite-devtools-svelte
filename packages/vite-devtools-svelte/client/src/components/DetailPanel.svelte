<script lang="ts">
  import type { Snippet } from 'svelte'
  let { width = '340px', children }: { width?: string; children: Snippet } = $props()
</script>

<aside class="detail-panel" style:width style:min-width={width}>
  {@render children()}
</aside>

<style>
  .detail-panel {
    background: linear-gradient(180deg, var(--color-surface), var(--color-surface-secondary));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    padding: var(--space-4);
    overflow-y: auto;
    box-shadow: var(--shadow-sm);
    position: relative;
  }

  /* Subtle inner highlight at the top — gives the detail panel a sheet-of-
   * paper feel without leaning on heavy shadows. */
  .detail-panel::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
    pointer-events: none;
  }
</style>
