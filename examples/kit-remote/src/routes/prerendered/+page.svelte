<script lang="ts">
  import { getBuildInfo } from '#lib/todos.remote.ts';

  const info = await getBuildInfo();
</script>

<h1>prerender()</h1>
<p>Built at {info.builtAt} with {info.todoCount} todos.</p>
