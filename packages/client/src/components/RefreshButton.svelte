<script lang="ts">
  import type { Resource } from '../lib/resource.svelte.js'
  import Button from './Button.svelte'

  /** Icon button that re-fetches a resource; disabled while a request is in flight. */
  let { res, label }: { res: Pick<Resource<unknown>, 'busy' | 'refresh'>; label: string } = $props()
</script>

<Button icon="refresh" variant="ghost" {label} disabled={res.busy} onclick={() => res.refresh()} />
