<script>
  import Child from './Child.svelte'

  let n = $state(1)
</script>

<div class="first">{n}</div>
<Child label="second-root" />
<p class="third">tail</p>
