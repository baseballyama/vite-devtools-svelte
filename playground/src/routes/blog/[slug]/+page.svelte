<script lang="ts">
  let { data } = $props()
</script>

<svelte:head>
  <title>{data.title} - Blog</title>
</svelte:head>

<article>
  <a href="/blog">&larr; Back to Blog</a>
  <h1>{data.title}</h1>
  <p>{data.content}</p>
</article>

<style>
  article {
    max-width: 600px;
  }

  a {
    display: inline-block;
    margin-bottom: 16px;
    font-size: 14px;
  }

  h1 {
    color: #ff3e00;
    margin-bottom: 12px;
  }
</style>
