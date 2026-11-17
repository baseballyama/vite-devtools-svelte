<script lang="ts">
  import { asset, resolve } from '$app/paths';
  import { page } from '$app/state';

  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
  <title>kit-config — vite-devtools-svelte example</title>
  <meta property="og:title" content="kit-config" />
  <meta
    property="og:description"
    content="paths.base, appDir, files.routes, trailingSlash, embedded"
  />
  <meta property="og:image" content={asset('logo.svg')} />
  <link rel="icon" href={asset('logo.svg')} />
</svelte:head>

<header>
  <img src={asset('logo.svg')} alt="" width="24" height="24" />
  <nav>
    <a href={resolve('/')}>home</a>
    <a href={resolve('/about')}>about</a>
    <a href={resolve('/items/[id]', { id: '1' })}>items/1</a>
    <a href={resolve('/api/echo')} data-sveltekit-reload>api/echo</a>
  </nav>
  <small data-testid="pathname">{page.url.pathname} · route id {page.route.id}</small>
</header>

<main>{@render children()}</main>
<footer><small>layout load at {data.loadedAt}</small></footer>

<style>
  header,
  main,
  footer {
    font-family: system-ui, sans-serif;
    padding: 0.5rem 1rem;
  }
  header,
  nav {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
</style>
