<script>
  import Leaf from './Leaf.svelte';

  let { title, children } = $props();
</script>

<div class="card">
  {#if title}<Leaf label={title} />{/if}
  {@render children?.()}
</div>
