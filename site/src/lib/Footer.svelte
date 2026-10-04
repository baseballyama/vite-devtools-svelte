<script lang="ts">
  import { base } from '$app/paths'
  import SvelteMark from './SvelteMark.svelte'
  import { pkgVersion } from './version'

  const repo = 'https://github.com/baseballyama/vite-devtools-svelte'
</script>

<footer class="band">
  <div class="top">
    <div class="about">
      <a class="brand" href="{base}/" aria-label="vite-devtools-svelte home">
        <SvelteMark size={28} />
        <span>vite-devtools-svelte</span>
      </a>
      <p class="muted">
        DevTools for Svelte and SvelteKit. Open source (MIT); runs only while your Vite dev server
        is running.
      </p>
    </div>

    <nav class="columns" aria-label="Footer">
      <section>
        <h2 class="col-title">Docs</h2>
        <ul>
          <li><a href="{base}/getting-started">Get started</a></li>
          <li><a href="{base}/mcp">MCP for AI agents</a></li>
          <li><a href="{base}/#panels">All panels</a></li>
        </ul>
      </section>
      <section>
        <h2 class="col-title">Project</h2>
        <ul>
          <li><a href={repo} target="_blank" rel="noreferrer noopener">GitHub</a></li>
          <li><a href="{repo}/issues" target="_blank" rel="noreferrer noopener">Issues</a></li>
          <li><a href="{repo}/releases" target="_blank" rel="noreferrer noopener">Releases</a></li>
        </ul>
      </section>
    </nav>
  </div>

  <div class="bottom">
    <p>
      Site for v{pkgVersion}. Not an official Svelte project. The Svelte name and logo belong to the
      Svelte project and are used here only to show what this tool works with.
    </p>
  </div>
</footer>

<style>
  footer {
    padding-bottom: 2rem;
  }

  .top {
    display: flex;
    justify-content: space-between;
    gap: 3rem;
    flex-wrap: wrap;
  }

  .about {
    max-width: 26rem;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    color: var(--text);
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .columns {
    display: flex;
    gap: 4rem;
    flex-wrap: wrap;
  }

  .col-title {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-3);
    margin: 0 0 0.85rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li + li {
    margin-top: 0.5rem;
  }

  .columns a {
    color: var(--text-2);
  }

  .columns a:hover {
    color: var(--text);
  }

  .bottom {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--line);
    font-size: 0.85rem;
    color: var(--text-3);
  }

  .bottom p {
    margin: 0;
    max-width: 52rem;
  }
</style>
