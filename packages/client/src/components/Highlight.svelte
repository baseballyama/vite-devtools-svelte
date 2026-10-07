<script lang="ts">
  import { highlightParts } from '../lib/match.js'

  let { text, query = '' }: { text: string; query?: string } = $props()
  const parts = $derived(query ? highlightParts(text, query) : null)
</script>

{#if parts}{#each parts as p, i (i)}{#if p.m}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}{:else}{text}{/if}
