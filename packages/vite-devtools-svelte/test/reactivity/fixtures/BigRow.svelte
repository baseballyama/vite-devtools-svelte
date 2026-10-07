<script>
  let { row } = $props()
  let local = $state({ open: false, n: 0 })
</script>

<p class:open={local.open}>{row.text} {local.n}</p>
