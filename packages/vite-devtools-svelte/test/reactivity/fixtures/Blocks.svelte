<script>
  import Child from './Child.svelte'
  import Price from './Price.svelte'
  import { writable } from 'svelte/store'
  import { setContext } from 'svelte'
  let k = $state(0)
  let which = $state(true)
  let promise = $state(Promise.resolve(1))
  let tag = $state('div')
  const store = writable(1)
  const ctx = $state({ n: 1 })
  setContext('ctx', ctx)
  const Comp = $derived(which ? Child : Price)
  export const api = {
    rekey: () => k++,
    swap: () => (which = !which),
    reload: () => (promise = Promise.resolve(2)),
    retag: () => (tag = tag === 'div' ? 'section' : 'div'),
    store: () => store.update(v => v + 1),
  }
</script>

{#snippet row(label)}<Child {label} />{/snippet}
{#key k}<Child label={'key' + k} />{/key}
<Comp label="dyn" amount={k} />
{#await promise then v}<Child label={'await' + v} />{/await}
<svelte:element this={tag}>{@render row('el' + $store)}</svelte:element>
