<script lang="ts">
  import { page } from '$app/state'
</script>

<header>
  <nav>
    <a href="/" class:active={page.url.pathname === '/'}>Home</a>
    <a href="/about" class:active={page.url.pathname === '/about'}>About</a>
    <a href="/blog" class:active={page.url.pathname.startsWith('/blog')}>Blog</a>
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
    gap: 24px;
    max-width: 800px;
    margin: 0 auto;
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
</style>
