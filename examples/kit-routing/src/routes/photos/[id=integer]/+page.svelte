<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h2>{data.photo.title}</h2>
<div class="swatch" style:background={data.photo.color}></div>

<style>
  .swatch {
    width: 12rem;
    height: 8rem;
  }
</style>
