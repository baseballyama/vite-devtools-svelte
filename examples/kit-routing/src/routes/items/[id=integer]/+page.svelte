<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Item {data.item.id}</h1>
<p>{data.item.name} — {data.item.done ? 'done' : 'open'}</p>
<p>
  Matched by <code>src/params/integer.ts</code>.
  <a href={resolve('items/1')}>1</a> · <a href={resolve('items/3')}>3</a> ·
  <a href={resolve('items/99')}>99 (404)</a>
  ·
  <a href={resolve('items/abc')}>abc (no route)</a>
</p>
