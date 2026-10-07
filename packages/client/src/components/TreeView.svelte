<script lang="ts" generics="N">
  import type { Snippet } from 'svelte'

  import { flattenTree, type TreeRow } from '../lib/tree.js'
  import Icon from './Icon.svelte'
  import type { VirtualListApi } from './types.js'
  import VirtualList from './VirtualList.svelte'

  /**
   * Virtualised ARIA tree. Expansion state is a key Set owned by the caller
   * (bindable) so it survives data refreshes; while `filter` is set, matching
   * branches are shown expanded regardless of that state.
   */
  interface Props {
    roots: readonly N[]
    getKey: (n: N) => string
    getChildren: (n: N) => readonly N[]
    label: string
    row: Snippet<[N, TreeRow<N>]>
    expanded?: Set<string>
    selected?: string | null
    filter?: ((n: N) => boolean) | null
    rowHeight?: number
    empty?: Snippet
    onselect?: (n: N) => void
    onactivate?: (n: N) => void
  }

  let {
    roots,
    getKey,
    getChildren,
    label,
    row: renderRow,
    expanded = $bindable(new Set()),
    selected = $bindable(null),
    filter = null,
    rowHeight = 26,
    empty,
    onselect,
    onactivate,
  }: Props = $props()

  let list = $state<VirtualListApi | null>(null)

  const rows = $derived(
    flattenTree(roots, { key: getKey, children: getChildren }, expanded, filter),
  )

  // `expanded` is replaced, never mutated: the caller owns it (bindable) and
  // reacts to the new reference.
  function toggle(key: string, open?: boolean) {
    expanded =
      (open ?? !expanded.has(key))
        ? new Set([...expanded, key])
        : new Set([...expanded].filter(k => k !== key))
  }

  function indexOfKey(key: string) {
    return rows.findIndex(r => r.key === key)
  }

  /** Reveal (expand ancestors) and select a node by key. */
  export function reveal(key: string, ancestors: string[]) {
    if (ancestors.length > 0) expanded = new Set([...expanded, ...ancestors])
    selected = key
    queueMicrotask(() => list?.scrollToIndex(indexOfKey(key), 'center'))
  }

  export function focus() {
    list?.focus()
  }

  function onrowkeydown(e: KeyboardEvent, r: TreeRow<N>) {
    if (e.key === 'ArrowRight' || e.key === 'l') {
      if (r.hasChildren && !r.expanded) toggle(r.key, true)
      else if (r.expanded) list?.select(indexOfKey(r.key) + 1)
      return true
    }
    if (e.key === 'ArrowLeft' || e.key === 'h') {
      if (r.expanded && !filter) toggle(r.key, false)
      else if (r.parentKey != null) list?.select(indexOfKey(r.parentKey))
      return true
    }
    if (e.key === ' ' && r.hasChildren) {
      toggle(r.key)
      return true
    }
    return false
  }
</script>

<VirtualList
  bind:this={list}
  bind:selected
  items={rows}
  getKey={(r: TreeRow<N>) => r.key}
  role="tree"
  {label}
  {rowHeight}
  {empty}
  onselect={(r: TreeRow<N>) => onselect?.(r.node)}
  onactivate={(r: TreeRow<N>) => onactivate?.(r.node)}
  {onrowkeydown}
  rowAttrs={(r: TreeRow<N>) => ({
    'aria-level': r.depth + 1,
    'aria-posinset': r.posinset,
    'aria-setsize': r.setsize,
    'aria-expanded': r.hasChildren ? r.expanded : undefined,
  })}
>
  {#snippet row(r: TreeRow<N>)}
    <span class="indent" style:width="{r.depth * 14}px" aria-hidden="true"></span>
    {#if r.hasChildren}
      <button
        type="button"
        class="twisty"
        class:open={r.expanded}
        tabindex="-1"
        aria-hidden="true"
        onclick={e => {
          e.stopPropagation()
          if (!filter) toggle(r.key)
        }}
      >
        <Icon name="chevron" size={12} />
      </button>
    {:else}
      <span class="twisty-spacer" aria-hidden="true"></span>
    {/if}
    {@render renderRow(r.node, r)}
  {/snippet}
</VirtualList>

<style>
  .indent {
    flex-shrink: 0;
    align-self: stretch;
    margin-left: -4px;
    background-image: repeating-linear-gradient(
      to right,
      transparent 0 6px,
      var(--border) 6px 7px,
      transparent 7px 14px
    );
  }
  .twisty,
  .twisty-spacer {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-right: -4px;
  }
  .twisty {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg-faint);
    transition: transform var(--dur-fast) var(--ease);
  }
  .twisty:hover {
    color: var(--fg);
    background: var(--bg-active);
  }
  .twisty.open {
    transform: rotate(90deg);
  }
</style>
