<script lang="ts">
  let { label = 'Ticker' }: { label?: string } = $props();
  let n = $state(0);
  $effect(() => {
    const id = setInterval(() => n++, 1000);
    return () => clearInterval(id);
  });
</script>

<span class="ticker">{label}: {n}</span>
