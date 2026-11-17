<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<h1>{page.status}</h1>
<p>{page.error?.message}</p>
<a href={resolve('/notes')}>Back to notes</a>
