<script lang="ts">
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigating, page } from '$app/state';

  import { favouriteCount, prefs } from '#lib/prefs.svelte.ts';

  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  let log = $state<string[]>([]);

  beforeNavigate(({ from, to, type }) => {
    log = [
      `before ${type}: ${from?.url.pathname ?? '∅'} → ${to?.url.pathname ?? '∅'}`,
      ...log,
    ].slice(0, 6);
  });
  afterNavigate(({ to, type }) => {
    log = [`after ${type}: ${to?.url.pathname ?? '∅'}`, ...log].slice(0, 6);
  });

  const current = (href: string) => (page.url.pathname === href ? 'page' : undefined);
</script>

<div class={['shell', { dark: prefs.theme === 'dark', compact: prefs.compact }]}>
  <header>
    <strong>{data.site.name}</strong> — {data.site.tagline}
    <span class="meta">layout loaded {data.loadedAt} · ★ {favouriteCount()}</span>
  </header>
  <nav>
    <a href={resolve('/')} aria-current={current(resolve('/'))}>Home</a>
    <a href={resolve('/users')} aria-current={current(resolve('/users'))}>Users</a>
    <a href={resolve('/users/[id]', { id: '3' })}>Grace</a>
    <a href={resolve('/users/[id]', { id: '999' })}>Missing user (404)</a>
    <a href={resolve('/live')} aria-current={current(resolve('/live'))}>Live (invalidate)</a>
    <a href={resolve('/settings')} aria-current={current(resolve('/settings'))}>Settings</a>
  </nav>
  {#if navigating.to}
    <p class="loading">Loading {navigating.to.url.pathname}…</p>
  {/if}
  <main>{@render children()}</main>
  <aside>
    <h2>Navigation log</h2>
    <ol>
      {#each log as line, i (i)}<li>{line}</li>{/each}
    </ol>
  </aside>
</div>

<style>
  .shell {
    font-family: system-ui, sans-serif;
    padding: 1rem;
    min-height: 100vh;
  }
  .dark {
    background: #1b1b1f;
    color: #eee;
  }
  .compact {
    font-size: 0.85rem;
  }
  nav {
    display: flex;
    gap: 0.75rem;
    margin: 0.5rem 0 1rem;
  }
  [aria-current='page'] {
    font-weight: bold;
  }
  .meta,
  .loading {
    color: #888;
  }
</style>
