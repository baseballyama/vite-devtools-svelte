<script>
  import BigRow from './BigRow.svelte'
  let { n = 100 } = $props()
  const rows = $state(Array.from({ length: n }, (_, i) => ({ id: i, text: 'row' })))
</script>

{#each rows as row (row.id)}<BigRow {row} />{/each}
