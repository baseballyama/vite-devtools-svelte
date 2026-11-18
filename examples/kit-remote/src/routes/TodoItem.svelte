<script lang="ts">
  import type { RemoteQuery } from '$app/server';

  import type { Todo } from '#lib/server/db.ts';
  import { toggleTodo } from '#lib/todos.remote.ts';

  let { todo, list }: { todo: Todo; list: RemoteQuery<Todo[]> } = $props();
  let flips = $state(0);

  async function toggle() {
    flips++;
    // Optimistic: the list shows the new value until the command resolves.
    await toggleTodo(todo.id).updates(
      list.withOverride(all => all.map(t => (t.id === todo.id ? { ...t, done: !t.done } : t))),
    );
  }
</script>

<li>
  <label>
    <input type="checkbox" checked={todo.done} onchange={toggle} data-testid="toggle-{todo.id}" />
    {todo.text}
  </label>
  <small>toggled {flips}×</small>
</li>
