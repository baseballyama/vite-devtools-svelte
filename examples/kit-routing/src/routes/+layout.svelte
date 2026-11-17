<script lang="ts">
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigating, page, updated } from '$app/state';

  import type { LayoutProps } from './$types';

  let { children, data }: LayoutProps = $props();

  // The last few navigations, so before/afterNavigate show up as state changes.
  let log = $state<string[]>([]);
  beforeNavigate(({ from, to, type }) => {
    log = [
      `before ${type}: ${from?.url.pathname ?? '∅'} → ${to?.url.pathname ?? '∅'}`,
      ...log,
    ].slice(0, 4);
  });
  afterNavigate(({ to, type }) => {
    log = [`after ${type}: ${to?.url.pathname ?? '∅'}`, ...log].slice(0, 4);
  });

  // `resolve()` takes pathnames without a leading slash in SvelteKit 3 (a leading
  // slash means a route ID) and adds the base path.
  const links = [
    [resolve(''), 'home'],
    [resolve('about'), '(marketing)/about'],
    [resolve('pricing'), 'pricing (prerender)'],
    [resolve('landing'), 'landing (+page@)'],
    [resolve('dashboard'), '(app)/dashboard'],
    [resolve('settings'), 'settings (named actions)'],
    [resolve('contact'), 'contact (default action)'],
    [resolve('admin'), 'admin'],
    [resolve('admin/reports'), 'reports (+layout@(app))'],
    [resolve('blog'), 'blog (.js load)'],
    [resolve('blog/hello-world'), 'blog/[slug]'],
    [resolve('lang'), 'lang/[[lang]]'],
    [resolve('lang/ja'), 'lang/ja'],
    [resolve('docs/guide/routing/advanced'), 'docs/[...path]'],
    [resolve('items/2'), 'items/[id=integer]'],
    [resolve('items/abc'), 'items/abc (no match)'],
    [resolve('files/report.pdf'), 'files/[name].[ext]'],
    [resolve('.well-known'), '[x+2e]well-known'],
    [resolve('photos'), 'photos (shallow)'],
    [resolve('static-only'), 'csr = false'],
    [resolve('slash/'), 'trailingSlash always'],
    [resolve('old-redirect'), 'redirect()'],
    [resolve('broken'), 'error(418)'],
    [resolve('crash'), 'unexpected throw'],
    [resolve('dashboard/fail'), 'nested +error'],
    [resolve('api-console'), 'API endpoints'],
  ];
</script>

<svelte:head>
  <title>kit-routing — {page.url.pathname}</title>
  <meta property="og:title" content="kit-routing" />
  <meta property="og:description" content="Every SvelteKit routing and data-loading feature" />
</svelte:head>

<div class="shell">
  <nav aria-label="Routes">
    <strong>kit-routing</strong>
    <ul>
      {#each links as [href, label] (href)}
        <li>
          <!-- /.well-known is an endpoint (JSON), not a page: load it as a document -->
          <!-- every href in `links` comes from resolve() (the rule can't see through the array) -->
          <!-- eslint-disable svelte/no-navigation-without-resolve -->
          <a
            {href}
            aria-current={new URL(href, page.url.href).pathname === page.url.pathname
              ? 'page'
              : undefined}
            data-sveltekit-reload={href.endsWith('/.well-known') ? '' : undefined}>{label}</a
          >
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        </li>
      {/each}
      <li>
        <!-- Not a route: src/hooks.ts reroutes it to /about, so resolve() can't type it. -->
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href="/legacy-about">reroute → about</a>
      </li>
    </ul>
    <p class="meta">
      request {data.requestId} · route <code>{page.route.id ?? '∅'}</code>
      {#if navigating.to}· navigating to {navigating.to.url.pathname}…{/if}
      {#if updated.current}· a new version is available{/if}
    </p>
    <ol class="meta">
      {#each log as entry, i (i)}<li>{entry}</li>{/each}
    </ol>
  </nav>
  <main>{@render children()}</main>
</div>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    margin: 0;
  }
  .shell {
    display: grid;
    grid-template-columns: 16rem 1fr;
    min-height: 100vh;
  }
  nav {
    background: #f4f4f7;
    padding: 1rem;
    font-size: 0.9rem;
  }
  nav ul {
    list-style: none;
    padding: 0;
  }
  nav li {
    margin: 0.15rem 0;
  }
  a[aria-current='page'] {
    font-weight: bold;
  }
  .meta {
    color: #666;
    font-size: 0.8rem;
  }
  main {
    padding: 1rem 2rem;
  }
</style>
