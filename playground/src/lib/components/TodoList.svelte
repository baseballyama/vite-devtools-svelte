<script lang="ts">
  interface Todo {
    id: number
    text: string
    done: boolean
  }

  let todos = $state<Todo[]>([
    { id: 1, text: 'Try Svelte DevTools', done: false },
    { id: 2, text: 'Check component tree', done: false },
    { id: 3, text: 'Explore routes panel', done: true },
  ])

  let newTodo = $state('')
  let nextId = $state(4)

  let remaining = $derived(todos.filter(t => !t.done).length)

  function addTodo() {
    if (!newTodo.trim()) return
    todos.push({ id: nextId++, text: newTodo.trim(), done: false })
    newTodo = ''
  }

  function removeTodo(id: number) {
    const idx = todos.findIndex(t => t.id === id)
    if (idx !== -1) todos.splice(idx, 1)
  }
</script>

<div class="todo-list">
  <h3>Todo List ({remaining} remaining)</h3>

  <form onsubmit={(e) => { e.preventDefault(); addTodo(); }}>
    <input
      type="text"
      placeholder="Add a todo..."
      bind:value={newTodo}
    />
    <button type="submit">Add</button>
  </form>

  <ul>
    {#each todos as todo (todo.id)}
      <li class:done={todo.done}>
        <label>
          <input type="checkbox" bind:checked={todo.done} />
          <span>{todo.text}</span>
        </label>
        <button class="remove" onclick={() => removeTodo(todo.id)}>x</button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .todo-list {
    background: #1e1e3a;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    padding: 16px;
  }

  h3 {
    color: #ff3e00;
    margin-bottom: 12px;
  }

  form {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  input[type='text'] {
    flex: 1;
    background: #12122a;
    border: 1px solid #2a2a4a;
    border-radius: 4px;
    padding: 8px;
    color: #e0e0e0;
    font-size: 13px;
  }

  input[type='text']:focus {
    outline: none;
    border-color: #ff3e00;
  }

  form button {
    background: #ff3e00;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    cursor: pointer;
  }

  ul {
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #2a2a4a;
  }

  li:last-child {
    border-bottom: none;
  }

  li.done span {
    text-decoration: line-through;
    color: #666;
  }

  label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .remove {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }

  .remove:hover {
    color: #ff6b6b;
  }
</style>
