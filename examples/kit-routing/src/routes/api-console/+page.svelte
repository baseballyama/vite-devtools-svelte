<script lang="ts">
  type Call = { method: string; url: string; body?: unknown };

  const calls: Call[] = [
    { method: 'GET', url: '/api/items' },
    { method: 'GET', url: '/api/items?done=true' },
    { method: 'POST', url: '/api/items', body: { name: 'From the console' } },
    { method: 'PUT', url: '/api/items', body: { id: 1, name: 'Renamed', done: true } },
    { method: 'PATCH', url: '/api/items', body: { id: 2, done: true } },
    { method: 'DELETE', url: '/api/items?id=3' },
    { method: 'OPTIONS', url: '/api/items' },
    { method: 'PROPFIND', url: '/api/items' },
    { method: 'GET', url: '/api/text' },
    { method: 'GET', url: '/api/stream' },
    { method: 'GET', url: '/.well-known' },
  ];

  let output = $state('');
  let busy = $state(false);

  async function run(call: Call) {
    busy = true;
    output = `${call.method} ${call.url}\n`;
    try {
      await send(call);
    } catch (error) {
      output += `→ ${String(error)}\n`;
    } finally {
      busy = false;
    }
  }

  async function send(call: Call) {
    const response = await fetch(call.url, {
      method: call.method,
      headers: call.body ? { 'content-type': 'application/json' } : undefined,
      body: call.body ? JSON.stringify(call.body) : undefined,
    });
    output += `→ ${response.status} ${response.headers.get('content-type') ?? ''}\n`;
    // Read streamed bodies chunk by chunk so /api/stream fills in live.
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      output += value;
    }
  }
</script>

<h1>API endpoints</h1>
<p>The same endpoints are listed in the DevTools <strong>API</strong> panel.</p>
<div class="calls">
  {#each calls as call (call.method + call.url)}
    <button type="button" disabled={busy} onclick={() => run(call)}>{call.method} {call.url}</button
    >
  {/each}
</div>
<pre data-testid="api-output">{output}</pre>

<style>
  .calls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  pre {
    background: #f4f4f7;
    padding: 0.5rem;
    min-height: 6rem;
  }
</style>
