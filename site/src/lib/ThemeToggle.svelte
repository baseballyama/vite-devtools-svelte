<script lang="ts">
  import { onMount } from 'svelte'

  let theme = $state<'dark' | 'light'>('dark')

  onMount(() => {
    const current = document.documentElement.dataset.theme
    theme = current === 'light' ? 'light' : 'dark'
  })

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }
</script>

<button
  class="toggle"
  type="button"
  aria-label="Toggle color theme"
  onclick={toggle}
>
  {#if theme === 'dark'}
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"
      />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
        <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
        <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
        <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
        <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
      </g>
    </svg>
  {/if}
</button>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
    cursor: pointer;
    transition: background 120ms ease;
  }

  .toggle:hover {
    background: var(--bg-elev-2);
  }
</style>
