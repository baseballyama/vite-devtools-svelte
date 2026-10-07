<script lang="ts">
  import type { Snippet } from 'svelte'

  import type { IconName } from '../lib/icons.js'
  import Icon from './Icon.svelte'

  /**
   * Placeholder for an empty, loading or failed view. With `error` (the
   * failure message, shown monospace above any children) it is an alert
   * with the error icon.
   */
  let {
    icon,
    title,
    error,
    children,
  }: { icon?: IconName; title: string; error?: string | null; children?: Snippet } = $props()

  const failed = $derived(error != null)
  const ico = $derived(failed ? 'errors' : icon)
</script>

<div class="empty" class:failed role={failed ? 'alert' : 'status'}>
  {#if ico}<span class="ico"><Icon name={ico} size={20} /></span>{/if}
  <p class="title">{title}</p>
  {#if error || children}<div class="body">
      {#if error}<p class="mono">{error}</p>{/if}
      {@render children?.()}
    </div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 40px 24px;
    text-align: center;
    height: 100%;
    min-height: 160px;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-lg);
    background: var(--bg-active);
    color: var(--fg-muted);
    margin-bottom: 4px;
  }
  .failed .ico {
    background: var(--red-bg);
    color: var(--red);
  }
  .title {
    margin: 0;
    font-weight: 600;
    color: var(--fg);
  }
  .body {
    max-width: 420px;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .body :global(p) {
    margin: 0;
  }
</style>
