<script lang="ts">
  import { resolve } from '$app/paths';

  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<svelte:head>
  <title>kit-remote — vite-devtools-svelte example</title>
  <meta property="og:title" content="kit-remote" />
  <meta property="og:description" content="SvelteKit remote functions with Svelte async" />
</svelte:head>

<nav>
  <a href={resolve('/')}>todos (query/form/command)</a>
  <a href={resolve('/todo/[id]', { id: '2' })}>todo/2 ($derived await)</a>
  <a href={resolve('/batch')}>query.batch</a>
  <a href={resolve('/errors')}>errors</a>
  <a href={resolve('/live')}>query.live</a>
  <a href={resolve('/classic')}>classic load</a>
  <a href={resolve('/prerendered')}>prerender</a>
</nav>

<main>
  <svelte:boundary>
    {@render children()}
    {#snippet pending()}
      <p class="pending">Loading the page…</p>
    {/snippet}
  </svelte:boundary>
</main>

<style>
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #ddd;
    font-family: system-ui, sans-serif;
  }
  main {
    padding: 1rem;
    font-family: system-ui, sans-serif;
  }
  .pending {
    color: #888;
  }
</style>
