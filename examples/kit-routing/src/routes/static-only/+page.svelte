<script lang="ts">
  let clicks = $state(0);
</script>

<h1>csr = false</h1>
<p>Server-rendered only. The button below does nothing: no JS runs on this page.</p>
<button type="button" onclick={() => clicks++}>clicks: {clicks}</button>
