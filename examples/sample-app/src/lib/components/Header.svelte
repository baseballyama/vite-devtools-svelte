<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { cart } from '$lib/stores/cart.svelte'

  // route ids; resolve() adds the app's base path
  const links = [
    { route: '/', label: 'Home' },
    { route: '/products', label: 'Products' },
    { route: '/cart', label: 'Cart' },
    { route: '/dashboard', label: 'Dashboard' },
  ] as const
</script>

<header>
  <a class="brand" href={resolve('/')}>☕ devtools-shop</a>
  <nav>
    {#each links as link (link.route)}
      {@const href = resolve(link.route)}
      <a
        {href}
        class:active={page.url.pathname === href ||
          (link.route !== '/' && page.url.pathname.startsWith(href))}
      >
        {link.label}
        {#if link.route === '/cart' && cart.itemCount > 0}
          <span class="badge">{cart.itemCount}</span>
        {/if}
      </a>
    {/each}
  </nav>
</header>

<style>
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    font-weight: 700;
    font-size: 18px;
    color: var(--text);
  }
  nav {
    display: flex;
    gap: 6px;
  }
  nav a {
    padding: 6px 12px;
    border-radius: 6px;
    color: var(--muted);
    position: relative;
  }
  nav a:hover {
    color: var(--text);
    text-decoration: none;
    background: var(--panel-2);
  }
  nav a.active {
    color: var(--text);
    background: var(--panel-2);
  }
  .badge {
    background: var(--accent);
    color: #0f1115;
    border-radius: 999px;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 700;
    margin-left: 4px;
  }
</style>
