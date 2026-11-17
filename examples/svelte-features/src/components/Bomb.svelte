<script lang="ts">
  let { armed = $bindable(false) }: { armed?: boolean } = $props();
  let ticks = $state(0);

  // Throws while rendering once armed: caught by the nearest <svelte:boundary>.
  const value = $derived.by(() => {
    if (armed) throw new Error(`Bomb exploded after ${ticks} ticks`);
    return ticks;
  });
</script>

<p>
  Bomb value: {value}
  <button type="button" data-testid="bomb-tick" onclick={() => ticks++}>tick</button>
  <button type="button" data-testid="bomb-arm" onclick={() => (armed = true)}>throw</button>
</p>
