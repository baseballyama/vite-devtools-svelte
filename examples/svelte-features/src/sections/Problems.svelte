<script lang="ts">
  let clicks = $state(0);

  function explode(): never {
    throw new Error('Deliberate runtime error outside any boundary (svelte-features)');
  }
</script>

<h2>Problems</h2>

<!-- Deliberate compiler (a11y) warnings for the Problems panel: a click handler on a
     non-interactive element without a key handler, and an image without alt. -->
<!-- eslint-disable-next-line svelte/valid-compile -->
<div class="clickable" onclick={() => clicks++}>clickable div ({clicks})</div>
<!-- eslint-disable-next-line svelte/valid-compile -->
<img src="/vite.svg" width="24" height="24" />

<p>
  <button type="button" data-testid="throw-runtime" onclick={explode}>throw a runtime error</button>
  (in an event handler, not caught by a boundary)
</p>

<style>
  .clickable {
    cursor: pointer;
    text-decoration: underline;
  }
</style>
