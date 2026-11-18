<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Blog</h1>
<ul>
  {#each data.posts as post (post.slug)}
    <li>
      <a href={resolve('/blog/[slug]', { slug: post.slug })}>{post.title}</a>
      <small>{post.date}</small>
    </li>
  {/each}
</ul>
