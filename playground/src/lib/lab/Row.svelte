<script lang="ts">
  import type { Snippet } from 'svelte'

  import type { LabItem } from './store.svelte'

  let {
    item,
    // eslint-disable-next-line @typescript-eslint/no-useless-default-assignment -- $bindable() marks the prop bindable (bind:qty in the lab page); it is not a default value
    qty = $bindable(),
    badge,
  }: { item: LabItem; qty: number; badge: Snippet<[string]> } = $props()

  const label = $derived(item.name.toUpperCase())
  let editing = $state(false)
</script>

<li class:editing>
  {label}
  {#each [qty] as q (q)}
    {@const double = q * 2}
    <b>{double}</b>
  {/each}
  {@render badge(String(qty))}
  <button type="button" data-testid="inc" onclick={() => qty++}>+</button>
  <button type="button" onclick={() => (editing = !editing)}>edit</button>
</li>
