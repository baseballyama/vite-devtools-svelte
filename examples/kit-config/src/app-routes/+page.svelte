<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let reply = $state<string | null>(null);

  async function echo() {
    const res = await fetch(resolve('/api/echo'), { method: 'POST', body: 'hello from the page' });
    reply = await res.text();
  }
</script>

<h1>Non-default SvelteKit config</h1>
<p>resolve('/') = <code>{resolve('/')}</code> (paths.base is <code>/base</code>)</p>
<ul>
  {#each data.items as item (item.id)}
    <li><a href={resolve('/items/[id]', { id: item.id })}>{item.name}</a></li>
  {/each}
</ul>
<button type="button" data-testid="echo" onclick={echo}>POST {resolve('/api/echo')}</button>
{#if reply}<pre data-testid="reply">{reply}</pre>{/if}
