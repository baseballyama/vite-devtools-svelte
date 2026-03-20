<script lang="ts">
  let celsius = $state(0)
  let fahrenheit = $derived(celsius * 9 / 5 + 32)
  let kelvin = $derived(celsius + 273.15)

  let description = $derived.by(() => {
    if (celsius <= -40) return 'Extremely cold'
    if (celsius <= 0) return 'Freezing'
    if (celsius <= 15) return 'Cold'
    if (celsius <= 25) return 'Comfortable'
    if (celsius <= 35) return 'Warm'
    return 'Hot'
  })

  let history = $state<number[]>([])

  $effect(() => {
    // Track every celsius change (but skip the initial 0)
    if (celsius !== 0 || history.length > 0) {
      history = [...history.slice(-9), celsius]
    }
  })
</script>

<div class="converter">
  <h3>Temperature Converter</h3>
  <div class="input-row">
    <label>
      Celsius
      <input type="range" min="-50" max="50" bind:value={celsius} />
      <span class="val">{celsius}°C</span>
    </label>
  </div>
  <div class="results">
    <div class="result"><span class="label">Fahrenheit</span><span class="num">{fahrenheit.toFixed(1)}°F</span></div>
    <div class="result"><span class="label">Kelvin</span><span class="num">{kelvin.toFixed(1)}K</span></div>
    <div class="result"><span class="label">Feeling</span><span class="num">{description}</span></div>
  </div>
  {#if history.length > 0}
    <div class="history">
      <span class="label">History:</span>
      {#each history as h}
        <span class="chip">{h}°</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .converter {
    background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px; padding: 16px;
  }
  h3 { color: #ff3e00; margin-bottom: 12px; }
  .input-row { margin-bottom: 12px; }
  label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ccc; }
  input[type='range'] { flex: 1; accent-color: #ff3e00; }
  .val { font-family: monospace; min-width: 50px; text-align: right; color: #fff; }
  .results { display: flex; flex-direction: column; gap: 6px; }
  .result { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px solid #2a2a4a; }
  .result .label { color: #888; }
  .result .num { color: #4fc08d; font-family: monospace; }
  .history { margin-top: 10px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .history .label { font-size: 11px; color: #666; margin-right: 4px; }
  .chip { font-size: 10px; background: #2a2a4a; color: #aaa; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
</style>
