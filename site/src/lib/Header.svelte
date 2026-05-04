<script lang="ts">
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import ThemeToggle from './ThemeToggle.svelte'

  const links = [
    { href: '/', label: 'Home' },
    { href: '/getting-started', label: 'Getting Started' },
    { href: '/try', label: 'Try Live' },
    { href: '/roadmap', label: 'Roadmap' },
  ]

  function isActive(href: string): boolean {
    const path = page.url.pathname.replace(base, '') || '/'
    if (href === '/') return path === '/'
    return path === href || path.startsWith(href + '/')
  }
</script>

<header class="site-header">
  <div class="container row">
    <a class="brand" href="{base}/">
      <span class="logo" aria-hidden="true">◆</span>
      <span class="brand-name">vite-devtools-plugin-svelte</span>
    </a>
    <nav>
      {#each links as link (link.href)}
        <a
          href="{base}{link.href}"
          class="nav-link"
          class:active={isActive(link.href)}
        >
          {link.label}
        </a>
      {/each}
      <a
        class="nav-link"
        href="https://github.com/baseballyama/vite-devtools-svelte"
        rel="noreferrer noopener"
        target="_blank"
      >
        GitHub
      </a>
      <ThemeToggle />
    </nav>
  </div>
</header>

<style>
  .site-header {
    position: sticky;
    top: 0;
    z-index: 50;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    border-bottom: 1px solid var(--border);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    gap: 1rem;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--text);
    font-weight: 700;
    font-size: 0.95rem;
  }

  .brand:hover {
    text-decoration: none;
  }

  .logo {
    color: var(--brand);
    font-size: 1.1rem;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .nav-link {
    color: var(--text-dim);
    padding: 0.4rem 0.7rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .nav-link:hover {
    background: var(--bg-elev-2);
    color: var(--text);
    text-decoration: none;
  }

  .nav-link.active {
    color: var(--text);
    background: var(--bg-elev-2);
  }

  @media (max-width: 720px) {
    .brand-name {
      display: none;
    }
  }
</style>
