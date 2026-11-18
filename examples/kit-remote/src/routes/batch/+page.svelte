<script lang="ts">
  import UserRow from './UserRow.svelte';

  let count = $state(6);
</script>

<h1>query.batch</h1>
<p>Each row calls <code>getUser(id)</code>; one request answers them all.</p>
<label>Rows <input type="range" min="1" max="12" bind:value={count} /> {count}</label>
<ul>
  {#each Array.from({ length: count }, (_, i) => i + 1) as id (id)}
    <UserRow {id} />
  {/each}
</ul>
