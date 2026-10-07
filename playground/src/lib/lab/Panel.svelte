<script lang="ts">
  import { getContext, type Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
  const lab = getContext<{ user: string }>('lab')
  const greeting = $derived(`hello ${lab.user}`)
</script>

<section>
  <h2>{greeting}</h2>
  {@render children()}
</section>
