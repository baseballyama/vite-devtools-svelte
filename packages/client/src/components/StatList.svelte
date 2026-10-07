<script lang="ts">
  import type { Stat } from './types.js'

  /**
   * Labelled figures as a `<dl>`: a framed row (`box`), a full-width row
   * under a header (`strip`) or tiles that wrap (`grid`, for inspectors).
   */
  let { items, variant }: { items: Stat[]; variant: 'box' | 'strip' | 'grid' } = $props()
</script>

<dl class="stats {variant}">
  {#each items as s (s.label)}
    <div>
      <dt>{s.label}</dt>
      <dd class="num {s.tone ?? ''}">{s.value}</dd>
    </div>
  {/each}
</dl>

<style>
  .stats {
    display: flex;
    flex-wrap: wrap;
    margin: 0;
  }
  .box,
  .grid {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .strip {
    border-bottom: 1px solid var(--border);
  }
  .box div,
  .strip div {
    border-right: 1px solid var(--border);
  }
  .box div {
    padding: 6px 14px;
  }
  .box div:last-child {
    border-right: 0;
  }
  .strip div {
    padding: 8px 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 1px;
    margin: 12px 14px 0;
    background: var(--border);
  }
  .grid div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    background: var(--bg-subtle);
  }
  dt {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  dd {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .green {
    color: var(--green);
  }
  .yellow {
    color: var(--yellow);
  }
  .red {
    color: var(--red);
  }
</style>
