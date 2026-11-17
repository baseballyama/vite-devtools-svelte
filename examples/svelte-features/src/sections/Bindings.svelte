<script lang="ts">
  import { setContext } from 'svelte';

  import Consumer from '../components/Consumer.svelte';
  import Slider from '../components/Slider.svelte';
  import { THEME, type Theme } from '../lib/context';

  const theme: Theme = $state({ color: '#ff3e00' });
  setContext(THEME, theme);

  let volume = $state(30);
  let input = $state<HTMLInputElement>();
  let slider = $state<{ reset: () => void }>();
  let events = $state<string[]>([]);
</script>

<h2>Context, $bindable, bind:this, callback props</h2>

<label>theme color (context) <input type="color" bind:value={theme.color} /></label>
<Consumer />
<Consumer nested />

<h3>$bindable</h3>
<Slider
  bind:value={volume}
  bind:this={slider}
  onchange={v => (events = [...events.slice(-4), `change → ${v}`])}
/>
<p>parent sees volume = {volume}</p>
<button type="button" data-testid="slider-reset" onclick={() => slider?.reset()}
  >reset via bind:this export</button
>

<h3>bind:this on an element</h3>
<input bind:this={input} placeholder="focus me" />
<button type="button" data-testid="focus-input" onclick={() => input?.focus()}>focus</button>

<h3>callback events</h3>
<ul>
  {#each events as e, i (i)}<li>{e}</li>{/each}
</ul>
