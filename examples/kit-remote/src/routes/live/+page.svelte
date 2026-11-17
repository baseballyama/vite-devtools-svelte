<script lang="ts">
  import { getClock, getRequestInfo } from '#lib/todos.remote.ts';

  const clock = getClock();
  const info = getRequestInfo();
</script>

<h1>query.live</h1>
{#if clock.ready}
  <p data-testid="tick">tick {clock.current.tick} at {clock.current.at}</p>
{:else}
  <p>connecting…</p>
{/if}
<p>connected: {clock.connected}</p>
<button type="button" onclick={() => clock.reconnect()}>Reconnect</button>

<h2>getRequestEvent()</h2>
<pre>{JSON.stringify(await info, null, 2)}</pre>
<button type="button" onclick={() => info.refresh()}>Refresh</button>
