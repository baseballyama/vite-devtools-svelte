<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Blog</h1>
<p><small>{data.banner}</small></p>
<ul>
  {#each data.posts as slug (slug)}<li>
      <a href={resolve('/blog/[slug]', { slug })}>{slug}</a>
    </li>{/each}
</ul>
