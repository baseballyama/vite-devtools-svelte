<!-- Legacy mode on purpose (export let, $:, createEventDispatcher, <slot>): no runes. -->
<script lang="ts">
  // Legacy mode on purpose: export let, $:, createEventDispatcher, <slot>.
  import { createEventDispatcher } from 'svelte';

  export let start = 0;

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const dispatch = createEventDispatcher<{ change: number }>();
  let count = start;
  $: doubled = count * 2;
  $: if (count > 10) console.info('[legacy] count passed 10');

  function increment() {
    count += 1;
    dispatch('change', count);
  }
</script>

<div class="legacy">
  <slot />
  <p>count = {count}, doubled = {doubled} (start prop = {start})</p>
  <button type="button" data-testid="legacy-inc" on:click={increment}>increment</button>
  <slot name="footer" />
</div>

<style>
  .legacy {
    border: 1px dotted #999;
    padding: 0.5rem;
  }
</style>
