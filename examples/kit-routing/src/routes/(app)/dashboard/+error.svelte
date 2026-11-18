<script lang="ts">
  import { page } from '$app/state';
</script>

<section class="nested-error">
  <h2>Dashboard error {page.status}</h2>
  <p>{page.error?.message}</p>
  <p>(nested <code>(app)/dashboard/+error.svelte</code>: the (app) layout stays)</p>
</section>
