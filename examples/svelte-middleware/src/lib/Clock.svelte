<script lang="ts">
  // Null on the server and during hydration, so both render the same HTML.
  let now = $state<Date | null>(null);

  $effect(() => {
    now = new Date();
    const timer = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(timer);
  });
</script>

<section>
  <h2>Clock</h2>
  <p>{now ? now.toLocaleTimeString() : '…'}</p>
</section>
