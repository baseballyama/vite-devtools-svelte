<script lang="ts">
  let { children }: { children: any } = $props()
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
