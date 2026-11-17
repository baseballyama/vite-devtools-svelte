<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Docs</h1>
<p>Rest param <code>[...path]</code>:</p>
<ol>
  {#each data.segments as segment, i (i)}<li>{segment}</li>{/each}
</ol>
<p>
  <a href={resolve('docs')}>/docs</a> (empty rest) ·
  <a href={resolve('docs/a/b/c/d')}>/docs/a/b/c/d</a>
</p>
