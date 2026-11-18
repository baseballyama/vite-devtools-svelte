<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let clicks = $state(0);
</script>

<h1>Home</h1>
<p>{data.count} notes. Every link here is a <code>#/…</code> hash link.</p>
<button type="button" data-testid="clicks" onclick={() => clicks++}>clicked {clicks} times</button>
