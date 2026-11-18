<script lang="ts">
  import { Card, LibButton, Tabs } from 'examples-ui-lib';

  import Ticker from '../components/Ticker.svelte';
  import Tree from '../components/Tree.svelte';

  let presses = $state(0);
  let tab = $state('ticker');
</script>

<h2>Library components (examples-ui-lib, from node_modules)</h2>
<p>
  Card / LibButton / Tabs come from a library: they are not in the Components tree, and the app
  components passed into them sit under this section.
</p>

<Card title="Card from the library">
  <Ticker label="app Ticker inside a library Card" />
  <LibButton onclick={() => presses++}>library button</LibButton>
  <p>app saw {presses} presses</p>
  {#snippet footer()}
    footer snippet from the app
  {/snippet}
</Card>

<Tabs tabs={['ticker', 'tree']} bind:active={tab}>
  {#snippet panel(name)}
    {#if name === 'ticker'}
      <Ticker label="inside library Tabs" />
    {:else}
      <Tree node={{ name: 'lib-tree', children: [{ name: 'x' }, { name: 'y' }] }} />
    {/if}
  {/snippet}
</Tabs>
