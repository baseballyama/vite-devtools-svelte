<script lang="ts">
  import type { Snippet } from 'svelte'
  let { title = '', children }: { title?: string; children: Snippet } = $props()
</script>

<div class="card">
  {#if title}
    <h3 class="card-title">{title}</h3>
  {/if}
  {@render children()}
</div>

<style>
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    padding: var(--space-3);
  }

  .card-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2);
  }
</style>
