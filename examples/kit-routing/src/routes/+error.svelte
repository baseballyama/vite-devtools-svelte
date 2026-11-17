<script lang="ts">
  import { page } from '$app/state';
</script>

<section class="error">
  <h1>{page.status}</h1>
  <p>{page.error?.message}</p>
  {#if page.error?.errorId}<p><small>error id: {page.error.errorId}</small></p>{/if}
  <p>(root <code>+error.svelte</code>)</p>
</section>

<style>
  .error {
    border-left: 4px solid #c0392b;
    padding-left: 1rem;
  }
</style>
