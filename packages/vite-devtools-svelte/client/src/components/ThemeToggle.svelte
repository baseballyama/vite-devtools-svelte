<script lang="ts">
  import type { ThemeStore } from '../lib/theme.svelte.js'

  let { theme }: { theme: ThemeStore } = $props()

  // Three explicit segments (System / Light / Dark). The active segment slides
  // visually using a position-based highlight pill rather than per-button
  // backgrounds, so the transition between modes feels smooth.
  const options: Array<{ id: 'system' | 'light' | 'dark'; label: string; icon: string }> = [
    { id: 'system', label: 'System', icon: 'i-theme-system' },
    { id: 'light', label: 'Light', icon: 'i-theme-light' },
    { id: 'dark', label: 'Dark', icon: 'i-theme-dark' },
  ]

  const activeIndex = $derived(options.findIndex((o) => o.id === theme.mode))
</script>

<div class="theme-toggle" role="group" aria-label="Theme">
  <span
    class="theme-pill"
    aria-hidden="true"
    style="--idx: {activeIndex}"
  ></span>
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
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    padding: 3px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .theme-pill {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: calc(3px + var(--idx, 0) * (100% - 6px) / 3);
    width: calc((100% - 6px) / 3);
    background: linear-gradient(180deg, var(--color-surface-tertiary), var(--color-surface-secondary));
    border-radius: calc(var(--radius-md) - 3px);
    box-shadow: var(--shadow-sm), 0 0 0 1px var(--color-border-active) inset;
    transition: left var(--transition-normal) var(--ease-out-expo);
  }

  .theme-btn {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .theme-btn:hover {
    color: var(--color-text);
  }

  .theme-btn.active {
    color: var(--color-text-accent);
  }

  .theme-icon {
    width: 13px;
    height: 13px;
    background: currentColor;
    -webkit-mask: var(--icon) center / contain no-repeat;
    mask: var(--icon) center / contain no-repeat;
  }

  .i-theme-system {
    --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='14' rx='2'/%3E%3Cpath d='M8 21h8M12 18v3'/%3E%3C/svg%3E");
  }

  .i-theme-light {
    --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Cpath d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'/%3E%3C/svg%3E");
  }

  .i-theme-dark {
    --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/%3E%3C/svg%3E");
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
