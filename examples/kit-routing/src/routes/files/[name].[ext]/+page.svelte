<script lang="ts">
  import { resolve } from '$app/paths';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>File</h1>
<p>name = <code>{data.name}</code>, ext = <code>{data.ext}</code></p>
<p>
  <a href={resolve('files/photo.jpeg')}>photo.jpeg</a> ·
  <a href={resolve('files/archive.tar')}>archive.tar</a>
</p>
