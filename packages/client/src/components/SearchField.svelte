<script lang="ts">
  import Icon from './Icon.svelte'

  /** Panel search box. `/` from anywhere in the panel focuses it (see App). */
  let {
    value = $bindable(''),
    placeholder = 'Filter…',
    label = 'Filter',
    count = null,
  }: { value?: string; placeholder?: string; label?: string; count?: number | null } = $props()

  let input = $state<HTMLInputElement | null>(null)

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && value) {
      e.stopPropagation()
      value = ''
    } else if (e.key === 'ArrowDown') {
      // Hand focus to the first list in the panel for keyboard-only flows.
      const panel = input?.closest('section')
      const list = panel?.querySelector<HTMLElement>('[role="listbox"],[role="tree"]')
      if (list) {
        e.preventDefault()
        list.focus()
      }
    }
  }
</script>

<label class="search">
  <Icon name="search" size={13} />
  <span class="sr-only">{label}</span>
  <input
    bind:this={input}
    bind:value
    data-panel-search
    type="search"
    {placeholder}
    spellcheck="false"
    autocomplete="off"
    {onkeydown}
  />
  {#if value && count != null}
    <span class="hits num" aria-live="polite">{count}</span>
  {:else if !value}
    <kbd class="hint" aria-hidden="true">/</kbd>
  {/if}
</label>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 6px 0 8px;
    flex: 0 1 260px;
    min-width: 120px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg-faint);
    transition: border-color var(--dur-fast) var(--ease);
  }
  .search:hover {
    border-color: var(--border-strong);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: none;
    background: none;
    color: var(--fg);
    font-size: var(--fs-sm);
  }
  input::placeholder {
    color: var(--fg-faint);
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .hits {
    font-size: var(--fs-2xs);
    color: var(--fg-muted);
  }
  .hint {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: var(--fs-2xs);
    line-height: 15px;
    color: var(--fg-faint);
  }
</style>
