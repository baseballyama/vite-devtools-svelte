<script lang="ts">
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
  let banner = $state(true);
</script>

{#if banner}
  <aside class="banner">
    (marketing) group layout — not part of the URL
    <button type="button" onclick={() => (banner = false)}>dismiss</button>
  </aside>
{/if}
{@render children()}

<style>
  .banner {
    background: #fff4d6;
    padding: 0.5rem;
    margin-bottom: 1rem;
  }
</style>
