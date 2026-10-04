<script lang="ts" module>
  export interface RowState {
    index: number
    selected: boolean
  }

  let uid = 0
</script>

<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte'

  /**
   * Fixed-row-height virtual list. Renders only the rows in view (+overscan),
   * so 100k items cost the same DOM as 40. The viewport is a single tab stop
   * (ARIA listbox/tree/grid pattern with `aria-activedescendant`); selection
   * follows keyboard focus like the browser devtools element tree.
   */
  interface Props {
    items: readonly T[]
    getKey: (item: T, index: number) => string
    label: string
    row: Snippet<[T, RowState]>
    rowHeight?: number
    selected?: string | null
    role?: 'listbox' | 'tree'
    overscan?: number
    empty?: Snippet
    onselect?: (item: T, index: number) => void
    onactivate?: (item: T, index: number) => void
    /** Return true when the key was handled (skips default navigation). */
    onrowkeydown?: (e: KeyboardEvent, item: T, index: number) => boolean | void
    rowAttrs?: (item: T, index: number) => Record<string, string | number | boolean | undefined>
  }

  let {
    items,
    getKey,
    label,
    row,
    rowHeight = 28,
    selected = $bindable(null),
    role = 'listbox',
    overscan = 8,
    empty,
    onselect,
    onactivate,
    onrowkeydown,
    rowAttrs,
  }: Props = $props()

  const id = `vl${++uid}`
  let viewport = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let height = $state(0)

  const total = $derived(items.length * rowHeight)
  const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const end = $derived(Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan))
  const visible = $derived(items.slice(start, end))
  const pageSize = $derived(Math.max(1, Math.floor(height / rowHeight) - 1))

  const selectedIndex = $derived.by(() => {
    if (selected == null) return -1
    for (let i = 0; i < items.length; i++) if (getKey(items[i], i) === selected) return i
    return -1
  })

  $effect(() => {
    const el = viewport
    if (!el) return
    const ro = new ResizeObserver(() => {
      height = el.clientHeight
    })
    ro.observe(el)
    height = el.clientHeight
    return () => ro.disconnect()
  })

  // Clamp scroll when the list shrinks (e.g. a filter narrows results).
  $effect(() => {
    if (viewport && scrollTop > Math.max(0, total - height)) {
      viewport.scrollTop = Math.max(0, total - height)
    }
  })

  // Keep the selection in view when the selected *key* changes (inspector
  // links, reveal). Live updates that only shift its index must not yank
  // a user who scrolled away back to the selection.
  $effect(() => {
    const key = selected
    if (key == null) return
    untrack(() => {
      if (selectedIndex >= 0) scrollToIndex(selectedIndex)
    })
  })

  function onscroll() {
    if (viewport) scrollTop = viewport.scrollTop
  }

  export function scrollToIndex(i: number, align: 'auto' | 'center' = 'auto') {
    if (!viewport || i < 0) return
    const top = i * rowHeight
    if (align === 'center') {
      viewport.scrollTop = Math.max(0, top - height / 2 + rowHeight / 2)
    } else if (top < viewport.scrollTop) {
      viewport.scrollTop = top
    } else if (top + rowHeight > viewport.scrollTop + height) {
      viewport.scrollTop = top + rowHeight - height
    }
    scrollTop = viewport.scrollTop
  }

  export function focus() {
    viewport?.focus({ preventScroll: true })
  }

  export function select(i: number) {
    if (!items.length) return
    const idx = Math.max(0, Math.min(items.length - 1, i))
    const item = items[idx]
    selected = getKey(item, idx)
    scrollToIndex(idx)
    onselect?.(item, idx)
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const i = selectedIndex
    if (i >= 0 && onrowkeydown?.(e, items[i], i)) {
      e.preventDefault()
      return
    }
    let next: number | null = null
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        next = i < 0 ? 0 : i + 1
        break
      case 'ArrowUp':
      case 'k':
        next = i < 0 ? 0 : i - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = items.length - 1
        break
      case 'PageDown':
        next = (i < 0 ? 0 : i) + pageSize
        break
      case 'PageUp':
        next = (i < 0 ? 0 : i) - pageSize
        break
      case 'Enter':
        if (i >= 0) {
          e.preventDefault()
          onactivate?.(items[i], i)
        }
        return
      default:
        return
    }
    e.preventDefault()
    select(next)
  }

  function onrowclick(index: number) {
    select(index)
    focus()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={viewport}
  class="viewport"
  {role}
  aria-label={label}
  aria-activedescendant={selectedIndex >= start && selectedIndex < end ? `${id}-${selectedIndex}` : undefined}
  tabindex="0"
  {onscroll}
  {onkeydown}
>
  {#if items.length === 0}
    {#if empty}{@render empty()}{/if}
  {:else}
    <div class="spacer" style:height="{total}px">
      {#each visible as item, j (getKey(item, start + j))}
        {@const index = start + j}
        {@const isSelected = index === selectedIndex}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id="{id}-{index}"
          class="row"
          class:selected={isSelected}
          role={role === 'tree' ? 'treeitem' : 'option'}
          aria-selected={isSelected}
          aria-posinset={index + 1}
          aria-setsize={items.length}
          style:height="{rowHeight}px"
          style:transform="translateY({index * rowHeight}px)"
          onclick={() => onrowclick(index)}
          ondblclick={() => onactivate?.(item, index)}
          {...rowAttrs?.(item, index)}
        >
          {@render row(item, { index, selected: isSelected })}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    outline: none;
    contain: strict;
  }
  .viewport:focus-visible {
    box-shadow: inset 0 0 0 1px var(--focus);
  }
  .spacer {
    position: relative;
    width: 100%;
  }
  .row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    font-size: var(--fs-sm);
    cursor: default;
    user-select: none;
    contain: layout style;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.selected {
    background: var(--bg-selected);
  }
  .viewport:focus-visible .row.selected {
    background: var(--bg-selected-strong);
    box-shadow: inset 2px 0 0 var(--accent);
  }
</style>
