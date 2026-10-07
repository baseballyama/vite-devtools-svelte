<script lang="ts">
  import type { CaptureInfo } from '../lib/capture.svelte.js'
  import Icon from './Icon.svelte'

  /**
   * Disclosure pill for bounded data (docs/devframe-migration.md §6.7 B):
   * "Showing N of M" when the server's capture cut items (M may be unknown),
   * entries dropped before they were stored, and `stale` when the app did not
   * answer and an earlier reply is shown. `detached` reports a UI-side symptom
   * (tree nodes whose parent fell outside the capture).
   */
  let {
    info,
    noun = 'items',
    detached = 0,
    stale = null,
  }: {
    info?: CaptureInfo | null
    noun?: string
    detached?: number
    stale?: string | null
  } = $props()

  const reasons: Record<string, string> = {
    'runtime-count': 'the app buffer was full before they were sent',
    'runtime-bytes': 'the app buffer hit its size budget before they were sent',
    'server-count': 'the dev server buffer was full',
    'server-bytes': 'the dev server buffer hit its size budget',
  }

  const truncated = $derived(
    !!info?.truncated && (info.total === null || info.total > info.captured),
  )
  const dropped = $derived(info?.dropped?.reduce((s, d) => s + d.count, 0) ?? 0)
  const title = $derived(
    [
      truncated
        ? info!.total === null
          ? `The dev server keeps ${info!.captured.toLocaleString()} ${noun}; more exist in the app (total not reported).`
          : `The dev server keeps ${info!.captured.toLocaleString()} ${noun}; ${(info!.total - info!.captured).toLocaleString()} more exist in the app.`
        : '',
      info?.policy ? `Policy: ${info.policy}.` : '',
      ...(info?.dropped ?? [])
        .filter(d => d.count > 0)
        .map(d => `${d.count.toLocaleString()} dropped: ${reasons[d.reason] ?? d.reason}.`),
      info?.valueTooLarge
        ? `${info.valueTooLarge.toLocaleString()} values were too large to snapshot (shown as a size).`
        : '',
      detached
        ? `${detached.toLocaleString()} ${noun} are shown as roots because their parent was not captured.`
        : '',
      stale ? `Stale: ${stale}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
</script>

{#if truncated || dropped || detached || stale}
  <span class="notice" role="status" {title}>
    <Icon name="warning" size={12} />
    {#if truncated}
      Showing {#if info!.policy}{info!.policy}{/if}
      <strong class="num">{info!.captured.toLocaleString()}</strong>
      {#if info!.total === null}of ?{:else}of <span class="num">{info!.total.toLocaleString()}</span
        >{/if}
    {/if}
    {#if dropped}
      {#if truncated}·{/if}
      <span class="num">{dropped.toLocaleString()}</span> dropped
    {/if}
    {#if detached}
      {#if truncated || dropped}·{/if}
      <span class="num">{detached.toLocaleString()}</span> detached
    {/if}
    {#if stale}
      {#if truncated || dropped || detached}·{/if}
      stale
    {/if}
  </span>
{/if}

<style>
  .notice {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-full);
    background: var(--yellow-bg);
    color: var(--yellow);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: help;
  }
  strong {
    font-weight: 650;
  }
</style>
