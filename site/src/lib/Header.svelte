<script lang="ts">
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import SvelteMark from './SvelteMark.svelte'
  import ThemeToggle from './ThemeToggle.svelte'
  import { pkgVersion } from './version'

  const links = [
    { href: '/getting-started', label: 'Get started' },
    { href: '/mcp', label: 'MCP' },
    { href: '/#panels', label: 'Panels' },
  ]

  function isActive(href: string): boolean {
    if (href.includes('#')) return false
    const path = page.url.pathname.replace(base, '') || '/'
    return path === href || path.startsWith(href + '/')
  }
</script>

<header class="site-header">
  <div class="row">
    <a class="brand" href="{base}/" aria-label="vite-devtools-svelte home">
      <SvelteMark size={26} />
      <span class="brand-name">vite-devtools-svelte</span>
      <span class="version mono">v{pkgVersion}</span>
    </a>

    <nav aria-label="Primary">
      <ul class="links">
        {#each links as link (link.href)}
          <li>
            <a
              href="{base}{link.href}"
              class:active={isActive(link.href)}
              aria-current={isActive(link.href) ? 'page' : undefined}
            >
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
      <div class="tools">
        <a
          class="icon"
          href="https://github.com/baseballyama/vite-devtools-svelte"
          rel="noreferrer noopener"
          target="_blank"
          aria-label="GitHub repository"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.04c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.15v3.18c0 .31.21.68.8.56 4.57-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5Z"
            />
          </svg>
        </a>
        <ThemeToggle />
      </div>
    </nav>
  </div>
</header>

<style>
  .site-header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 4rem;
    padding: 0 var(--pad-x);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    color: var(--text);
    font-weight: 600;
    letter-spacing: -0.01em;
    min-width: 0;
  }

  .brand:hover {
    color: var(--text);
  }

  .brand-name {
    white-space: nowrap;
  }

  .version {
    font-size: 0.72rem;
    color: var(--text-3);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .links {
    display: flex;
    gap: 1.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .links a {
    color: var(--text-2);
    font-size: 0.95rem;
    font-weight: 500;
    padding: 0.4rem 0;
  }

  .links a:hover,
  .links a.active {
    color: var(--text);
  }

  .links a.active {
    box-shadow: inset 0 -2px 0 var(--brand);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-left: 1.25rem;
    border-left: 1px solid var(--line);
  }

  .icon {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    color: var(--text-2);
  }

  .icon:hover {
    color: var(--text);
  }

  /* Phones: brand and tools on the first line, the links on a second one. */
  @media (max-width: 760px) {
    .site-header {
      position: static;
    }

    .row {
      flex-wrap: wrap;
      row-gap: 0;
      padding-top: 0.5rem;
    }

    .version {
      display: none;
    }

    nav {
      display: contents;
    }

    .tools {
      border-left: 0;
      padding-left: 0;
      gap: 0.25rem;
    }

    .links {
      order: 3;
      flex-basis: 100%;
      gap: 1.25rem;
      border-top: 1px solid var(--line);
      margin: 0.5rem calc(-1 * var(--pad-x)) 0;
      padding: 0.35rem var(--pad-x);
    }

    .links a {
      display: inline-block;
      padding: 0.55rem 0;
    }
  }
</style>
