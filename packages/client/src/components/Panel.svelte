<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * Panel chrome: one compact header row (title, count, toolbar, actions)
   * above a body that fills the remaining height. Lists scroll themselves;
   * pass `scroll` for document-like panels.
   */
  interface Props {
    title: string
    count?: number | string | null
    toolbar?: Snippet
    actions?: Snippet
    scroll?: boolean
    children: Snippet
  }

  let { title, count = null, toolbar, actions, scroll = false, children }: Props = $props()
</script>

<section class="panel" aria-label={title}>
  <header class="header">
    <h1 class="title">
      {title}
      {#if count != null}<span class="count num">{count}</span>{/if}
    </h1>
    {#if toolbar}<div class="toolbar">{@render toolbar()}</div>{/if}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  <div class="body" class:scroll>
    {@render children()}
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  .header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    min-height: var(--header-h);
    padding: 8px 12px 8px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 6px 0 0;
    font-size: var(--fs-md);
    font-weight: 600;
    letter-spacing: -0.005em;
    white-space: nowrap;
  }
  .count {
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--fg-faint);
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1 1 260px;
    min-width: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .body.scroll {
    overflow: auto;
  }
</style>
