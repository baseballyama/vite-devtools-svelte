<script lang="ts">
  import Header from '#lib/components/Header.svelte'

  import '../app.css'

  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
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
