<script lang="ts">
  import type { Resource } from '../lib/resource.svelte.js';
  import Button from './Button.svelte';

  let { res, label }: { res: Pick<Resource<unknown>, 'busy' | 'refresh'>; label: string } =
    $props();
</script>

<Button icon="refresh" variant="ghost" {label} disabled={res.busy} onclick={() => res.refresh()} />
