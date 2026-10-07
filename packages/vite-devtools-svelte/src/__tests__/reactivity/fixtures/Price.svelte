<script>
  let { amount } = $props()
  const withTax = $derived(amount * 1.1)
</script>

<b>{withTax}</b>
