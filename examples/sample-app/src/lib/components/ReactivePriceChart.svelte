<script lang="ts">
  import { cart } from '$lib/stores/cart.svelte'

  let taxRate = $state(0.1)
  let shippingFreeThreshold = $state(5000)

  const subtotal = $derived(cart.total)
  const tax = $derived(Math.round(subtotal * taxRate))
  const shipping = $derived(subtotal >= shippingFreeThreshold ? 0 : 500)
  const grandTotal = $derived(subtotal + tax + shipping)
  const remaining = $derived(Math.max(0, shippingFreeThreshold - subtotal))

  $effect(() => {
    console.log('[ReactivePriceChart] grandTotal updated:', grandTotal)
  })
</script>

<div class="card">
  <h3>料金内訳（リアクティブ）</h3>
  <div class="grid">
    <label>
      税率
      <input
        type="number"
        step="0.01"
        min="0"
        max="0.5"
        bind:value={taxRate}
      />
    </label>
    <label>
      送料無料しきい値
      <input type="number" step="100" min="0" bind:value={shippingFreeThreshold} />
    </label>
  </div>

  <dl>
    <div><dt>小計</dt><dd>¥{subtotal.toLocaleString()}</dd></div>
    <div>
      <dt>消費税 ({(taxRate * 100).toFixed(0)}%)</dt>
      <dd>¥{tax.toLocaleString()}</dd>
    </div>
    <div>
      <dt>送料</dt>
      <dd>{shipping === 0 ? '無料' : `¥${shipping.toLocaleString()}`}</dd>
    </div>
    <div class="total">
      <dt>合計</dt>
      <dd>¥{grandTotal.toLocaleString()}</dd>
    </div>
  </dl>

  {#if remaining > 0}
    <p class="muted">あと ¥{remaining.toLocaleString()} で送料無料</p>
  {/if}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  dl > div {
    display: flex;
    justify-content: space-between;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .total {
    border-top: 1px solid var(--border);
    padding-top: 8px;
    font-weight: 700;
    font-size: 18px;
  }
</style>
