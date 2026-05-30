<script lang="ts">
  import FpsCanvas from '$lib/components/FpsCanvas.svelte'
</script>

<section class="hero">
  <h1>devtools-shop</h1>
  <p class="muted">
    <code>vite-devtools-svelte</code> の機能を実際に触って体感できるサンプル EC
    アプリです。Vite DevTools を開いて各パネルを切り替えてみてください。
  </p>
  <p class="row">
    <a class="cta" href="/products">商品一覧へ →</a>
    <a href="/dashboard">ダッシュボード</a>
  </p>
</section>

<section class="panels">
  <article class="card">
    <h3>🧩 Component Inspector / Render Profiler</h3>
    <p class="muted">
      <code>/products</code> や <code>/dashboard</code>
      で複数コンポーネントが描画されます。
    </p>
  </article>
  <article class="card">
    <h3>🔗 Reactive Graph</h3>
    <p class="muted">
      カート画面の料金内訳が <code>$state → $derived → $effect</code> の連鎖を作ります。
    </p>
  </article>
  <article class="card">
    <h3>🛣 Route Viewer / Load Profiler</h3>
    <p class="muted">
      <code>/products</code> と <code>/products/[id]</code> はサーバー
      <code>load</code> で意図的に遅延を発生させます。
    </p>
  </article>
  <article class="card">
    <h3>🛰 API Playground</h3>
    <p class="muted">
      <code>/api/products</code>, <code>/api/cart</code>, <code>/api/stats</code>
      の 3 エンドポイントを DevTools から叩けます。
    </p>
  </article>
  <article class="card">
    <h3>📈 FPS Monitor</h3>
    <p class="muted">
      下のキャンバスはパーティクル数を上げると FPS が落ちます。
    </p>
  </article>
  <article class="card">
    <h3>🖼 OG Preview / Asset Browser</h3>
    <p class="muted">
      <code>static/og-image.svg</code> と <code>favicon.svg</code> がアセットとして並びます。
    </p>
  </article>
</section>

<section>
  <FpsCanvas />
</section>

<style>
  .hero {
    margin-bottom: 24px;
  }
  .hero h1 {
    font-size: 36px;
  }
  .cta {
    padding: 10px 16px;
    background: var(--accent);
    color: #0f1115;
    border-radius: 8px;
    font-weight: 600;
  }
  .cta:hover {
    text-decoration: none;
    filter: brightness(1.1);
  }
  .panels {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
</style>
