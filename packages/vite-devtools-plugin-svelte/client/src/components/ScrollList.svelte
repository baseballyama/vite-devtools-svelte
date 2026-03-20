<script lang="ts">
  let { children }: { children: any } = $props()
</script>

<div class="scroll-list">
  {@render children()}
</div>

<style>
  .scroll-list {
    flex: 1;
    overflow-y: auto;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    min-width: 0;
  }
</style>
