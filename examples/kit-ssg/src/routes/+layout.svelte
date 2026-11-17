<script lang="ts">
  import { resolve } from '$app/paths';

  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
  <meta property="og:site_name" content={data.siteName} />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="/og.svg" />
</svelte:head>

<header>
  <strong>{data.siteName}</strong>
  <nav>
    <a href={resolve('/')}>home</a>
    <a href={resolve('/blog')}>blog ({data.postCount})</a>
    <a href={resolve('/no-js')}>no-js (csr = false)</a>
    <a href={resolve('/client-only')}>client-only (ssr = false)</a>
    <a href={resolve('/feed.json')} data-sveltekit-reload>feed.json</a>
    <a href={resolve('/sitemap.xml')} data-sveltekit-reload>sitemap.xml</a>
  </nav>
</header>

<main>{@render children()}</main>
<footer><small>rendered at {data.renderedAt}</small></footer>

<style>
  header,
  main,
  footer {
    font-family: system-ui, sans-serif;
    padding: 0.5rem 1rem;
  }
  nav {
    display: flex;
    gap: 0.75rem;
  }
</style>
