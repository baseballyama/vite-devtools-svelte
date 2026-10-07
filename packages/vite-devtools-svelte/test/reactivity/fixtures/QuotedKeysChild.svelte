<script>
  // same proxy name as the parent's, different values; keys that Svelte
  // labels unescaped in quotes: items[0]['it's'], items[0]['a\']
  let { outer } = $props()
  let items = $state([{ "it's": 'child', 'a\\': 'child' }])
  const quote = $derived(outer["it's"])
  const backslash = $derived(outer['a\\'])
  const own = $derived(items[0]["it's"])
</script>

<p>{quote} {backslash} {own}</p>
