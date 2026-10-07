<script>
  let { todo } = $props()
  const label = $derived(todo.text.toUpperCase())
  let local = $state({ editing: false })
</script>

<li class:editing={local.editing}>{label} {todo.done}</li>
