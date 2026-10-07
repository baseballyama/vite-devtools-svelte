<script lang="ts">
  import ProductList from '#lib/ProductList.svelte'

  import type { PageProps } from './$types'

  // Compat scenario (SvelteKit 3): server data from +page.server.ts, a few
  // signals of each kind, and a bounded, deterministic ticker so the DevTools
  // overview has activity without user input. No $app/* imports.
  const TICK_MS = 1000
  const MAX_TICKS = 120

  let { data }: PageProps = $props()

  let ticks = $state(0)
  let query = $state('')
  // stateChange scenario: one click changes `clicks` from 0 to 1.
  let clicks = $state(0)
  const shown = $derived(
    data.products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())),
  )
  const total = $derived(shown.reduce((sum, p) => sum + p.price, 0))

  $effect(() => {
    const id = setInterval(() => {
      if (ticks >= MAX_TICKS) clearInterval(id)
      else ticks++
    }, TICK_MS)
    return () => clearInterval(id)
  })
</script>

<svelte:head>
  <title>kit3 compat · {shown.length} products</title>
</svelte:head>

<main>
  <h1>kit3 compat</h1>
  <p data-testid="ticks">ticks: {ticks}</p>
  <button data-testid="count-button" onclick={() => clicks++}>clicks: {clicks}</button>
  <input
    data-testid="query"
    bind:value={query}
    placeholder="Filter products"
    aria-label="Filter products"
  />
  <ProductList products={shown} />
  <p data-testid="total">total: {total}</p>
</main>
