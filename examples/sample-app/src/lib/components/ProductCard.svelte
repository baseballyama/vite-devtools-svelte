<script lang="ts">
  import { cart } from '$lib/stores/cart.svelte'

  interface Props {
    id: string
    name: string
    price: number
    category: string
    stock: number
  }

  let { id, name, price, category, stock }: Props = $props()

  const isLow = $derived(stock > 0 && stock <= 8)
  const isOut = $derived(stock <= 0)

  function add() {
    cart.add({ id, name, price })
  }
</script>

<article class="card">
  <header>
    <a href="/products/{id}">{name}</a>
    <span class="cat">{category}</span>
  </header>
  <div class="price">¥{price.toLocaleString()}</div>
  <div class="stock" class:low={isLow} class:out={isOut}>
    {#if isOut}在庫切れ{:else if isLow}残り {stock}{:else}在庫 {stock}{/if}
  </div>
  <button onclick={add} disabled={isOut}>カートに追加</button>
</article>

<style>
  article {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  header a {
    font-weight: 600;
    color: var(--text);
  }
  .cat {
    font-size: 12px;
    color: var(--muted);
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .price {
    font-size: 20px;
    font-weight: 700;
  }
  .stock {
    font-size: 13px;
    color: var(--muted);
  }
  .stock.low {
    color: #f6c177;
  }
  .stock.out {
    color: var(--danger);
  }
</style>
