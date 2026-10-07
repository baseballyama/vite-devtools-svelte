<script lang="ts">
  import { untrack } from 'svelte'

  let { start = 0 }: { start?: number } = $props()

  // seeded once from the prop; later prop changes do not reset the count
  let count = $state(untrack(() => start))
  const doubled = $derived(count * 2)
</script>

<p>
  <button type="button" data-testid="increment" onclick={() => count++}>count: {count}</button>
  <span data-testid="doubled">doubled: {doubled}</span>
</p>
