<script lang="ts">
  import { createTodo, getTodos, removeDone } from '#lib/todos.remote.ts';

  import TodoItem from './TodoItem.svelte';

  const todos = getTodos();
  let removed = $state<number | null>(null);
  let all = $derived(await todos);
  let doneCount = $derived(all.filter(t => t.done).length);
</script>

<h1>Todos</h1>
<p>
  {doneCount} of {all.length} done
  {#if todos.loading}<small>(refreshing…)</small>{/if}
</p>

<ul>
  {#each all as todo (todo.id)}
    <TodoItem {todo} list={todos} />
  {/each}
</ul>

<form
  {...createTodo.enhance(async instance => {
    if (await instance.submit()) instance.element.reset();
  })}
>
  <input {...createTodo.fields.text.as('text')} placeholder="New todo (≥ 3 chars)" />
  <button type="submit" disabled={createTodo.pending > 0}>
    {createTodo.pending > 0 ? 'Adding…' : 'Add'}
  </button>
  {#each createTodo.fields.text.issues() ?? [] as issue (issue.message)}
    <p class="issue" data-testid="issue">{issue.message}</p>
  {/each}
  {#if createTodo.result}<p>Created #{createTodo.result.created}</p>{/if}
</form>

<p>
  <button type="button" onclick={() => todos.refresh()}>Refresh</button>
  <button
    type="button"
    onclick={async () => {
      removed = await removeDone();
    }}>Remove done</button
  >
  {#if removed !== null}<span>removed {removed}</span>{/if}
</p>

<style>
  .issue {
    color: crimson;
  }
</style>
