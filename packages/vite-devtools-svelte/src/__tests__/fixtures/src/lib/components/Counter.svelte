<script>
  import { onMount } from 'svelte'
  let count = $state(0)
</script>
<button onclick={() => count++}>{count}</button>
