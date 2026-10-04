<script lang="ts">
  let { start = 0 }: { start?: number } = $props()

  let count = $state(start)
  const doubled = $derived(count * 2)
</script>

<p>
  <button data-testid="increment" onclick={() => count++}>count: {count}</button>
  <span data-testid="doubled">doubled: {doubled}</span>
</p>
