<script lang="ts">
  import type { LayoutProps } from './$types';

  let { children, data }: LayoutProps = $props();
</script>

<div class="app">
  <header>
    (app) layout · signed in as {data.user.name} ({data.user.role}) · layout load ran in {data.ranIn}
  </header>
  {@render children()}
</div>

<style>
  .app header {
    background: #e8f0fe;
    padding: 0.5rem;
    margin-bottom: 1rem;
  }
</style>
