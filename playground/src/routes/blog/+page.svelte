<script lang="ts">
  import { resolve } from '$app/paths'

  const posts = [
    { slug: 'hello-world', title: 'Hello World' },
    { slug: 'getting-started', title: 'Getting Started with Svelte DevTools' },
    { slug: 'advanced-features', title: 'Advanced Features' },
  ]
</script>

<svelte:head>
  <title>Blog - Svelte DevTools Playground</title>
</svelte:head>

<h1>Blog</h1>
<ul class="posts">
  {#each posts as post (post.slug)}
    <li><a href={resolve('/blog/[slug]', { slug: post.slug })}>{post.title}</a></li>
  {/each}
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
