<script lang="ts">
  import { invalidate, refreshAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let refreshing = $state(false);

  async function refresh(all: boolean) {
    refreshing = true;
    await (all ? refreshAll() : invalidate('app:clock'));
    refreshing = false;
  }
</script>

<h1>Dashboard</h1>
<p>
  Four loads on one chain: <code>(app)/+layout.server.ts</code> → <code>(app)/+layout.ts</code> →
  <code>dashboard/+page.server.ts</code> → <code>dashboard/+page.ts</code>.
</p>
<dl>
  <dt>server time (depends 'app:clock')</dt>
  <dd data-testid="server-time">{data.serverTime}</dd>
  <dt>client time (+page.ts)</dt>
  <dd>{data.clientTime}</dd>
  <dt>revenue (Money via transport)</dt>
  <dd>{data.revenue.format()}</dd>
  <dt>items (fetched through handleFetch)</dt>
  <dd>{data.items.map(i => i.name).join(', ')}</dd>
  <dt>streamed stats</dt>
  <dd>
    {#await data.slowStats}
      loading…
    {:then stats}
      {stats.visitors} visitors, {(stats.conversion * 100).toFixed(1)}% conversion
    {/await}
  </dd>
</dl>
<button type="button" disabled={refreshing} onclick={() => refresh(false)}
  >invalidate('app:clock')</button
>
<button type="button" disabled={refreshing} onclick={() => refresh(true)}>refreshAll()</button>
<p><a href={resolve('dashboard/fail')}>a child route that throws (nested +error.svelte)</a></p>
