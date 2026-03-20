<script>
  import Counter from '$lib/components/Counter.svelte'
  import TodoList from '$lib/components/TodoList.svelte'
  import Timer from '$lib/components/Timer.svelte'
  import TemperatureConverter from '$lib/components/TemperatureConverter.svelte'
  import UserSearch from '$lib/components/UserSearch.svelte'
  import DynamicList from '$lib/components/DynamicList.svelte'
  import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte'

  let showTimer = $state(true)
  let showDynamic = $state(true)
</script>

<svelte:head>
  <title>Svelte DevTools Playground</title>
</svelte:head>

<h1>Svelte DevTools Playground</h1>
<p class="subtitle">A demo app for testing the Svelte DevTools plugin</p>

<div class="toggles">
  <label><input type="checkbox" bind:checked={showTimer} /> Timer</label>
  <label><input type="checkbox" bind:checked={showDynamic} /> Dynamic List</label>
</div>

<div class="grid">
  <Counter />
  <TodoList />
  {#if showTimer}
    <Timer />
  {/if}
  <TemperatureConverter />
  <UserSearch />
  {#if showDynamic}
    <DynamicList />
  {/if}
  <ThemeSwitcher />
</div>

<style>
  h1 { color: #ff3e00; margin-bottom: 4px; }
  .subtitle { color: #888; margin-bottom: 16px; }
  .toggles {
    display: flex; gap: 16px; margin-bottom: 16px; padding: 8px 12px;
    background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 6px;
    font-size: 13px; color: #ccc;
  }
  .toggles label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
