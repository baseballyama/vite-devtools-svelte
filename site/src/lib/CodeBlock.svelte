<script lang="ts">
  type Props = {
    code: string
    lang?: string
    filename?: string
  }

  let { code, lang = 'ts', filename }: Props = $props()
  let copied = $state(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {}
  }
</script>

<div class="codeblock">
  <header class="codeblock-head">
    {#if filename}
      <span class="filename mono">{filename}</span>
    {:else}
      <span class="filename mono dim">{lang}</span>
    {/if}
    <span class="lang-badge mono">{lang}</span>
    <button type="button" class="copy mono" onclick={copy} aria-label="Copy code">
      {#if copied}
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M5 12l5 5L20 6"
          />
        </svg>
        copied
      {:else}
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <rect
            x="8"
            y="8"
            width="13"
            height="13"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
          />
        </svg>
        copy
      {/if}
    </button>
  </header>
  <pre><code data-lang={lang}>{code}</code></pre>
</div>

<style>
  .codeblock {
    position: relative;
    margin: 0 0 1.5rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    overflow: hidden;
    background: var(--code-bg);
  }

  .codeblock-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--line);
    background: var(--paper-2);
  }

  .filename {
    font-size: 0.78rem;
    color: var(--text-2);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lang-badge {
    font-size: 0.68rem;
    color: var(--text-3);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.15em 0.5em;
    border: 1px solid var(--line);
    border-radius: 4px;
  }

  .copy {
    appearance: none;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--text-3);
    font-size: 0.72rem;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    transition:
      color 150ms var(--ease),
      border-color 150ms var(--ease),
      background 150ms var(--ease);
  }

  .copy:hover {
    color: var(--text);
    background: var(--bg-2);
    border-color: var(--line-strong);
  }

  pre {
    margin: 0;
    border: 0;
    border-radius: 0;
    padding: 1.05rem 1.2rem;
  }
</style>
