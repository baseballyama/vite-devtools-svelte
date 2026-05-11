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
  aria-pressed={theme === 'dark'}
  onclick={toggle}
>
  <span class="track" aria-hidden="true">
    <span class="thumb">
      {#if theme === 'dark'}
        <svg viewBox="0 0 24 24" width="11" height="11">
          <path
            fill="currentColor"
            d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"
          />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="11" height="11">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <line x1="12" y1="2.5" x2="12" y2="4.5" />
            <line x1="12" y1="19.5" x2="12" y2="21.5" />
            <line x1="2.5" y1="12" x2="4.5" y2="12" />
            <line x1="19.5" y1="12" x2="21.5" y2="12" />
            <line x1="4.6" y1="4.6" x2="6" y2="6" />
            <line x1="18" y1="18" x2="19.4" y2="19.4" />
            <line x1="4.6" y1="19.4" x2="6" y2="18" />
            <line x1="18" y1="6" x2="19.4" y2="4.6" />
          </g>
        </svg>
      {/if}
    </span>
  </span>
</button>

<style>
  .toggle {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    margin-left: 0.25rem;
  }

  .track {
    display: inline-flex;
    align-items: center;
    width: 44px;
    height: 22px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    padding: 1px;
    transition:
      background 200ms var(--ease),
      border-color 200ms var(--ease);
  }

  .toggle:hover .track {
    border-color: var(--line-strong);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--paper);
    color: var(--text);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.2),
      0 0 0 1px var(--line) inset;
    transform: translateX(0);
    transition: transform 280ms var(--ease-out);
  }

  :global(html[data-theme='dark']) .thumb {
    transform: translateX(0);
  }

  :global(html[data-theme='light']) .thumb {
    transform: translateX(22px);
    color: var(--brand);
  }
</style>
