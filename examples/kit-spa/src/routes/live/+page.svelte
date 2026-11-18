<script lang="ts">
  import { invalidate, refreshAll } from '$app/navigation';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let auto = $state<boolean>(false);

  $effect(() => {
    if (!auto) return;
    const timer = setInterval(() => void invalidate('app:clock'), 1000);
    return () => clearInterval(timer);
  });
</script>

<h1>Live</h1>
<p>Load ran {data.runs} time(s); last at <strong data-testid="now">{data.now}</strong>.</p>
<p>
  <button type="button" data-testid="invalidate" onclick={() => invalidate('app:clock')}
    >invalidate('app:clock')</button
  >
  <button type="button" onclick={() => refreshAll()}>refreshAll()</button>
  <label><input type="checkbox" bind:checked={auto} /> every second</label>
</p>
