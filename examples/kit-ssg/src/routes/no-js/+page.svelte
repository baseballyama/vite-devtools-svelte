<script lang="ts">
  const items = ['no hydration', 'no client router', 'no devtools runtime'];
</script>

<h1>csr = false</h1>
<ul>
  {#each items as item (item)}<li>{item}</li>{/each}
</ul>
<p>Links from this page are full page loads.</p>
