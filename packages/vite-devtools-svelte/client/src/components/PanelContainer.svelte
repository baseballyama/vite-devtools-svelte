<script lang="ts">
  import type { Snippet } from 'svelte'

  // PanelContainer now provides an optional standardized header strip with:
  //   - `count`     — small monospace count chip
  //   - `summary`   — one-line italic editorial caption
  //   - `actions`   — right-aligned slot for filters / toggles
  //
  // Panels that want full control over their layout can omit `title` and
  // render whatever they want as children — the wrapper still gives them the
  // flex column layout and gap.
  let {
    title = '',
    count,
    summary = '',
    actions,
    children,
  }: {
    title?: string
    count?: number | string
    summary?: string
    actions?: Snippet
    children: Snippet
  } = $props()
</script>

<div class="panel-container">
  {#if title || actions || summary || count !== undefined}
    <header class="panel-head">
      <div class="panel-titles">
        {#if title}
          <h2 class="panel-title">
            {title}
            {#if count !== undefined}<span class="panel-count font-mono">{count}</span>{/if}
          </h2>
        {/if}
        {#if summary}
          <p class="panel-summary">{summary}</p>
        {/if}
      </div>
      {#if actions}
        <div class="panel-actions">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}
  <div class="panel-body">
    {@render children()}
  </div>
</div>

<style>
  .panel-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .panel-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px dashed var(--color-border);
  }

  .panel-titles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .panel-title {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    margin: 0;
    line-height: 1;
  }

  .panel-count {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-faint);
    padding: 2px 6px;
    background: var(--color-surface-badge);
    border-radius: var(--radius-full);
    line-height: 1.2;
  }

  .panel-summary {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-base);
    color: var(--color-text-muted);
    line-height: 1.3;
    margin: 0;
    letter-spacing: var(--tracking-tight);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .panel-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
  }
</style>
