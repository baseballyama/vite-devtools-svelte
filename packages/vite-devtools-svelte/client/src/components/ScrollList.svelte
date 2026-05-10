<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  let {
    items,
    item: itemSnippet,
    empty,
    itemHeight = 56,
    overscan = 6,
    getKey,
  }: {
    items: T[]
    item: Snippet<[T, number]>
    empty?: Snippet
    /** Fixed row height in px. Used for windowing math; rows must match this. */
    itemHeight?: number
    /** Extra rows rendered above/below the viewport to hide scroll jank. */
    overscan?: number
    /** Optional key extractor to keep #each blocks stable across mutations. */
    getKey?: (item: T, index: number) => string | number
  } = $props()

  let scrollEl = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let viewportHeight = $state(0)

  const total = $derived(items.length)
  const totalHeight = $derived(total * itemHeight)

  // Visible range expressed as [start, end) item indices.
  const range = $derived.by(() => {
    if (total === 0 || itemHeight <= 0) return { start: 0, end: 0 }
    const visibleStart = Math.floor(scrollTop / itemHeight)
    // viewportHeight may be 0 on first render before bind: settles; render at
    // least one screenful (estimated) so the panel isn't empty in that frame.
    const visible = Math.max(1, Math.ceil((viewportHeight || itemHeight * 10) / itemHeight))
    const start = Math.max(0, visibleStart - overscan)
    const end = Math.min(total, visibleStart + visible + overscan)
    return { start, end }
  })

  // Stable list of (item, absoluteIndex) pairs for the visible window.
  const visibleItems = $derived.by(() => {
    const out: { item: T; index: number; key: string | number }[] = []
    for (let i = range.start; i < range.end; i++) {
      const it = items[i]
      out.push({ item: it, index: i, key: getKey ? getKey(it, i) : i })
    }
    return out
  })

  function onScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop
  }
</script>

<div
  class="scroll-list"
  bind:this={scrollEl}
  bind:clientHeight={viewportHeight}
  onscroll={onScroll}
>
  {#if total === 0}
    {#if empty}{@render empty()}{/if}
  {:else}
    <div class="spacer" style="height: {totalHeight}px;">
      <div class="window" style="transform: translateY({range.start * itemHeight}px);">
        {#each visibleItems as v (v.key)}
          <div class="row" style="height: {itemHeight}px;">
            {@render itemSnippet(v.item, v.index)}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .scroll-list {
    flex: 1;
    overflow-y: auto;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    min-width: 0;
    position: relative;
    box-shadow: var(--shadow-sm);
  }
  .spacer {
    position: relative;
    width: 100%;
  }
  .window {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
  .row {
    box-sizing: border-box;
    overflow: hidden;
  }
</style>
