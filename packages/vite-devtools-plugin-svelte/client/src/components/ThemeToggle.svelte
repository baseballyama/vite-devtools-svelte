<script lang="ts">
  import type { ThemeStore } from '../lib/theme.svelte.js'

  let { theme }: { theme: ThemeStore } = $props()

  // Three explicit buttons (System / Light / Dark) is more discoverable than
  // a cycle button. The active one is highlighted; the others sit at the same
  // muted opacity as the rest of the sidebar nav.
  const options: Array<{ id: 'system' | 'light' | 'dark'; label: string; icon: string }> = [
    { id: 'system', label: 'System', icon: 'i-theme-system' },
    { id: 'light', label: 'Light', icon: 'i-theme-light' },
    { id: 'dark', label: 'Dark', icon: 'i-theme-dark' },
  ]
</script>

<div class="theme-toggle" role="group" aria-label="Theme">
  {#each options as opt}
    <button
      type="button"
      class="theme-btn"
      class:active={theme.mode === opt.id}
      onclick={() => theme.set(opt.id)}
      title="Use {opt.label} theme"
      aria-pressed={theme.mode === opt.id}
    >
      <span class="theme-icon {opt.icon}" aria-hidden="true"></span>
      <span class="sr-only">{opt.label}</span>
    </button>
  {/each}
</div>

<style>
  .theme-toggle {
    display: flex;
    gap: 2px;
    margin: var(--space-2) var(--space-1) 0;
    padding: 2px;
    background: var(--color-surface-active);
    border-radius: var(--radius-md);
  }

  .theme-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    padding: 0;
    background: none;
    border: none;
    border-radius: calc(var(--radius-md) - 2px);
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .theme-btn:hover {
    color: var(--color-text);
  }

  .theme-btn.active {
    background: var(--color-base);
    color: var(--color-text-accent);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .theme-btn:focus-visible {
    outline: 2px solid var(--color-accent-500);
    outline-offset: 1px;
  }

  .theme-icon {
    width: 14px;
    height: 14px;
    background: currentColor;
    -webkit-mask: var(--icon) center / contain no-repeat;
    mask: var(--icon) center / contain no-repeat;
  }

  /* "Auto" — gear / circle-half */
  .i-theme-system {
    --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M12 3a9 9 0 0 1 0 18z' fill='currentColor'/%3E%3C/svg%3E");
  }

  /* Sun */
  .i-theme-light {
    --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Cpath d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'/%3E%3C/svg%3E");
  }

  /* Moon */
  .i-theme-dark {
    --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/%3E%3C/svg%3E");
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
