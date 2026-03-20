<script lang="ts">
  import { onDestroy } from 'svelte'

  let elapsed = $state(0)
  let running = $state(false)
  let intervalId: ReturnType<typeof setInterval> | null = null

  let formatted = $derived.by(() => {
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  })

  let status = $derived(running ? 'Running' : elapsed > 0 ? 'Paused' : 'Stopped')

  $effect(() => {
    if (running) {
      intervalId = setInterval(() => { elapsed++ }, 1000)
    } else if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  })

  function toggle() { running = !running }
  function reset() { running = false; elapsed = 0 }

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId)
  })
</script>

<div class="timer">
  <h3>Timer</h3>
  <div class="display">{formatted}</div>
  <div class="status">{status}</div>
  <div class="controls">
    <button onclick={toggle}>{running ? 'Pause' : 'Start'}</button>
    <button class="secondary" onclick={reset}>Reset</button>
  </div>
</div>

<style>
  .timer {
    background: #1e1e3a;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  h3 { color: #ff3e00; margin-bottom: 12px; }
  .display { font-size: 32px; font-weight: bold; font-family: monospace; margin-bottom: 4px; }
  .status { font-size: 12px; color: #888; margin-bottom: 12px; }
  .controls { display: flex; gap: 8px; justify-content: center; }
  button {
    background: #ff3e00; color: white; border: none; border-radius: 4px;
    padding: 8px 16px; cursor: pointer; font-size: 13px;
  }
  button:hover { background: #e03500; }
  .secondary { background: #444; }
  .secondary:hover { background: #555; }
</style>
