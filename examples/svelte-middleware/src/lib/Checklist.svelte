<script lang="ts">
  let { items }: { items: string[] } = $props();

  let done = $state<Record<string, boolean>>({});
  let remaining = $derived(items.filter(item => !done[item]).length);
</script>

<section>
  <h2>Checklist ({remaining} left)</h2>
  <ul>
    {#each items as item (item)}
      <li>
        <label><input type="checkbox" bind:checked={done[item]} /> {item}</label>
      </li>
    {/each}
  </ul>
</section>
