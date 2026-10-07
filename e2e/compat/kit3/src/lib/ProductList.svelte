<script lang="ts">
  interface Product {
    id: number
    name: string
    price: number
  }

  let { products }: { products: Product[] } = $props()

  let selected = $state<number | null>(null)
  const current = $derived(products.find(p => p.id === selected) ?? null)
</script>

<ul data-testid="products">
  {#each products as p (p.id)}
    <li>
      <button
        aria-pressed={selected === p.id}
        onclick={() => (selected = selected === p.id ? null : p.id)}
      >
        {p.name} — {p.price}
      </button>
    </li>
  {/each}
</ul>
<p data-testid="selected">{current ? `selected: ${current.name}` : 'nothing selected'}</p>
