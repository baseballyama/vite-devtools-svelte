<script lang="ts">
  import HeavyList from '$lib/components/HeavyList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<h1>ダッシュボード</h1>

<section class="stats">
  <div class="card">
    <div class="muted">SKU 数</div>
    <div class="big">{data.stats.totalSku}</div>
  </div>
  <div class="card">
    <div class="muted">総在庫数</div>
    <div class="big">{data.stats.totalStock}</div>
  </div>
  <div class="card">
    <div class="muted">平均価格</div>
    <div class="big">¥{data.stats.avgPrice.toLocaleString()}</div>
  </div>
</section>

<section class="grid2">
  <div class="card">
    <h3>カテゴリ別 SKU</h3>
    <ul>
      {#each data.byCategory as c (c.category)}
        <li><span>{c.category}</span><strong>{c.count}</strong></li>
      {/each}
    </ul>
  </div>

  <div class="card">
    <h3>在庫薄</h3>
    {#if data.lowStock.length === 0}
      <p class="muted">該当なし</p>
    {:else}
      <ul>
        {#each data.lowStock as p (p.id)}
          <li>
            <a href="/products/{p.id}">{p.name}</a>
            <strong>残 {p.stock}</strong>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<section style="margin-top:16px">
  <HeavyList />
</section>

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }
  .big {
    font-size: 28px;
    font-weight: 700;
    margin-top: 4px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 720px) {
    .stats,
    .grid2 {
      grid-template-columns: 1fr;
    }
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: none;
  }
</style>
