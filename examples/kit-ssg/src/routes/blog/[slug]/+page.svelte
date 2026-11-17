<script lang="ts">
  import type { PageProps } from './$types';
  import Likes from './Likes.svelte';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.post.title} — kit-ssg</title>
  <meta property="og:title" content={data.post.title} />
  <meta property="og:description" content={data.post.body} />
</svelte:head>

<article>
  <h1>{data.post.title}</h1>
  <p><small>{data.post.date} · {data.words} words</small></p>
  <p>{data.post.body}</p>
</article>
<!-- Remounted per post (the page component itself is reused across [slug]) -->
{#key data.post.slug}
  <Likes slug={data.post.slug} />
{/key}
