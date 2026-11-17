<script>
  /** @type {{ tabs: string[], active?: string, panel: import('svelte').Snippet<[string]> }} */
  let { tabs, active = $bindable(tabs[0]), panel } = $props();
</script>

<div class="lib-tabs" role="tablist">
  {#each tabs as tab (tab)}
    <button type="button" role="tab" aria-selected={tab === active} onclick={() => (active = tab)}
      >{tab}</button
    >
  {/each}
</div>
<div role="tabpanel">{@render panel(active ?? tabs[0] ?? '')}</div>
