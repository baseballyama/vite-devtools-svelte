<script>
  let { label = 'child', children } = $props()
  let own = $state(0)
</script>

<span>{label}{own}</span>
{@render children?.()}
