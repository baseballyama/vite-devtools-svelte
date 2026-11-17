<script lang="ts">
  import { formatMs } from '../../lib/format.js';
  import { FRAME_BUDGET_MS, formatOffset, severity } from '../../lib/performance.js';
  import type { PerfUpdate } from '../../lib/types.js';

  /**
   * One bar per update along the recording: x = when it started, height =
   * how long it took (the dashed line is one 60 Hz frame). A click selects it.
   */
  let {
    updates,
    span,
    selected,
    onselect,
  }: {
    updates: readonly PerfUpdate[];
    /** ms the strip covers (the recording so far). */
    span: number;
    selected: number | null;
    onselect: (id: number) => void;
  } = $props();

  // Twice the frame budget at least, so short updates stay short.
  const top = $derived(updates.reduce((m, u) => Math.max(m, u.duration), FRAME_BUDGET_MS * 2));
  const width = $derived(Math.max(span, 1));
</script>

<div class="strip" role="group" aria-label="Updates over time">
  <div class="budget" style:bottom="{(FRAME_BUDGET_MS / top) * 100}%">
    <span>{FRAME_BUDGET_MS} ms</span>
  </div>
  {#each updates as u (u.id)}
    <button
      type="button"
      class={['bar', severity(u.duration)]}
      class:selected={selected === u.id}
      style:left="{Math.min(99.5, (u.start / width) * 100)}%"
      style:height="{Math.max(4, (u.duration / top) * 100)}%"
      aria-label="Update at {formatOffset(u.start)}, {formatMs(u.duration)}"
      aria-pressed={selected === u.id}
      title="{formatOffset(u.start)} · {formatMs(u.duration)}"
      onclick={() => onselect(u.id)}
    ></button>
  {/each}
</div>

<style>
  .strip {
    position: relative;
    height: 56px;
    margin: 10px 16px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-inset);
    overflow: hidden;
    flex-shrink: 0;
  }
  .budget {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--border-strong);
    pointer-events: none;
  }
  .budget span {
    position: absolute;
    right: 6px;
    bottom: 1px;
    font-size: var(--fs-2xs);
    color: var(--fg-faint);
  }
  .bar {
    position: absolute;
    bottom: 0;
    width: 5px;
    max-height: 100%;
    margin-left: -2px;
    padding: 0;
    border: 0;
    border-radius: 2px 2px 0 0;
    background: var(--fg-faint);
    opacity: 0.55;
    cursor: pointer;
  }
  .bar.slow {
    background: var(--yellow);
    opacity: 1;
  }
  .bar.bad {
    background: var(--red);
    opacity: 1;
  }
  .bar:hover,
  .bar.selected {
    opacity: 1;
    outline: 2px solid var(--fg);
    outline-offset: 1px;
    z-index: 1;
  }
</style>
