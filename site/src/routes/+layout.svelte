<script lang="ts">
  import '../app.css'
  import Header from '$lib/Header.svelte'
  import Footer from '$lib/Footer.svelte'

  let { children } = $props()
</script>

<Header />
<main>
  {@render children()}
</main>
<Footer />

<style>
  main {
    min-height: calc(100vh - 200px);
  }
</style>
