<script lang="ts">
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import ThemeToggle from './ThemeToggle.svelte'
  import { pkgVersion } from './version'

  const links = [
    { href: '/', label: 'Home', short: '/' },
    { href: '/getting-started', label: 'Getting Started', short: 'start' },
    { href: '/try', label: 'Try Live', short: 'try' },
  ]

  function isActive(href: string): boolean {
    const path = page.url.pathname.replace(base, '') || '/'
    if (href === '/') return path === '/'
    return path === href || path.startsWith(href + '/')
  }
</script>

<header class="site-header">
  <div class="container row">
    <a class="brand" href="{base}/" aria-label="vite-devtools-svelte home">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            d="M12 2 L22 12 L12 22 L2 12 Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="miter"
          />
          <path
            d="M7 12 L12 7 L17 12 L12 17 Z"
            fill="currentColor"
            opacity="0.85"
          />
        </svg>
      </span>
      <span class="brand-text">
        <span class="brand-name">vite-devtools-svelte</span>
        <span class="brand-tag mono">v{pkgVersion}</span>
      </span>
    </a>

    <nav aria-label="Primary">
      {#each links as link (link.href)}
        <a
          href="{base}{link.href}"
          class="nav-link"
          class:active={isActive(link.href)}
        >
          <span class="nav-arrow" aria-hidden="true">→</span>
          {link.label}
        </a>
      {/each}
      <span class="nav-sep" aria-hidden="true"></span>
      <a
        class="nav-link icon-link"
        href="https://github.com/baseballyama/vite-devtools-svelte"
        rel="noreferrer noopener"
        target="_blank"
        aria-label="GitHub repository"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.04c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.15v3.18c0 .31.21.68.8.56 4.57-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5Z"
          />
        </svg>
        <span class="nav-label">GitHub</span>
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
    backdrop-filter: blur(12px) saturate(160%);
    -webkit-backdrop-filter: blur(12px) saturate(160%);
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    border-bottom: 1px solid var(--line);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.5rem;
    gap: 1rem;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    color: var(--text);
    font-weight: 500;
    font-size: 0.92rem;
  }

  .brand:hover {
    text-decoration: none;
    color: var(--text);
  }

  .mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--brand);
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    transition:
      transform 240ms var(--ease-out),
      border-color 200ms var(--ease);
  }

  .brand:hover .mark {
    transform: rotate(45deg);
    border-color: var(--brand);
  }

  .brand-text {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .brand-name {
    font-family: var(--font-mono);
    font-size: 0.88rem;
    letter-spacing: -0.01em;
  }

  .brand-tag {
    color: var(--text-3);
    font-size: 0.7rem;
    letter-spacing: 0.05em;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .nav-link {
    position: relative;
    color: var(--text-2);
    padding: 0.45rem 0.75rem;
    border-radius: 6px;
    font-size: 0.88rem;
    font-weight: 500;
    transition:
      color 150ms var(--ease),
      background 150ms var(--ease);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .nav-arrow {
    display: inline-block;
    color: var(--text-4);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    opacity: 0;
    transform: translateX(-4px);
    transition:
      opacity 200ms var(--ease),
      transform 200ms var(--ease),
      color 200ms var(--ease);
  }

  .nav-link:hover {
    color: var(--text);
    text-decoration: none;
  }

  .nav-link:hover .nav-arrow {
    opacity: 1;
    transform: translateX(0);
    color: var(--brand);
  }

  .nav-link.active {
    color: var(--text);
  }

  .nav-link.active .nav-arrow {
    opacity: 1;
    transform: translateX(0);
    color: var(--brand);
  }

  .nav-sep {
    display: inline-block;
    width: 1px;
    height: 20px;
    background: var(--line);
    margin: 0 0.4rem;
  }

  .icon-link {
    gap: 0.45rem;
  }

  @media (max-width: 720px) {
    .brand-name {
      display: none;
    }
    .brand-tag {
      display: none;
    }
    .nav-link {
      padding: 0.35rem 0.55rem;
      font-size: 0.82rem;
    }
    .nav-sep {
      display: none;
    }
    .nav-label {
      display: none;
    }
  }
</style>
