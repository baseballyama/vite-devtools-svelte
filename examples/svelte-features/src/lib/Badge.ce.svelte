<!-- Compiled with customElement: true by vite.config.ts (dynamicCompileOptions); svelte-check
     cannot see that and reports options_missing_custom_element here. -->
<svelte:options customElement="x-badge" />

<script lang="ts">
  let { label = 'badge', tone = 'info' }: { label?: string; tone?: string } = $props();
  let hits = $state(0);
</script>

<button type="button" class={tone} onclick={() => hits++}>{label} · {hits}</button>

<style>
  button {
    border-radius: 999px;
    border: 1px solid currentColor;
    padding: 0 0.6rem;
  }
  .info {
    color: #2563eb;
  }
  .warn {
    color: #b45309;
  }
</style>
