<script lang="ts">
  let rows = $state([3, 1, 2]);
</script>

<h1>Reports</h1>
<p>Rendered inside the (app) layout, without the admin layout.</p>
<button type="button" onclick={() => (rows = rows.toSorted((a, b) => a - b))}>sort</button>
<ul>
  {#each rows as row (row)}<li>report #{row}</li>{/each}
</ul>
