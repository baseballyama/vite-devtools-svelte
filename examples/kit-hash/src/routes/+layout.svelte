<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<header>
  <strong>kit-hash</strong> · started {data.startedAt} · route id <code>{page.route.id}</code> · URL
  <code>{page.url.hash || '#/'}</code>
</header>
<nav>
  <a href={resolve('/')}>Home</a>
  <a href={resolve('/notes')}>Notes</a>
  <a href={resolve('/notes/[slug]', { slug: 'hash-router' })}>Hash router note</a>
  <a href={resolve('/notes/[slug]', { slug: 'does-not-exist' })}>Missing note (404)</a>
  <a href={resolve('/about')}>About</a>
</nav>
<main>{@render children()}</main>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    margin: 1rem;
  }
  nav {
    display: flex;
    gap: 0.75rem;
    margin: 0.5rem 0 1rem;
  }
</style>
