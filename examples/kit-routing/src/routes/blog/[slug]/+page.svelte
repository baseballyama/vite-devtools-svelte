<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let likes = $state(0);
</script>

<svelte:head>
  <meta property="og:title" content="Blog: {data.slug}" />
</svelte:head>

<h1>{data.slug}</h1>
<p>{data.body}</p>
<button type="button" onclick={() => likes++}>♥ {likes}</button>
<p><a href={resolve('blog/missing-post')}>a slug that 404s</a></p>
