<script lang="ts" generics="T extends Record<string, unknown>">
  import type { Snippet } from 'svelte'

  import DataTable from '../components/DataTable.svelte'
  import type { Column, SortState, TableRowState } from '../components/types.js'

  /** `<DataTable>` whose rows print the cells of the visible columns, `|`-joined. */
  interface Props {
    items: readonly T[]
    columns: Column<T>[]
    getKey: (item: T) => string
    label: string
    sort?: SortState | null
    selected?: string | null
    empty?: Snippet
    onselect?: (item: T) => void
    onactivate?: (item: T) => void
  }

  let { columns, ...rest }: Props = $props()

  function cells(item: T, visible: Set<string>): string {
    return columns
      .filter(c => visible.has(c.id))
      .map(c => String(item[c.id]))
      .join('|')
  }
</script>

<DataTable {columns} {...rest}>
  {#snippet row(item: T, s: TableRowState)}
    <span>{cells(item, s.visible)}</span>
  {/snippet}
</DataTable>
