<script lang="ts">
  const managers = [
    { id: 'npm', cmd: 'npm install -D vite-devtools-svelte' },
    { id: 'pnpm', cmd: 'pnpm add -D vite-devtools-svelte' },
    { id: 'yarn', cmd: 'yarn add -D vite-devtools-svelte' },
    { id: 'bun', cmd: 'bun add -d vite-devtools-svelte' },
  ]
  let active = $state(0)
  let copied = $state(false)
  const tabs: HTMLButtonElement[] = []

  async function copy() {
    try {
      await navigator.clipboard.writeText(managers[active].cmd)
      copied = true
      setTimeout(() => (copied = false), 1600)
    } catch {
      /* clipboard unavailable — the command stays selectable */
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    active = (active + step + managers.length) % managers.length
    tabs[active]?.focus()
  }
</script>

<div class="install">
  <div class="tabs" role="tablist" aria-label="Package manager" tabindex="-1" {onkeydown}>
    {#each managers as m, i (m.id)}
      <button
        bind:this={tabs[i]}
        type="button"
        role="tab"
        id="pm-tab-{m.id}"
        aria-selected={i === active}
        aria-controls="pm-panel"
        tabindex={i === active ? 0 : -1}
        onclick={() => (active = i)}
      >
        {m.id}
      </button>
    {/each}
  </div>
  <div class="cmd" id="pm-panel" role="tabpanel" aria-labelledby="pm-tab-{managers[active].id}">
    <code><span class="prompt" aria-hidden="true">$ </span>{managers[active].cmd}</code>
    <button type="button" class="copy" onclick={copy} aria-label="Copy install command">
      {copied ? 'Copied' : 'Copy'}
    </button>
    <span class="sr-only" aria-live="polite">{copied ? 'Install command copied' : ''}</span>
  </div>
</div>

<style>
  .install {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--code-bg);
    overflow: hidden;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.4rem 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }

  .tabs button {
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-3);
    background: none;
    border: 0;
    padding: 0.55rem 0.65rem 0.6rem;
    cursor: pointer;
    box-shadow: inset 0 -2px 0 transparent;
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button[aria-selected='true'] {
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--brand);
  }

  .cmd {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.1rem 1.25rem;
  }

  code {
    flex: 1;
    min-width: 0;
    font-size: 0.92rem;
    color: var(--text);
    overflow-x: auto;
    white-space: nowrap;
  }

  .prompt {
    color: var(--text-3);
    user-select: none;
    -webkit-user-select: none;
  }

  .copy {
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-2);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    cursor: pointer;
  }

  .copy:hover {
    color: var(--text);
    background: var(--paper-2);
  }
</style>
