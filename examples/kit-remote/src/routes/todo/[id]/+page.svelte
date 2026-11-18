<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  import { getTodo, getUser } from '#lib/todos.remote.ts';

  // `$derived(await …)` re-runs when the param changes.
  let id = $derived(Number(page.params.id));
  // Both start together (no waterfall), then the component waits for both.
  let [todo, owner] = $derived(await Promise.all([getTodo(id), getUser(id)]));
</script>

<h1>Todo #{todo.id}</h1>
<p>{todo.text} — {todo.done ? 'done' : 'open'}</p>
<p>Owner: {owner.name}</p>
<nav>
  {#each [1, 2, 3] as other (other)}
    <a href={resolve('/todo/[id]', { id: String(other) })}>#{other}</a>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    gap: 0.5rem;
  }
</style>
