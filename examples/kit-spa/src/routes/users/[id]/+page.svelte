<script lang="ts">
  import { resolve } from '$app/paths';

  import { prefs, toggleFavourite } from '#lib/prefs.svelte.ts';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let favourite = $derived(prefs.favourites.includes(data.user.id));
</script>

<h1>{data.user.name}</h1>
<p>{data.user.bio}</p>
<p>
  <button type="button" onclick={() => toggleFavourite(data.user.id)}
    >{favourite ? 'Unfavourite' : 'Favourite'}</button
  >
  <a href={resolve('/users/[id]', { id: String(data.next.id) })}>Next: {data.next.name}</a>
</p>
