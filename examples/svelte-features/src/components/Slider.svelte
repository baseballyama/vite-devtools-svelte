<script lang="ts">
  let { value = $bindable(50), onchange }: { value?: number; onchange?: (value: number) => void } =
    $props();

  export function reset(): void {
    value = 50;
    onchange?.(value);
  }
</script>

<input
  data-testid="slider"
  type="range"
  min="0"
  max="100"
  bind:value
  onchange={() => onchange?.(value)}
/>
<output>{value}</output>
