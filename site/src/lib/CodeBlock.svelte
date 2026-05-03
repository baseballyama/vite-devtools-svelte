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
    } catch {
      // ignore
    }
  }
</script>

<div class="codeblock">
  {#if filename}
    <div class="codeblock-head">
      <span class="filename">{filename}</span>
      <button type="button" class="copy" onclick={copy} aria-label="Copy code">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="copy floating"
      onclick={copy}
      aria-label="Copy code"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  {/if}
  <pre><code data-lang={lang}>{code}</code></pre>
</div>

<style>
  .codeblock {
    position: relative;
    margin: 0 0 1.25rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    overflow: hidden;
    background: var(--code-bg);
  }

  .codeblock-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
  }

  .filename {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .copy {
    appearance: none;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }

  .copy:hover {
    color: var(--text);
    background: var(--bg-elev-2);
  }

  .copy.floating {
    position: absolute;
    top: 0.5rem;
    right: 0.6rem;
    z-index: 1;
  }

  pre {
    margin: 0;
    border: 0;
    border-radius: 0;
  }
</style>
