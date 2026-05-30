<script lang="ts">
  import ProductCard from '$lib/components/ProductCard.svelte'
  import { cart } from '$lib/stores/cart.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  let qty = $state(1)
  const lineTotal = $derived(data.product.price * qty)

  function addToCart() {
    for (let i = 0; i < qty; i++) {
      cart.add({
        id: data.product.id,
        name: data.product.name,
        price: data.product.price,
      })
    }
  }
</script>

<svelte:head>
  <title>{data.product.name} — devtools-shop</title>
  <meta property="og:title" content={data.product.name} />
  <meta property="og:description" content={data.product.description} />
</svelte:head>

<p><a href="/products">← 商品一覧</a></p>

<article class="card detail">
  <h1>{data.product.name}</h1>
  <p class="muted">{data.product.category}</p>
  <p class="price">¥{data.product.price.toLocaleString()}</p>
  <p>{data.product.description}</p>

  <div class="qty">
    <label>
      数量
      <input type="number" min="1" max={data.product.stock} bind:value={qty} />
    </label>
    <p>合計: ¥{lineTotal.toLocaleString()}</p>
    <button onclick={addToCart} disabled={data.product.stock <= 0}>
      カートに追加
    </button>
  </div>
</article>

{#if data.related.length}
  <h2 style="margin-top:24px">関連商品</h2>
  <div class="grid">
    {#each data.related as p (p.id)}
      <ProductCard
        id={p.id}
        name={p.name}
        price={p.price}
        category={p.category}
        stock={p.stock}
      />
    {/each}
  </div>
{/if}

<style>
  .detail .price {
    font-size: 28px;
    font-weight: 700;
  }
  .qty {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-top: 12px;
  }
  .qty label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .qty input {
    width: 80px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }
</style>
