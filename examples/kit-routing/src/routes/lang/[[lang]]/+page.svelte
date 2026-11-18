<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>{data.greeting}</h1>
<p>lang = <code>{data.lang}</code></p>
<p>
  <a href={resolve('lang')}>/lang</a> · <a href={resolve('lang/ja')}>/lang/ja</a> ·
  <a href={resolve('lang/fr')}>/lang/fr</a>
</p>
