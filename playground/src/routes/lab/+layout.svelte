<script lang="ts">
  import { setContext } from 'svelte'

  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
  const lab = $state({ user: 'ada' })
  setContext('lab', lab)
</script>

<button
  type="button"
  data-testid="user"
  onclick={() => (lab.user = lab.user === 'ada' ? 'grace' : 'ada')}
>
  switch user
</button>
{@render children()}
