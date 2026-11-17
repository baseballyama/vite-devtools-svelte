<script>
  /** @type {{ onclick?: () => void, children?: import('svelte').Snippet }} */
  let { onclick, children } = $props();
  let presses = $state(0);
</script>

<button
  type="button"
  class="lib-button"
  onclick={() => {
    presses++;
    onclick?.();
  }}>{@render children?.()} <small>({presses})</small></button
>
