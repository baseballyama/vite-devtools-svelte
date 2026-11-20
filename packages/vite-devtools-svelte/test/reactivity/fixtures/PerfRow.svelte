<script>
  let { item, selected } = $props();
  // re-runs on every `selected` change; false -> false for most rows
  const active = $derived(selected === item.id);
</script>

<p class:active>{item.id} {active}</p>
