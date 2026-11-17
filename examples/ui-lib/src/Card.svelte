<script>
  /** @type {{ title: string, children?: import('svelte').Snippet, footer?: import('svelte').Snippet }} */
  let { title, children, footer } = $props();
  let open = $state(true);
</script>

<section class="lib-card">
  <header>
    <strong>{title}</strong>
    <button type="button" onclick={() => (open = !open)}>{open ? '−' : '+'}</button>
  </header>
  {#if open}
    <div class="lib-card-body">{@render children?.()}</div>
  {/if}
  {#if footer}<footer>{@render footer()}</footer>{/if}
</section>

<style>
  .lib-card {
    border: 1px solid #c7c7d1;
    border-radius: 8px;
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
</style>
