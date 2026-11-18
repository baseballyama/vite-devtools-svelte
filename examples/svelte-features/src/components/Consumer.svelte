<script lang="ts">
  import { getContext } from 'svelte';

  import { THEME, type Theme } from '../lib/context';
  import Consumer from './Consumer.svelte';

  let { nested = false }: { nested?: boolean } = $props();
  const theme = getContext<Theme>(THEME);
</script>

<p style:color={theme.color}>
  context consumer{nested ? ' (outer)' : ''}: {theme.color}
</p>
{#if nested}
  <Consumer />
{/if}
