<script lang="ts">
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<div class="admin">
  <p><strong>admin layout</strong> (skipped by /admin/reports)</p>
  {@render children()}
</div>

<style>
  .admin {
    border: 2px dashed #999;
    padding: 0.5rem;
  }
</style>
