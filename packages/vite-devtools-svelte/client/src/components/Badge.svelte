<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral'

  let {
    variant = 'neutral',
    dot = false,
    children,
  }: { variant?: Variant; dot?: boolean; children: Snippet } = $props()
</script>

<span class="badge {variant}" class:has-dot={dot}>
  {#if dot}<span class="badge-dot" aria-hidden="true"></span>{/if}
  <span class="badge-content">{@render children()}</span>
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs);
    line-height: 1.6em;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
    border: 1px solid transparent;
    background: var(--color-surface-badge);
  }

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
    flex-shrink: 0;
  }

  .badge-content {
    font-family: var(--font-mono);
    font-feature-settings: 'zero', 'ss01';
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .neutral {
    background: var(--color-surface-badge);
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }
  .accent {
    background: rgba(255, 62, 0, 0.1);
    color: var(--color-accent-400);
    border-color: rgba(255, 62, 0, 0.2);
  }
  .info {
    background: var(--color-info-bg);
    color: var(--color-info);
    border-color: var(--color-info-border);
  }
  .success {
    background: var(--color-success-bg);
    color: var(--color-success);
    border-color: var(--color-success-border);
  }
  .warning {
    background: var(--color-warning-bg);
    color: var(--color-warning);
    border-color: var(--color-warning-border);
  }
  .error {
    background: var(--color-error-bg);
    color: var(--color-error);
    border-color: var(--color-error-border);
  }
</style>
