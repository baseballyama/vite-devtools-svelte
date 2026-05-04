<script lang="ts">
  import type { Snippet } from 'svelte'
  let { children }: { children: Snippet } = $props()
</script>

<div class="panel-container">
  {@render children()}
</div>

<style>
  .panel-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
