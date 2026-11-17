<script>
  let todos = $state([{ text: 'milk' }])
  let selected = $state(null)
  export const api = {
    select: () => (selected = todos[0]),
    edit: () => (todos[0].text = 'oat milk'),
  }
</script>

<p>{todos[0].text}</p>
