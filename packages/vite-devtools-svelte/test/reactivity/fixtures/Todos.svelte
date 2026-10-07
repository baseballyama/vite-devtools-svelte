<script>
  import TodoItem from './TodoItem.svelte'
  let todos = $state([{ text: 'a', done: false }])
  let filter = $state({ onlyOpen: false })
  const open = $derived(todos.filter(t => !t.done).length)
  export const api = {
    add: () => todos.push({ text: 'b', done: false }),
    toggleFilter: () => (filter.onlyOpen = !filter.onlyOpen),
  }
</script>

<p>{open}</p>
{#if filter.onlyOpen}<span>open only</span>{/if}
{#each todos as todo (todo)}<TodoItem {todo} />{/each}
