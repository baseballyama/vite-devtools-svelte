<script>
  import QuotedKeysChild from './QuotedKeysChild.svelte'
  let items = $state([{ "it's": 'parent', 'a\\': 'parent' }])
</script>

<QuotedKeysChild outer={items[0]} />
