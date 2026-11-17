<script lang="ts">
  import { untrack } from 'svelte';

  import {
    Counter,
    globalCounter,
    log,
    rawLog,
    rootEffect,
    shared,
    snapshot,
    toggleRootEffect,
  } from '../lib/state.svelte';

  // A Counter instance created inside this component.
  const local = new Counter('local');

  let lastSnapshot = $state('');
  let preSeen = $state<number[]>([]);
  let tag = $state('');

  // $effect.pre: runs before the DOM updates.
  $effect.pre(() => {
    const count = local.count;
    untrack(() => (preSeen = [...preSeen.slice(-4), count]));
  });

  // $inspect on purpose: logs to the console whenever these change.
  // eslint-disable-next-line svelte/no-inspect
  $inspect(local.count, shared.clicks);
</script>

<h2>Shared .svelte.ts state</h2>

<h3>module $state object</h3>
<p>shared.clicks = {shared.clicks}, tags: {shared.tags.join(', ')}</p>
<button type="button" data-testid="shared-inc" onclick={() => shared.clicks++}
  >shared.clicks++</button
>
<input bind:value={tag} placeholder="new tag" />
<button
  type="button"
  data-testid="shared-tag"
  onclick={() => {
    shared.tags.push(tag || `tag${shared.tags.length}`);
    log(`tag added: ${tag}`);
    tag = '';
  }}>push tag</button
>

<h3>class instances ($state / $derived fields)</h3>
{#each [globalCounter, local] as c (c.name)}
  <p>
    {c.name}: count={c.count} step={c.step} doubled={c.doubled} ({c.parity})
    <button type="button" data-testid="counter-{c.name}" onclick={c.increment}>+{c.step}</button>
    <input type="number" bind:value={c.step} min="1" max="10" />
  </p>
{/each}

<h3>$state.raw</h3>
<button type="button" data-testid="raw-log" onclick={() => log(`raw at ${Date.now()}`)}>log</button>
<ul>
  {#each rawLog.entries as e, i (i)}<li>{e}</li>{/each}
</ul>

<h3>$effect.pre / $effect.root / $state.snapshot</h3>
<p>local.count seen by $effect.pre (before the DOM update): {preSeen.join(', ')}</p>
<p>
  $effect.root outside a component: {rootEffect.running ? 'running' : 'stopped'}, runs {rootEffect.runs}
  <button type="button" data-testid="root-effect" onclick={toggleRootEffect}>
    {rootEffect.running ? 'stop' : 'start'}
  </button>
</p>
<button
  type="button"
  data-testid="snapshot"
  onclick={() => (lastSnapshot = JSON.stringify(snapshot()))}
>
  $state.snapshot(shared)
</button>
<pre>{lastSnapshot}</pre>
