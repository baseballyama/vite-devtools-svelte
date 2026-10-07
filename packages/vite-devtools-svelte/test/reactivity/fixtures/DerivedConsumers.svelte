<script>
  let count = $state(1)
  const inIf = $derived(count > 0)
  const inHead = $derived(`Count ${count}`)
  const inText = $derived(count * 2)
  const inEach = $derived([count, count + 1])
  const inAttr = $derived(count % 2 === 0 ? 'even' : 'odd')
  const inHandler = $derived(count * 10)
  const inEffect = $derived(count * 3)
  const neverRead = $derived(count * 4)
  let seen = 0
  $effect(() => {
    seen = inEffect
  })
  export function bump() {
    count++
  }
</script>

<svelte:head><title>{inHead}</title></svelte:head>

{#if inIf}<p>yes</p>{/if}
<span class={inAttr}>{inText}</span>
{#each inEach as item (item)}<i>{item}</i>{/each}
<button onclick={() => console.log(inHandler)}>log</button>
