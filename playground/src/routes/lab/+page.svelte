<!--
  Reactivity lab: one page with the patterns the devtools runtime has to
  follow (scripts/reactivity-e2e.mjs checks it through MCP).
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { page } from '$app/state'
  import { inventory, prefs } from '#lib/lab/store.svelte.js'
  import Row from '#lib/lab/Row.svelte'
  import Panel from '#lib/lab/Panel.svelte'
  import Broken from '#lib/lab/Broken.svelte'

  let { data } = $props()

  // seeded once from the load data (later navigations keep the items)
  const seed = untrack(() => data.seed)
  if (inventory.items.length === 0) for (const name of seed) inventory.add(name)

  let query = $state('')
  let showPanel = $state(true)
  let fail = $state(false)
  let tab = $state<'a' | 'b'>('a')
  const tags = new SvelteMap<string, number>()

  const visible = $derived(inventory.items.filter(item => item.name.includes(query)))
  const { count, pieces } = $derived({
    count: visible.length,
    pieces: visible.reduce((sum, item) => sum + item.qty, 0),
  })
  const summary = $derived.by(() => `${count} items / ${pieces} pcs`)
  const path = $derived(page.url.pathname)
  // read by nothing on purpose: reported as an orphan derived
  const unusedOnPurpose = $derived(query.length * 2)
  let promise = $state(Promise.resolve(seed.length))
  let renders = 0

  $effect(() => {
    renders += pieces
  })
  $effect.pre(() => {
    document.title = summary
  })
</script>

<h1>{summary}</h1>
<p>{path} · {prefs.compact ? 'compact' : 'full'} · {tags.size} tags · {inventory.total} total</p>

<input data-testid="query" bind:value={query} placeholder="filter" />
<button data-testid="add" onclick={() => inventory.add(`item ${inventory.items.length + 1}`)}>add</button>
<button data-testid="compact" onclick={() => (prefs.compact = !prefs.compact)}>compact</button>
<button data-testid="tag" onclick={() => tags.set(`t${tags.size}`, 1)}>tag</button>
<button data-testid="panel" onclick={() => (showPanel = !showPanel)}>panel</button>
<button data-testid="fail" onclick={() => (fail = true)}>fail</button>
<button data-testid="tab" onclick={() => (tab = tab === 'a' ? 'b' : 'a')}>tab</button>
<button data-testid="reload" onclick={() => (promise = Promise.resolve(inventory.items.length))}>
  reload
</button>

{#snippet badge(text: string)}<em>{text}</em>{/snippet}

<ul>
  {#each visible as item (item.id)}
    <Row {item} bind:qty={item.qty} {badge} />
  {/each}
</ul>

{#if showPanel}
  <Panel><span>{count} visible</span></Panel>
{/if}

{#key tab}
  <Panel>tab {tab}</Panel>
{/key}

{#await promise then n}
  <span data-testid="awaited">{n}</span>
{/await}

<svelte:boundary>
  {#if fail}<Broken />{/if}
  {#snippet failed()}<p data-testid="failed">failed</p>{/snippet}
</svelte:boundary>
