<script lang="ts">
  import { cart } from '$lib/stores/cart.svelte'
  import ReactivePriceChart from '$lib/components/ReactivePriceChart.svelte'
</script>

<h1>カート</h1>

{#if cart.lines.length === 0}
  <p class="muted">カートは空です。<a href="/products">商品を見る</a></p>
{:else}
  <div class="layout">
    <div class="lines card">
      <table>
        <thead>
          <tr>
            <th>商品</th>
            <th>単価</th>
            <th>数量</th>
            <th>小計</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each cart.lines as line (line.id)}
            <tr>
              <td>{line.name}</td>
              <td>¥{line.price.toLocaleString()}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={line.qty}
                  oninput={(e) =>
                    cart.setQty(line.id, +(e.target as HTMLInputElement).value)}
                />
              </td>
              <td>¥{(line.price * line.qty).toLocaleString()}</td>
              <td>
                <button onclick={() => cart.remove(line.id)}>削除</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="actions">
        <button onclick={() => cart.clear()}>カートを空にする</button>
      </p>
    </div>

    <aside>
      <ReactivePriceChart />
    </aside>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 16px;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 8px 6px;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--muted);
    font-weight: 500;
    font-size: 13px;
  }
  input[type='number'] {
    width: 64px;
  }
  .actions {
    text-align: right;
    margin-top: 8px;
  }
</style>
