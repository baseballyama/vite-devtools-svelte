<script lang="ts">
  let { index, tick }: { index: number; tick: number } = $props();
  const hue = $derived((index * 7 + tick * 13) % 360);
</script>

<span style:color="hsl({hue} 70% 40%)">#{index}·{tick}</span>
