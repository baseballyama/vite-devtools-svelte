<script lang="ts">
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import ProductCard from '$lib/components/ProductCard.svelte'

  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  function changeCategory(e: Event) {
    const target = e.target as HTMLSelectElement
    const href =
      target.value === 'all'
        ? resolve('/products')
        : resolve(`/products?${new URLSearchParams({ category: target.value })}`)
    void goto(href, { keepFocus: true })
  }
</script>

<h1>商品一覧</h1>
<p class="muted">
  カテゴリ:
  <select value={data.category} onchange={changeCategory}>
    {#each data.categories as cat (cat)}
      <option value={cat}>{cat}</option>
    {/each}
  </select>
</p>

<div class="grid">
  {#each data.items as p (p.id)}
    <ProductCard id={p.id} name={p.name} price={p.price} category={p.category} stock={p.stock} />
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
    margin-top: 16px;
  }
</style>
