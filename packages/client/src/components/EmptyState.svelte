<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { IconName } from '../lib/icons.js'
  import Icon from './Icon.svelte'

  let {
    icon,
    title,
    tone = 'neutral',
    children,
  }: { icon?: IconName; title: string; tone?: 'neutral' | 'error'; children?: Snippet } = $props()
</script>

<div class="empty {tone}" role={tone === 'error' ? 'alert' : 'status'}>
  {#if icon}<span class="ico"><Icon name={icon} size={20} /></span>{/if}
  <p class="title">{title}</p>
  {#if children}<div class="body">{@render children()}</div>{/if}
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
  .error .ico {
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
