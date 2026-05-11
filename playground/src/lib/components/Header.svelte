<script lang="ts">
  import { page } from '$app/state'

  const isDev = import.meta.env.DEV
</script>

<header>
  <nav>
    <div class="links">
      <a href="/" class:active={page.url.pathname === '/'}>Home</a>
      <a href="/about" class:active={page.url.pathname === '/about'}>About</a>
      <a href="/blog" class:active={page.url.pathname.startsWith('/blog')}>Blog</a>
    </div>
    {#if isDev}
      <a class="devtools-link" href="/__devtools/" target="_blank" rel="noreferrer">
        Open DevTools ↗
      </a>
    {/if}
  </nav>
</header>

<style>
  header {
    background: #16162a;
    border-bottom: 1px solid #2a2a4a;
    padding: 12px 24px;
  }

  nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    max-width: 800px;
    margin: 0 auto;
  }

  .links {
    display: flex;
    gap: 24px;
  }

  a {
    color: #888;
    font-size: 14px;
    transition: color 0.15s;
  }

  a:hover, a.active {
    color: #ff3e00;
    text-decoration: none;
  }

  .devtools-link {
    color: #fff;
    background: #ff3e00;
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 600;
  }

  .devtools-link:hover {
    background: #e63600;
    color: #fff;
  }
</style>
