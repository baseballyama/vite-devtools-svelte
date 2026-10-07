<script lang="ts">
  import type { Snippet } from 'svelte'

  import Button from './Button.svelte'

  /** Detail pane shown in a SplitView's aside. Esc closes it. */
  interface Props {
    title: string
    subtitle?: string
    badges?: Snippet
    actions?: Snippet
    onclose?: () => void
    children: Snippet
  }

  let { title, subtitle, badges, actions, onclose, children }: Props = $props()

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && onclose) {
      e.stopPropagation()
      onclose()
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="inspector" aria-label="{title} details" {onkeydown}>
  <header class="head">
    <div class="titles">
      <h2 class="title truncate" {title}>{title}</h2>
      {#if subtitle}<p class="subtitle truncate mono" title={subtitle}>{subtitle}</p>{/if}
    </div>
    {#if onclose}
      <Button icon="close" variant="ghost" label="Close details (Esc)" onclick={onclose} />
    {/if}
  </header>
  {#if badges || actions}
    <div class="bar">
      {#if badges}<div class="badges">{@render badges()}</div>{/if}
      {#if actions}<div class="acts">{@render actions()}</div>{/if}
    </div>
  {/if}
  <div class="content">{@render children()}</div>
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 8px 6px 14px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .subtitle {
    margin: 2px 0 0;
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 14px 10px;
    border-bottom: 1px solid var(--border);
  }
  .badges,
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .acts {
    margin-left: auto;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 16px;
  }
</style>
