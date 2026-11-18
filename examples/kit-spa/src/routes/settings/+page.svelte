<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import { prefs } from '#lib/prefs.svelte.ts';
</script>

<h1>Settings</h1>
<p>Stored in localStorage; reload the page and they stay.</p>
<label>
  Theme
  <select bind:value={prefs.theme}>
    <option value="light">light</option>
    <option value="dark">dark</option>
  </select>
</label>
<label><input type="checkbox" bind:checked={prefs.compact} /> compact</label>
<p>Favourites: {prefs.favourites.join(', ') || 'none'}</p>
<button type="button" onclick={() => (prefs.favourites = [])}>Clear favourites</button>
<button type="button" onclick={() => goto(resolve('/users'))}>goto('/users')</button>
