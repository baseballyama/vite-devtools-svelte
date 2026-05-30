<script lang="ts">
  let count = $state(0)
</script>

<main>
  <h1>strict-csp-app</h1>
  <p>
    SvelteKit + <code>vite-devtools-svelte</code> + <code>@vitejs/devtools</code>
    を、厳格な CSP（nonce ベース）下で動かす最小再現アプリ。
  </p>

  <p>
    DevTools UI が起動できるか、また起動した場合に何が CSP に弾かれるかを
    DevTools の Console / Network タブで確認する用途。
  </p>

  <button onclick={() => count++}>クリック数: {count}</button>

  <h2>確認手順</h2>
  <ol>
    <li>Chromium 系で <code>http://localhost:5173/</code> を開く</li>
    <li>DevTools (Cmd+Opt+I) → Console タブ</li>
    <li>"violates the following Content Security Policy directive" を含む行を確認</li>
    <li>Network タブで <code>(failed) net::ERR_BLOCKED_BY_CSP</code> のリクエストを確認</li>
  </ol>

  <h2>適用されている CSP</h2>
  <p>
    詳しくは <code>svelte.config.js</code> を参照。<code>script-src 'self'</code>{' '}
    で nonce のない外部 script は全て弾かれ、<code>img-src 'self' data:</code>{' '}
    で外部画像取得もブロックされる。
  </p>
</main>

<style>
  main {
    max-width: 720px;
    margin: 40px auto;
    padding: 0 20px;
    font-family: system-ui, sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
  }
  h1 {
    margin-bottom: 8px;
  }
  code {
    background: #f1f3f5;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.92em;
  }
  button {
    font: inherit;
    padding: 8px 16px;
    border: 1px solid #ced4da;
    border-radius: 6px;
    background: #f8f9fa;
    cursor: pointer;
  }
</style>
