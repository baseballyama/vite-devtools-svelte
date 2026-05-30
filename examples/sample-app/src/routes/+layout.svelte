<script lang="ts">
  import '../app.css'
  import Header from '$lib/components/Header.svelte'

  let { children } = $props()
</script>

<svelte:head>
  <title>devtools-shop — vite-devtools-svelte sample</title>
  <meta
    name="description"
    content="vite-devtools-svelte の各パネルを実際に体感するためのサンプル EC アプリ"
  />
  <meta property="og:title" content="devtools-shop" />
  <meta
    property="og:description"
    content="vite-devtools-svelte sample E-commerce app"
  />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="/og-image.svg" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<Header />
<main class="container">
  {@render children()}
</main>
