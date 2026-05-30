<script lang="ts">
  import { browser, dev } from '$app/environment'

  if (dev && browser) {
    // Issue #51 で報告者が必要と書いていたワークアラウンド。
    //
    // 経緯:
    //   1. `@vitejs/devtools` の `DevTools()` プラグインは
    //      `transformIndexHtml` で inject script を <body> に挿入する。
    //   2. しかし SvelteKit dev は app.html を独自の SSR パイプラインで処理し、
    //      Vite の transformIndexHtml フックを通さない → SvelteKit のページには
    //      ドロワーが一切現れない。
    //   3. ワークアラウンドとして手動 import すると Vite のモジュールパイプラインに
    //      乗るため SvelteKit の nonce 付き script で配信され、CSP も通る。
    //
    // さらに罠: `client/inject.js` は top-level で `window` を触るため、
    // browser ガード無しだと SSR 中に `ReferenceError: window is not defined`
    // で dev サーバーが落ちる。
    import('@vitejs/devtools/client/inject')
  }

  let { children } = $props()
</script>

{@render children()}
