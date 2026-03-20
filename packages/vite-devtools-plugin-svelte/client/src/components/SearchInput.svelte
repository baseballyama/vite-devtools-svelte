<script lang="ts">
  let { value = $bindable(''), placeholder = 'Search...' }: { value?: string; placeholder?: string } = $props()
</script>

<input
  type="text"
  class="search-input"
  bind:value
  {placeholder}
/>

<style>
  .search-input {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    width: 180px;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .search-input::placeholder {
    color: var(--color-text-faint);
  }

  .search-input:focus {
    border-color: var(--color-border-input);
  }
</style>
