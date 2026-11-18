<script lang="ts">
  import { page } from '$app/state';
</script>

<h1>About</h1>
<p>
  Inside the <code>(marketing)</code> group. Reached at <code>{page.url.pathname}</code>
  {#if page.url.pathname !== '/about'}(rerouted by <code>src/hooks.ts</code>){/if}.
</p>
