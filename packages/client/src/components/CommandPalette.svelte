<script lang="ts">
  import { tick } from 'svelte'

  import { matcher } from '../lib/match.js'
  import Highlight from './Highlight.svelte'
  import Icon from './Icon.svelte'
  import type { Command } from './types.js'

  let { open = $bindable(false), commands }: { open?: boolean; commands: Command[] } = $props()

  let query = $state('')
  let index = $state(0)
  let input = $state<HTMLInputElement | null>(null)
  let listEl = $state<HTMLElement | null>(null)
  let returnFocus: HTMLElement | null = null

  const results = $derived.by(() => {
    const m = matcher(query)
    return m ? commands.filter(c => m(c.label, c.hint, c.group, c.keywords)) : commands
  })

  $effect(() => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null
      query = ''
      index = 0
      void tick().then(() => input?.focus())
    }
  })

  function close() {
    open = false
    returnFocus?.focus()
  }

  function run(c: Command | undefined) {
    if (!c) return
    open = false
    c.run()
  }

  function move(delta: number) {
    if (!results.length) return
    index = (index + delta + results.length) % results.length
    void tick().then(() =>
      listEl?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' }),
    )
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter') run(results[index])
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') {
      // Focus trap: the input is the only tab stop inside the dialog.
    } else return
    e.preventDefault()
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={e => e.target === e.currentTarget && close()}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="field">
        <Icon name="search" size={15} />
        <input
          bind:this={input}
          bind:value={query}
          oninput={() => (index = 0)}
          {onkeydown}
          placeholder="Go to panel or run a command…"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results.length ? `palette-${index}` : undefined}
          aria-autocomplete="list"
          spellcheck="false"
        />
        <kbd>esc</kbd>
      </div>
      <ul id="palette-list" class="list" role="listbox" aria-label="Commands" bind:this={listEl}>
        {#each results as c, i (c.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="palette-{i}"
            data-i={i}
            class="item"
            class:active={i === index}
            role="option"
            aria-selected={i === index}
            onclick={() => run(c)}
            onmousemove={() => (index = i)}
          >
            <Icon name={c.icon} size={15} />
            <span class="label"><Highlight text={c.label} {query} /></span>
            {#if c.hint}<span class="hint truncate">{c.hint}</span>{/if}
            <span class="group">{c.group}</span>
          </li>
        {:else}
          <li class="none" role="presentation">No matches for “{query}”</li>
        {/each}
      </ul>
      <footer class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>/</kbd> filter current panel</span>
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: min(14vh, 96px) 16px 16px;
    background: rgb(0 0 0 / 0.35);
    animation: fade var(--dur) var(--ease);
  }
  .palette {
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    max-height: min(480px, 100%);
    background: var(--bg-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: rise var(--dur) var(--ease);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 46px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-faint);
  }
  .field input {
    flex: 1;
    border: 0;
    outline: none;
    background: none;
    font-size: var(--fs-lg);
    color: var(--fg);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--fg-muted);
    cursor: pointer;
  }
  .item.active {
    background: var(--bg-active);
    color: var(--fg);
  }
  .item.active :global(.icon) {
    color: var(--accent-fg);
  }
  .label {
    font-weight: 500;
    white-space: nowrap;
  }
  .hint {
    flex: 1;
    color: var(--fg-faint);
    font-size: var(--fs-sm);
  }
  .group {
    margin-left: auto;
    font-size: var(--fs-2xs);
    color: var(--fg-faint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .none {
    padding: 24px;
    text-align: center;
    color: var(--fg-faint);
  }
  .foot {
    display: flex;
    gap: 14px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .foot span {
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
  kbd {
    padding: 0 4px;
    min-width: 16px;
    text-align: center;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    font-size: var(--fs-2xs);
    line-height: 15px;
    color: var(--fg-muted);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.99);
    }
  }
</style>
