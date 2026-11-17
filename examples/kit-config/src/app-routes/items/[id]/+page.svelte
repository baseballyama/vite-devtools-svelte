<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let next = $derived(String((Number(data.item.id) % 3) + 1));
</script>

<h1>Item {data.item.id}: {data.item.name}</h1>
<a data-testid="next" href={resolve('/items/[id]', { id: next })}>next → {next}</a>
