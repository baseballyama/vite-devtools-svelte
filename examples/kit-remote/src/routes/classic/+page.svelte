<script lang="ts">
  import { getTodos } from '#lib/todos.remote.ts';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Classic load vs remote query</h1>
<p>From <code>+page.server.ts</code>: {data.count} todos, first “{data.first}”.</p>
<p>From <code>getTodos()</code>: {(await getTodos()).length} todos.</p>
