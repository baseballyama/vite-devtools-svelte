<script lang="ts">
  import type { Snippet } from 'svelte'

  import { persisted } from '../lib/persisted.svelte.js'

  /**
   * Main content + resizable side pane. Side-by-side when wide; stacks the
   * side pane below the main content in narrow containers (the DevTools dock
   * is often a short, wide strip or a tall, thin column).
   */
  interface Props {
    id: string
    /** Whether the side pane is shown. */
    open?: boolean
    initial?: number
    min?: number
    /** Container width below which the layout stacks vertically. */
    stackBelow?: number
    /** Put the side pane on the left (navigation lists) instead of the right. */
    side?: 'start' | 'end'
    children: Snippet
    aside: Snippet
  }

  let {
    id,
    open = true,
    initial = 360,
    min = 220,
    stackBelow = 760,
    side = 'end',
    children,
    aside,
  }: Props = $props()

  // svelte-ignore state_referenced_locally
  const size = persisted(`split:${id}`, initial)
  let width = $state(0)
  let height = $state(0)
  let dragging = $state(false)

  const stacked = $derived(width > 0 && width < stackBelow)
  const limit = $derived(stacked ? height : width)
  const clamped = $derived(Math.max(min, Math.min(size.value, Math.max(min, limit - min))))

  function startDrag(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    dragging = true
    const origin = stacked ? e.clientY : e.clientX
    const startSize = clamped
    const dir = stacked || side === 'end' ? -1 : 1
    const move = (ev: PointerEvent) => {
      const delta = (stacked ? ev.clientY : ev.clientX) - origin
      size.value = Math.round(startSize + dir * delta)
    }
    const up = () => {
      dragging = false
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      size.value = clamped
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function onkeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16
    const grow = side === 'end' || stacked ? ['ArrowLeft', 'ArrowUp'] : ['ArrowRight', 'ArrowDown']
    const shrink =
      side === 'end' || stacked ? ['ArrowRight', 'ArrowDown'] : ['ArrowLeft', 'ArrowUp']
    if (grow.includes(e.key)) size.value = clamped + step
    else if (shrink.includes(e.key)) size.value = clamped - step
    else return
    e.preventDefault()
  }
</script>

<div
  class="split"
  class:stacked
  class:start={side === 'start'}
  class:dragging
  bind:clientWidth={width}
  bind:clientHeight={height}
  style:--side="{clamped}px"
>
  <div class="main">{@render children()}</div>
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="handle"
      role="separator"
      aria-orientation={stacked ? 'horizontal' : 'vertical'}
      aria-valuenow={clamped}
      aria-valuemin={min}
      aria-label="Resize panel"
      tabindex="0"
      onpointerdown={startDrag}
      {onkeydown}
    ></div>
    <div class="aside">{@render aside()}</div>
  {/if}
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto var(--side);
    grid-template-areas: 'main handle aside';
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .split.start {
    grid-template-columns: var(--side) auto minmax(0, 1fr);
    grid-template-areas: 'aside handle main';
  }
  .split:not(:has(.aside)) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'main';
  }
  .split.stacked {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto min(var(--side), 60%);
    grid-template-areas: 'main' 'handle' 'aside';
  }
  .split.stacked.start {
    grid-template-rows: min(var(--side), 45%) auto minmax(0, 1fr);
    grid-template-areas: 'aside' 'handle' 'main';
  }
  .split.stacked:not(:has(.aside)) {
    grid-template-rows: minmax(0, 1fr);
  }
  .main {
    grid-area: main;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .aside {
    grid-area: aside;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-subtle);
  }
  .handle {
    grid-area: handle;
    position: relative;
    width: 1px;
    background: var(--border);
    cursor: col-resize;
    touch-action: none;
    outline: none;
  }
  .handle::after {
    content: '';
    position: absolute;
    inset: 0 -4px;
    z-index: 2;
  }
  .stacked .handle {
    width: auto;
    height: 1px;
    cursor: row-resize;
  }
  .stacked .handle::after {
    inset: -4px 0;
  }
  .handle:hover,
  .handle:focus-visible,
  .dragging .handle {
    background: var(--accent);
  }
  .dragging {
    user-select: none;
    cursor: col-resize;
  }
  .dragging.stacked {
    cursor: row-resize;
  }
</style>
