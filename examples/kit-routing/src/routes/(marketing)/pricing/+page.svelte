<script lang="ts">
  let yearly = $state(false);
  const monthly = [0, 12, 49];
  let prices = $derived(monthly.map(p => (yearly ? p * 10 : p)));
</script>

<h1>Pricing</h1>
<label><input type="checkbox" bind:checked={yearly} /> yearly</label>
<ul>
  {#each ['Free', 'Pro', 'Team'] as plan, i (plan)}
    <li>{plan}: {prices[i]} € / {yearly ? 'year' : 'month'}</li>
  {/each}
</ul>
