<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let likes = $state(0);
</script>

<h1>{data.note.title}</h1>
<p>{data.note.body}</p>
<p>Tags: {data.note.tags.join(', ')}</p>
<button type="button" onclick={() => likes++}>♥ {likes}</button>
<a href={resolve('/notes/[slug]', { slug: data.next.slug })}>Next: {data.next.title}</a>
