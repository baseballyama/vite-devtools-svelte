<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';

  import Ticker from '../components/Ticker.svelte';
  import Tree, { type Node } from '../components/Tree.svelte';

  let showTicker = $state(true);

  let nextId = 4;
  let items = $state([
    { id: 1, text: 'one' },
    { id: 2, text: 'two' },
    { id: 3, text: 'three' },
  ]);
  const add = () => items.push({ id: nextId, text: `item ${nextId++}` });
  const remove = (id: number) => (items = items.filter(i => i.id !== id));
  const shuffle = () => (items = items.toSorted(() => Math.random() - 0.5));
  const reverse = () => items.reverse();

  let generation = $state(0);

  let promise = $state<Promise<string>>(Promise.resolve('initial value'));
  const settle = (ok: boolean) =>
    (promise = new Promise((resolve, reject) =>
      setTimeout(
        () =>
          ok
            ? resolve(`resolved at ${new Date().toLocaleTimeString()}`)
            : reject(new Error('rejected on purpose')),
        600,
      ),
    ));

  const tree: Node = {
    name: 'root',
    children: [
      { name: 'a', children: [{ name: 'a1' }, { name: 'a2', children: [{ name: 'a2x' }] }] },
      { name: 'b' },
    ],
  };
</script>

<h2>Blocks</h2>

<section>
  <h3>{'{#if}'} mount / unmount</h3>
  <button type="button" data-testid="toggle-ticker" onclick={() => (showTicker = !showTicker)}>
    {showTicker ? 'unmount' : 'mount'} Ticker
  </button>
  {#if showTicker}
    <div transition:fade><Ticker /></div>
  {/if}
</section>

<section>
  <h3>keyed {'{#each}'} + animate:flip + transitions</h3>
  <button type="button" data-testid="each-add" onclick={add}>add</button>
  <button type="button" data-testid="each-shuffle" onclick={shuffle}>shuffle</button>
  <button type="button" data-testid="each-reverse" onclick={reverse}>reverse</button>
  <ul>
    {#each items as item (item.id)}
      <li animate:flip={{ duration: 200 }} transition:slide>
        {item.text}
        <button type="button" data-testid="each-remove-{item.id}" onclick={() => remove(item.id)}
          >×</button
        >
      </li>
    {/each}
  </ul>
</section>

<section>
  <h3>{'{#key}'} remount</h3>
  <button type="button" data-testid="key-remount" onclick={() => generation++}
    >remount (generation {generation})</button
  >
  {#key generation}
    <Ticker label="keyed #{generation}" />
  {/key}
</section>

<section>
  <h3>{'{#await}'}</h3>
  <button type="button" data-testid="await-resolve" onclick={() => settle(true)}>resolve</button>
  <button type="button" data-testid="await-reject" onclick={() => settle(false)}>reject</button>
  {#await promise}
    <p>pending…</p>
  {:then value}
    <p>then: {value}</p>
  {:catch error}
    <p>catch: {error.message}</p>
  {/await}
</section>

<section>
  <h3>recursive Tree</h3>
  <Tree node={tree} />
</section>
