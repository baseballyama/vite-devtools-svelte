<script lang="ts">
  let count = $state(0)
  let step = $state(1)

  let doubled = $derived(count * 2)
  let isEven = $derived(count % 2 === 0)
  let squared = $derived(count * count)

  let label = $derived.by(() => {
    if (count === 0) return 'Zero'
    if (count > 0) return `Positive (${count})`
    return `Negative (${count})`
  })

  let history = $state<number[]>([0])

  $effect(() => {
    // Record count changes to history
    if (history[history.length - 1] !== count) {
      history = [...history.slice(-19), count]
    }
  })

  function increment() { count += step }
  function decrement() { count -= step }
  function reset() { count = 0; history = [0] }
</script>

<div class="counter">
  <h3>Counter</h3>
  <div class="controls">
    <button onclick={decrement}>-{step}</button>
    <span class="value">{count}</span>
    <button onclick={increment}>+{step}</button>
  </div>
  <div class="step-control">
    <span class="label">Step:</span>
    <input type="range" min="1" max="10" bind:value={step} />
    <span class="step-val">{step}</span>
  </div>
  <div class="derived-values">
    <span>Doubled: <strong>{doubled}</strong></span>
    <span>Squared: <strong>{squared}</strong></span>
    <span>Even: <strong>{isEven ? 'Yes' : 'No'}</strong></span>
  </div>
  <p class="label-display">{label}</p>
  <button class="reset" onclick={reset}>Reset</button>
</div>

<style>
  .counter {
    background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px;
    padding: 16px; text-align: center;
  }
  h3 { color: #ff3e00; margin-bottom: 12px; }
  .controls { display: flex; align-items: center; justify-content: center; gap: 16px; }
  button {
    background: #ff3e00; color: white; border: none; border-radius: 4px;
    min-width: 36px; height: 36px; font-size: 14px; cursor: pointer; padding: 0 8px;
  }
  button:hover { background: #e03500; }
  .value { font-size: 24px; font-weight: bold; min-width: 40px; }
  .step-control {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-top: 10px; font-size: 12px; color: #888;
  }
  .step-control input { accent-color: #ff3e00; width: 80px; }
  .step-val { font-family: monospace; min-width: 16px; }
  .derived-values {
    margin-top: 10px; display: flex; gap: 12px; justify-content: center;
    font-size: 12px; color: #4fc08d;
  }
  .label-display { margin-top: 6px; color: #888; font-size: 12px; }
  .reset {
    margin-top: 8px; background: #444; font-size: 11px; padding: 4px 12px;
    height: auto; min-width: auto;
  }
  .reset:hover { background: #555; }
</style>
