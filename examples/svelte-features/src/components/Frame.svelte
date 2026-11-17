<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    badge,
    children,
    footer,
  }: {
    title: string;
    badge?: Snippet<[string]>;
    children: Snippet;
    footer?: Snippet<[number]>;
  } = $props();
  let clicks = $state(0);
</script>

<fieldset>
  <legend>
    {title}
    {#if badge}{@render badge('badge')}{/if}
    <button type="button" onclick={() => clicks++}>click ({clicks})</button>
  </legend>
  {@render children()}
  {#if footer}<small>{@render footer(clicks)}</small>{/if}
</fieldset>
