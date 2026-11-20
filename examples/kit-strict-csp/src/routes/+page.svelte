<script lang="ts">
  let count = $state(0);
</script>

<main>
  <h1>kit-strict-csp</h1>
  <p>
    A minimal app running SvelteKit + <code>vite-devtools-svelte</code> +
    <code>@vitejs/devtools</code>
    under a strict, nonce-based CSP.
  </p>

  <p>
    Use the browser DevTools Console and Network tabs to check whether the DevTools UI starts, and
    what the CSP blocks if it does.
  </p>

  <button type="button" onclick={() => count++}>Clicks: {count}</button>

  <h2>Steps</h2>
  <ol>
    <li>Open this page in a Chromium-based browser</li>
    <li>Browser DevTools (Cmd+Opt+I) → Console tab</li>
    <li>Look for lines containing "violates the following Content Security Policy directive"</li>
    <li>In the Network tab, look for <code>(failed) net::ERR_BLOCKED_BY_CSP</code> requests</li>
  </ol>

  <h2>The CSP in use</h2>
  <p>
    See the <code>csp</code> option in <code>vite.config.ts</code>. <code>script-src 'self'</code>
    blocks every external script without a nonce, and <code>img-src 'self' data:</code> blocks external
    images.
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
