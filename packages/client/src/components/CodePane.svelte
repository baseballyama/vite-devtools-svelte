<script lang="ts">
  /**
   * Virtualised, read-only code view with clickable lines. Fixed line height
   * lets the Compiled output panel draw source-map connectors from line
   * numbers and `scrollTop` alone.
   */
  interface Props {
    /** Pre-escaped, highlighted HTML per line. */
    html: string[]
    title: string
    highlighted: Set<number>
    origin?: boolean
    scrollTop?: number
    lineHeight?: number
    onlineclick?: (line: number) => void
  }

  let {
    html,
    title,
    highlighted,
    origin = false,
    scrollTop = $bindable(0),
    lineHeight = 18,
    onlineclick,
  }: Props = $props()

  let viewport = $state<HTMLDivElement | null>(null)
  let height = $state(0)
  const overscan = 20

  const start = $derived(Math.max(0, Math.floor(scrollTop / lineHeight) - overscan))
  const end = $derived(Math.min(html.length, Math.ceil((scrollTop + height) / lineHeight) + overscan))
  const gutterCh = $derived(String(html.length).length + 1)

  export function scrollToLine(line: number) {
    if (!viewport) return
    const top = (line - 1) * lineHeight
    if (top < viewport.scrollTop || top > viewport.scrollTop + height - lineHeight) {
      viewport.scrollTo({ top: Math.max(0, top - height / 3), behavior: 'smooth' })
    }
  }

  function onkeydown(e: KeyboardEvent) {
    // Arrow keys walk the highlighted line so mappings can be followed
    // without a mouse.
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const cur = highlighted.size && origin ? Math.min(...highlighted) : 0
    const next = Math.max(1, Math.min(html.length, cur + (e.key === 'ArrowDown' ? 1 : -1)))
    e.preventDefault()
    onlineclick?.(next)
    scrollToLine(next)
  }
</script>

<div class="pane">
  <div class="title">
    <span>{title}</span>
    <span class="faint num">{html.length} lines</span>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="viewport"
    bind:this={viewport}
    bind:clientHeight={height}
    onscroll={() => viewport && (scrollTop = viewport.scrollTop)}
    tabindex="0"
    role="region"
    aria-label="{title} code"
    {onkeydown}
  >
    <div class="spacer" style:height="{html.length * lineHeight}px" style:--lh="{lineHeight}px" style:--gutter="{gutterCh}ch">
      {#each { length: end - start } as _, j (start + j)}
        {@const ln = start + j + 1}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="line"
          class:hl={highlighted.has(ln)}
          class:origin={origin && highlighted.has(ln)}
          style:transform="translateY({(ln - 1) * lineHeight}px)"
          onclick={() => onlineclick?.(ln)}
        >
          <span class="ln num">{ln}</span><span class="src">{@html html[ln - 1] || ' '}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 28px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--fg-muted);
  }
  .viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-inset);
    outline: none;
  }
  .viewport:focus-visible {
    box-shadow: inset 0 0 0 1px var(--focus);
  }
  .spacer {
    position: relative;
    min-width: max-content;
  }
  .line {
    position: absolute;
    top: 0;
    left: 0;
    min-width: 100%;
    height: var(--lh);
    display: flex;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: var(--lh);
    white-space: pre;
    cursor: pointer;
  }
  .line:hover {
    background: var(--bg-hover);
  }
  .line.hl {
    background: var(--bg-selected);
  }
  .line.origin {
    background: var(--bg-selected-strong);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .ln {
    position: sticky;
    left: 0;
    flex-shrink: 0;
    width: calc(var(--gutter) + 12px);
    padding-right: 10px;
    text-align: right;
    color: var(--fg-faint);
    background: inherit;
    background-color: var(--bg-inset);
    user-select: none;
  }
  .hl .ln {
    color: var(--accent-fg);
  }
  .src {
    padding-right: 16px;
  }
  .src :global(.hl-kw) {
    color: var(--purple);
  }
  .src :global(.hl-st) {
    color: var(--green);
  }
  .src :global(.hl-nm),
  .src :global(.hl-lt) {
    color: var(--yellow);
  }
  .src :global(.hl-cm) {
    color: var(--fg-faint);
    font-style: italic;
  }
  .src :global(.hl-fn) {
    color: var(--blue);
  }
  .src :global(.hl-sv) {
    color: var(--accent-fg);
    font-weight: 600;
  }
  .src :global(.hl-tg) {
    color: var(--red);
  }
  .src :global(.hl-at) {
    color: var(--yellow);
  }
  .src :global(.hl-ex) {
    color: var(--cyan);
  }
  .src :global(.hl-cp) {
    color: var(--blue);
  }
  .src :global(.hl-cv) {
    color: var(--green);
  }
  .src :global(.hl-cs) {
    color: var(--purple);
  }
</style>
