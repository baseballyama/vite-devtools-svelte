<script lang="ts">
  type Variant = 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral'

  let { variant = 'neutral', children }: { variant?: Variant; children: any } = $props()
</script>

<span class="badge {variant}">
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    line-height: 1.6em;
    font-weight: 500;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .neutral {
    background: var(--color-surface-badge);
    color: var(--color-text-secondary);
    border-color: rgba(136, 136, 136, 0.1);
  }
  .accent {
    background: rgba(255, 62, 0, 0.15);
    color: var(--color-accent-400);
    border-color: rgba(255, 62, 0, 0.1);
  }
  .info {
    background: var(--color-info-bg);
    color: var(--color-info);
    border-color: rgba(59, 130, 246, 0.1);
  }
  .success {
    background: var(--color-success-bg);
    color: var(--color-success);
    border-color: rgba(34, 197, 94, 0.1);
  }
  .warning {
    background: var(--color-warning-bg);
    color: var(--color-warning);
    border-color: rgba(234, 179, 8, 0.1);
  }
  .error {
    background: var(--color-error-bg);
    color: var(--color-error);
    border-color: rgba(239, 68, 68, 0.1);
  }
</style>
