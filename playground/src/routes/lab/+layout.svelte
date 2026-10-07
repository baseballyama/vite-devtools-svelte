<script lang="ts">
  import { setContext } from 'svelte'

  let { children } = $props()
  const lab = $state({ user: 'ada' })
  setContext('lab', lab)
</script>

<button data-testid="user" onclick={() => (lab.user = lab.user === 'ada' ? 'grace' : 'ada')}>
  switch user
</button>
{@render children()}
