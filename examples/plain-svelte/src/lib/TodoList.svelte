<script lang="ts">
  interface Todo {
    id: number
    text: string
    done: boolean
  }

  let {
    todos,
    onadd,
    ontoggle,
  }: { todos: Todo[]; onadd: (text: string) => void; ontoggle: (id: number) => void } = $props()

  let draft = $state('')
</script>

<form
  onsubmit={(e) => {
    e.preventDefault()
    if (draft.trim()) onadd(draft.trim())
    draft = ''
  }}
>
  <input data-testid="draft" bind:value={draft} placeholder="New todo" aria-label="New todo" />
  <button type="submit">Add</button>
</form>
<ul data-testid="todos">
  {#each todos as todo (todo.id)}
    <li>
      <label><input type="checkbox" checked={todo.done} onchange={() => ontoggle(todo.id)} /> {todo.text}</label>
    </li>
  {/each}
</ul>
