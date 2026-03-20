<script lang="ts">
  let { width = '320px', children }: { width?: string; children: any } = $props()
</script>

<aside class="detail-panel" style:width={width} style:min-width={width}>
  {@render children()}
</aside>

<style>
  .detail-panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    padding: var(--space-3);
    overflow-y: auto;
  }
</style>
