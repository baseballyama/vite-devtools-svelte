// A plain module, not `<script module>`, so tooling that cannot resolve
// `.svelte` imports (the type-aware linter) sees the real types. Instance shapes
// (`bind:this`) are interfaces for the same reason; svelte-check verifies them.
import type { IconName } from '../lib/icons.js';

export type Tone = 'neutral' | 'accent' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'cyan';

export interface Stat {
  label: string;
  value: string | number;
  tone?: 'green' | 'yellow' | 'red' | null;
}

export interface Column<T> {
  id: string;
  label: string;
  /** CSS grid track, e.g. `minmax(0, 1fr)` or `80px`. */
  width: string;
  align?: 'start' | 'end';
  /** Presence makes the column sortable. */
  sort?: (a: T, b: T) => number;
  /** Sort descending on first click (numbers usually want this). */
  descFirst?: boolean;
  /** Hide below this container width (px) for narrow layouts. */
  minWidth?: number;
}

export interface SortState {
  id: string;
  desc: boolean;
}

export interface RowState {
  index: number;
  selected: boolean;
}

export interface TableRowState {
  /** Ids of the columns shown at the current width. */
  visible: Set<string>;
  state: RowState;
}

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: IconName;
  keywords?: string;
  run: () => void;
}

export interface VirtualListApi {
  scrollToIndex(i: number, align?: 'auto' | 'center'): void;
  focus(): void;
  select(i: number): void;
}

export interface TreeViewApi {
  reveal(key: string, ancestors: string[]): void;
  focus(): void;
}
