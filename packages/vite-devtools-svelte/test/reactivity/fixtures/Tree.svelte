<script>
  import Child from './Child.svelte'
  import Thrower from './Thrower.svelte'
  let rows = $state([1])
  let show = $state(false)
  let broken = $state(false)
  let kind = $state('a')
  export const api = {
    addRow: () => rows.push(rows.length + 1),
    toggle: () => (show = !show),
    break: () => (broken = true),
    reverse: () => rows.reverse(),
  }
</script>

<Child label="direct" />
{#each rows as r (r)}<Child label={'row' + r} />{/each}
{#if show}<Child label="if" />{/if}
<svelte:boundary>
  {#if broken}<Thrower />{/if}
  {#snippet failed()}<p>failed</p>{/snippet}
</svelte:boundary>
<Child label="after-boundary">
  <Child label="slotted" />
</Child>
