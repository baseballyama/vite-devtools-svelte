<script>
  import ShadowChild from './ShadowChild.svelte'
  let items = $state([{ label: 'parent' }])
</script>

<ShadowChild outer={items[0]} />
