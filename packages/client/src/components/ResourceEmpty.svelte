<script lang="ts">
  import type { Snippet } from 'svelte'

  import type { IconName } from '../lib/icons.js'
  import type { Resource } from '../lib/resource.svelte.js'
  import EmptyState from './EmptyState.svelte'

  /**
   * The empty state of a view fed by a resource: still loading, a failed
   * load, nothing there yet (`icon`, `title`, `children`), or — when the
   * unfiltered `total` is not 0 — a filter that matches nothing.
   */
  let {
    res,
    total,
    loading,
    failed,
    icon,
    title,
    noMatch = 'Nothing matches',
    children,
  }: {
    res: Pick<Resource<unknown>, 'loading' | 'error'>
    total: number
    loading: string
    failed: string
    icon: IconName
    title: string
    noMatch?: string
    children?: Snippet
  } = $props()
</script>

{#if total > 0}
  <EmptyState icon="search" title={noMatch} />
{:else if res.loading}
  <EmptyState title={loading} />
{:else if res.error}
  <EmptyState title={failed} error={res.error} />
{:else}
  <EmptyState {icon} {title} {children} />
{/if}
