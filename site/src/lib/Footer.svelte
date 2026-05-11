<script lang="ts">
  import { base } from '$app/paths'
</script>

<footer>
  <div class="container row">
    <div>
      <strong>vite-devtools-svelte</strong>
      <p class="muted">
        Svelte DevTools plugin for Vite DevTools. MIT licensed.
      </p>
    </div>
    <div class="links">
      <a href="{base}/getting-started">Getting Started</a>
      <a href="{base}/try">Try Live</a>
      <a
        href="https://github.com/baseballyama/vite-devtools-svelte"
        target="_blank"
        rel="noreferrer noopener">GitHub</a
      >
    </div>
  </div>
</footer>

<style>
  footer {
    border-top: 1px solid var(--border);
    margin-top: 4rem;
    padding: 2.5rem 0;
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2rem;
    flex-wrap: wrap;
  }

  .links {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .links a {
    color: var(--text-dim);
  }

  .links a:hover {
    color: var(--text);
  }
</style>
