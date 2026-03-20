<script>
  import Header from '$lib/components/Header.svelte'
  import '../app.css'

  let { children } = $props()
</script>

<Header />
<main>
  {@render children()}
</main>

<style>
  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px;
  }
</style>
