<script>
  // same name as the parent's proxy, different values
  let { outer } = $props()
  let items = $state([{ label: 'child' }])
  const fromParent = $derived(outer.label)
  const own = $derived(items[0].label)
</script>

<p>{fromParent} {own}</p>
