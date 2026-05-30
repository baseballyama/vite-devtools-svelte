<script lang="ts">
  import ProductCard from '$lib/components/ProductCard.svelte'
  import { goto } from '$app/navigation'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  function changeCategory(e: Event) {
    const target = e.target as HTMLSelectElement
    const params = new URLSearchParams()
    if (target.value !== 'all') params.set('category', target.value)
    goto(`/products?${params}`, { keepFocus: true })
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
    <ProductCard
      id={p.id}
      name={p.name}
      price={p.price}
      category={p.category}
      stock={p.stock}
    />
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
