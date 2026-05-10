<script lang="ts">
  import type { Snippet } from 'svelte'

  // Cards now have an `eyebrow` slot pattern: a tiny uppercase label sits
  // above the title for editorial rhythm. `tone="raised"` adds a soft drop
  // shadow + brighter surface for hero cards; the default tone is flat.
  type Tone = 'flat' | 'raised' | 'inset'

  let {
    title = '',
    eyebrow = '',
    tone = 'flat',
    actions,
    children,
  }: {
    title?: string
    eyebrow?: string
    tone?: Tone
    actions?: Snippet
    children: Snippet
  } = $props()
</script>

<div class="card tone-{tone}">
  {#if title || eyebrow || actions}
    <header class="card-head">
      <div class="card-titles">
        {#if eyebrow}
          <span class="card-eyebrow">{eyebrow}</span>
        {/if}
        {#if title}
          <h3 class="card-title">{title}</h3>
        {/if}
      </div>
      {#if actions}
        <div class="card-actions">{@render actions()}</div>
      {/if}
    </header>
  {/if}
  <div class="card-body">
    {@render children()}
  </div>
</div>

<style>
  .card {
    position: relative;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    padding: var(--space-3) var(--space-4);
    transition:
      border-color var(--transition-fast),
      box-shadow var(--transition-normal),
      transform var(--transition-normal);
  }

  .tone-raised {
    background: linear-gradient(180deg, var(--color-surface), var(--color-surface-secondary));
    box-shadow: var(--shadow-md);
  }

  .tone-inset {
    background: var(--color-base-tinted, var(--color-base));
    border-style: dashed;
  }

  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .card-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .card-eyebrow {
    font-size: 9.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-faint);
    line-height: 1;
  }

  .card-title {
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.3;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .card-body {
    min-width: 0;
  }
</style>
