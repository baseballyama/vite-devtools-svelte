<svelte:head>
  <title>Blog - Svelte DevTools Playground</title>
</svelte:head>

<h1>Blog</h1>
<ul class="posts">
  <li><a href="/blog/hello-world">Hello World</a></li>
  <li><a href="/blog/getting-started">Getting Started with Svelte DevTools</a></li>
  <li><a href="/blog/advanced-features">Advanced Features</a></li>
</ul>

<style>
  .posts {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
  }

  .posts a {
    display: block;
    padding: 12px;
    background: #1e1e3a;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    color: #e0e0e0;
  }

  .posts a:hover {
    border-color: #ff3e00;
    text-decoration: none;
  }
</style>
