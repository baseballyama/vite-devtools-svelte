<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import { prefs, toggleFavourite } from '#lib/prefs.svelte.ts';
  import type { User } from '#lib/users.ts';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let query = $state('');
  let visible = $derived(
    data.users.filter((u: User) => u.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  function filterRole(role: string) {
    // Programmatic navigation: re-runs this page's load with the new search param.
    void goto(resolve(role ? `/users?role=${role}` : '/users'));
  }
</script>

<h1>Users</h1>
<p>
  Role:
  <select value={data.role ?? ''} onchange={e => filterRole(e.currentTarget.value)}>
    <option value="">all</option>
    <option value="admin">admin</option>
    <option value="editor">editor</option>
    <option value="viewer">viewer</option>
  </select>
  <input placeholder="Filter by name" bind:value={query} />
</p>
<ul>
  {#each visible as user (user.id)}
    <li>
      <button type="button" onclick={() => toggleFavourite(user.id)}
        >{prefs.favourites.includes(user.id) ? '★' : '☆'}</button
      >
      <a href={resolve('/users/[id]', { id: String(user.id) })}>{user.name}</a>
      <small>{user.role}</small>
    </li>
  {:else}
    <li>No match</li>
  {/each}
</ul>
