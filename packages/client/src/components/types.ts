/**
 * Types shared by the generic components and their callers.
 *
 * They live in a plain module (not a component's `<script module>`) so every
 * consumer — including tooling that cannot resolve `.svelte` imports, like the
 * type-aware linter — sees the real types. Component instance shapes
 * (`bind:this`) are spelled out as interfaces for the same reason; svelte-check
 * verifies each component still satisfies its interface.
 */
import type { IconName } from '../lib/icons.js'

/** Colour of a `<Badge>`. */
export type Tone = 'neutral' | 'accent' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'cyan'

/** One `<DataTable>` column. */
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

/** `<DataTable>` sort order (bindable). */
export interface SortState {
  id: string
  desc: boolean
}

/** Per-row state passed to a `<VirtualList>` row snippet. */
export interface RowState {
  index: number
  selected: boolean
}

/** Second argument of a `<DataTable>` row snippet. */
export interface TableRowState {
  /** Ids of the columns shown at the current width. */
  visible: Set<string>
  state: RowState
}

/** A `<CommandPalette>` entry. */
export interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: IconName
  keywords?: string
  run: () => void
}

/** Methods a `<VirtualList>` instance exposes (`bind:this`). */
export interface VirtualListApi {
  scrollToIndex(i: number, align?: 'auto' | 'center'): void
  focus(): void
  select(i: number): void
}

/** Methods a `<TreeView>` instance exposes (`bind:this`). */
export interface TreeViewApi {
  /** Reveal (expand ancestors) and select a node by key. */
  reveal(key: string, ancestors: string[]): void
  focus(): void
}

/** Methods a `<CodePane>` instance exposes (`bind:this`). */
export interface CodePaneApi {
  scrollToLine(line: number): void
}
