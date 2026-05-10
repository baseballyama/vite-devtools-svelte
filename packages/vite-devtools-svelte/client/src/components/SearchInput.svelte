<script lang="ts">
  let {
    value = $bindable(''),
    placeholder = 'Search…',
    width = '220px',
  }: { value?: string; placeholder?: string; width?: string } = $props()
</script>

<label class="search-wrap" style:width>
  <span class="search-icon i-search" aria-hidden="true"></span>
  <input
    type="text"
    class="search-input"
    bind:value
    {placeholder}
    spellcheck="false"
    autocomplete="off"
  />
  {#if value}
    <button
      type="button"
      class="search-clear"
      onclick={() => (value = '')}
      aria-label="Clear search"
    >×</button>
  {/if}
</label>

<style>
  .search-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: var(--space-2);
    top: 50%;
    transform: translateY(-50%);
    width: 13px;
    height: 13px;
    background: currentColor;
    color: var(--color-text-faint);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E") center / contain no-repeat;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    padding: 6px var(--space-3) 6px 26px;
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    letter-spacing: var(--tracking-tight);
    outline: none;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast);
  }

  .search-input:hover {
    border-color: var(--color-border-strong);
  }

  .search-input::placeholder {
    color: var(--color-text-faint);
    font-style: italic;
  }

  .search-input:focus {
    border-color: var(--color-border-active);
    background: var(--color-base-tinted, var(--color-surface));
  }

  .search-clear {
    position: absolute;
    right: var(--space-1);
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface-active);
    border: none;
    border-radius: var(--radius-full);
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .search-clear:hover {
    background: var(--color-surface-tertiary);
    color: var(--color-text);
  }
</style>
