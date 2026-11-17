<script lang="ts">
  let { createdAt }: { createdAt: number } = $props();
  let seconds = $state(0);
  $effect(() => {
    const id = setInterval(() => (seconds = Math.round((Date.now() - createdAt) / 1000)), 1000);
    return () => clearInterval(id);
  });
</script>

<div class="floating" data-testid="floating-root">
  Floating root (third mount) — alive {seconds}s
</div>

<style>
  .floating {
    position: fixed;
    left: 1rem;
    bottom: 1rem;
    padding: 0.5rem;
    background: #ffe;
    border: 1px solid #cc9;
  }
</style>
