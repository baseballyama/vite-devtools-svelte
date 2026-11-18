<script lang="ts">
  import type { Component } from 'svelte';

  import { toggleFloatingRoot } from './lib/roots';
  import { shared } from './lib/state.svelte';
  import Bindings from './sections/Bindings.svelte';
  import Blocks from './sections/Blocks.svelte';
  import Boundaries from './sections/Boundaries.svelte';
  import Directives from './sections/Directives.svelte';
  import Elements from './sections/Elements.svelte';
  import LegacyHost from './sections/LegacyHost.svelte';
  import Library from './sections/Library.svelte';
  import Problems from './sections/Problems.svelte';
  import SharedState from './sections/SharedState.svelte';
  import Stress from './sections/Stress.svelte';

  const sections: Record<string, Component> = {
    blocks: Blocks,
    elements: Elements,
    boundaries: Boundaries,
    bindings: Bindings,
    'shared-state': SharedState,
    directives: Directives,
    legacy: LegacyHost,
    library: Library,
    problems: Problems,
    stress: Stress,
  };

  let current = $state('blocks');
  const Section = $derived(sections[current]);
  let floating = $state(false);
</script>

<svelte:head>
  <title>svelte-features — {current}</title>
</svelte:head>

<header>
  <h1>svelte-features</h1>
  <nav>
    {#each Object.keys(sections) as name (name)}
      <button
        type="button"
        data-testid="nav-{name}"
        aria-current={current === name ? 'page' : undefined}
        onclick={() => (current = name)}>{name}</button
      >
    {/each}
  </nav>
  <p>
    <button type="button" data-testid="shared-click" onclick={() => shared.clicks++}>
      shared.clicks: {shared.clicks}
    </button>
    <button
      type="button"
      data-testid="toggle-floating"
      onclick={() => (floating = toggleFloatingRoot())}
    >
      {floating ? 'unmount' : 'mount'} floating root
    </button>
    <x-badge label="custom element" tone="warn"></x-badge>
  </p>
</header>

<main>
  <Section />
</main>

<style>
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  [aria-current='page'] {
    font-weight: bold;
    outline: 2px solid #ff3e00;
  }
  main {
    padding: 1rem 0 6rem;
  }
</style>
