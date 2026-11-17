<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  // In hash mode resolve() returns `#/notes/nested-layouts`.
  const target = resolve('/notes/[slug]', { slug: 'nested-layouts' });
</script>

<h1>About</h1>
<p>A SvelteKit app on the hash router. The Routes panel still lists the file-based routes.</p>
<button type="button" onclick={() => goto(target)}>goto('{target}')</button>
