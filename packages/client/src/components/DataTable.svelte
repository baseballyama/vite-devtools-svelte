<script lang="ts" module>
  export interface Column<T> {
    id: string
    label: string
    /** CSS grid track, e.g. `minmax(0, 1fr)` or `80px`. */
    width: string
    align?: 'start' | 'end'
    /** Comparator; presence makes the column sortable. */
    sort?: (a: T, b: T) => number
    /** Sort descending on first click (numbers usually want this). */
    descFirst?: boolean
    /** Hide below this container width (px) for narrow layouts. */
    minWidth?: number
  }

  export interface SortState {
    id: string
    desc: boolean
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import VirtualList, { type RowState } from './VirtualList.svelte'
  import Icon from './Icon.svelte'

  /**
   * Virtualised, sortable table. Rows are rendered by the caller's `row`
   * snippet as one element per visible column (`visibleColumns` is passed so
   * cells can be skipped in narrow layouts).
   */
  interface Props {
    items: readonly T[]
    columns: Column<T>[]
    getKey: (item: T) => string
    label: string
    row: Snippet<[T, { visible: Set<string>; state: RowState }]>
    sort?: SortState | null
    selected?: string | null
    rowHeight?: number
    empty?: Snippet
    onselect?: (item: T) => void
    onactivate?: (item: T) => void
  }

  let {
    items,
    columns,
    getKey,
    label,
    row: renderRow,
    sort = $bindable(null),
    selected = $bindable(null),
    rowHeight = 28,
    empty,
    onselect,
    onactivate,
  }: Props = $props()

  let width = $state(1000)

  const shown = $derived(columns.filter((c) => !c.minWidth || width >= c.minWidth))
  const visible = $derived(new Set(shown.map((c) => c.id)))
  const template = $derived(shown.map((c) => c.width).join(' '))

  const sorted = $derived.by(() => {
    const col = sort && columns.find((c) => c.id === sort!.id)
    if (!col?.sort) return items
    const cmp = col.sort
    const dir = sort!.desc ? -1 : 1
    return [...items].sort((a, b) => dir * cmp(a, b))
  })

  function toggleSort(col: Column<T>) {
    if (!col.sort) return
    if (sort?.id === col.id) sort = { id: col.id, desc: !sort.desc }
    else sort = { id: col.id, desc: !!col.descFirst }
  }

  function ariaSort(col: Column<T>) {
    if (!col.sort) return undefined
    if (sort?.id !== col.id) return 'none'
    return sort.desc ? 'descending' : 'ascending'
  }
</script>

<div class="table" style:--cols={template} bind:clientWidth={width}>
  <div class="head" role="row">
    {#each shown as col (col.id)}
      <div class="th" class:end={col.align === 'end'} role="columnheader" aria-sort={ariaSort(col)}>
        {#if col.sort}
          <button class="sort" class:active={sort?.id === col.id} onclick={() => toggleSort(col)}>
            <span class="truncate">{col.label}</span>
            {#if sort?.id === col.id}
              <span class="dir" class:desc={sort.desc}><Icon name="chevronDown" size={11} /></span>
            {/if}
          </button>
        {:else}
          <span class="truncate">{col.label}</span>
        {/if}
      </div>
    {/each}
  </div>
  <div class="body">
    <VirtualList
      items={sorted}
      getKey={(item) => getKey(item)}
      bind:selected
      {label}
      {rowHeight}
      {empty}
      onselect={(item) => onselect?.(item)}
      onactivate={(item) => onactivate?.(item)}
    >
      {#snippet row(item, state)}
        <div class="tr">{@render renderRow(item, { visible, state })}</div>
      {/snippet}
    </VirtualList>
  </div>
</div>

<style>
  .table {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .head,
  .tr {
    display: grid;
    grid-template-columns: var(--cols);
    column-gap: 12px;
    align-items: center;
    width: 100%;
    min-width: 0;
  }
  .head {
    flex-shrink: 0;
    height: 28px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--fg-faint);
  }
  .th {
    display: flex;
    min-width: 0;
  }
  .th.end {
    justify-content: flex-end;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 2px 4px;
    margin: 0 -4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-weight: inherit;
  }
  .sort:hover,
  .sort.active {
    color: var(--fg);
  }
  .dir {
    display: inline-flex;
    transform: rotate(180deg);
  }
  .dir.desc {
    transform: none;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .tr :global(> *) {
    min-width: 0;
  }
  .tr :global(.end) {
    text-align: right;
    justify-self: end;
  }
</style>
