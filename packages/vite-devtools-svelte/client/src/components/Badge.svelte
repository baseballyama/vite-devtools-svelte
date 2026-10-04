<script lang="ts" module>
  export type Tone = 'neutral' | 'accent' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'cyan'
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    tone = 'neutral',
    title,
    children,
  }: { tone?: Tone; title?: string; children: Snippet } = $props()
</script>

<span class="badge {tone}" {title}>{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 17px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .neutral {
    background: var(--bg-active);
    color: var(--fg-muted);
  }
  .accent {
    background: var(--bg-selected);
    color: var(--accent-fg);
  }
  .green {
    background: var(--green-bg);
    color: var(--green);
  }
  .yellow {
    background: var(--yellow-bg);
    color: var(--yellow);
  }
  .red {
    background: var(--red-bg);
    color: var(--red);
  }
  .blue {
    background: var(--blue-bg);
    color: var(--blue);
  }
  .purple {
    background: var(--purple-bg);
    color: var(--purple);
  }
  .cyan {
    background: var(--cyan-bg);
    color: var(--cyan);
  }
</style>
