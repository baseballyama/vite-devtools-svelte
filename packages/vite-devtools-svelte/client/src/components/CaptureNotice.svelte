<script lang="ts">
  import type { CaptureInfo } from '../lib/capture.svelte.js'
  import Icon from './Icon.svelte'

  /**
   * "Showing N of M" pill shown when the server's bounded capture dropped
   * items. `detached` reports a UI-side symptom (e.g. tree nodes whose parent
   * fell outside the capture) even when the server sends no metadata.
   */
  let {
    info,
    noun = 'items',
    detached = 0,
  }: { info?: CaptureInfo | null; noun?: string; detached?: number } = $props()

  const truncated = $derived(!!info?.truncated && info.total > info.captured)
  const title = $derived(
    [
      truncated
        ? `The dev server keeps at most ${info!.captured.toLocaleString()} ${noun}; ${(info!.total - info!.captured).toLocaleString()} more exist in the app${info!.policy ? ` (kept: ${info!.policy})` : ''}.`
        : '',
      detached ? `${detached.toLocaleString()} ${noun} are shown as roots because their parent was not captured.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
</script>

{#if truncated || detached}
  <span class="notice" role="status" {title}>
    <Icon name="warning" size={12} />
    {#if truncated}
      Showing <strong class="num">{info!.captured.toLocaleString()}</strong> of <span class="num">{info!.total.toLocaleString()}</span>
    {/if}
    {#if detached}
      {#if truncated}·{/if}
      <span class="num">{detached.toLocaleString()}</span> detached
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
