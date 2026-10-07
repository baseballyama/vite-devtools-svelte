<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import Panel from '../components/Panel.svelte'
  import ResourceEmpty from '../components/ResourceEmpty.svelte'
  import Segmented from '../components/Segmented.svelte'
  import StatList from '../components/StatList.svelte'
  import type { Stat } from '../components/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getFps, clearFps } from '../lib/rpc.js'
  import type { FpsSample } from '../lib/types.js'
  import { datasetVersion } from '../lib/versions.js'

  const fps = resource<FpsSample[]>(getFps, {
    initial: [],
    interval: 500,
    version: datasetVersion('fps'),
  })

  const W = 1000
  const H = 200
  const MAX = 120
  /** Below this a frame rate counts as a drop. */
  const DROP = 30
  let windowSec = $state<'15' | '30' | '60'>('30')
  let recording = $state(false)
  let recordStart = $state(0)
  let recordEnd = $state(0)

  // Anchor the x-axis to the newest sample (not wall-clock) so a paused or
  // throttled stream does not scroll the chart into emptiness.
  const latest = $derived(fps.data.at(-1)?.timestamp ?? Date.now())
  const span = $derived(Number(windowSec) * 1000)
  const visible = $derived(fps.data.filter(s => s.timestamp >= latest - span))
  const current = $derived(fps.data.at(-1)?.fps ?? 0)

  const x = (t: number) => ((t - (latest - span)) / span) * W
  const y = (f: number) => H - (Math.min(f, MAX) / MAX) * H

  const line = $derived(
    visible.length > 1
      ? 'M' + visible.map(s => `${x(s.timestamp).toFixed(1)},${y(s.fps).toFixed(1)}`).join('L')
      : '',
  )
  const area = $derived(
    line
      ? `${line}L${x(visible.at(-1)!.timestamp).toFixed(1)},${H}L${x(visible[0]!.timestamp).toFixed(1)},${H}Z`
      : '',
  )
  const drops = $derived(visible.filter(s => s.fps < DROP))

  const recorded = $derived.by(() => {
    if (!recordStart) return []
    const end = recording ? Infinity : recordEnd
    return fps.data.filter(s => s.timestamp >= recordStart && s.timestamp <= end)
  })

  function summarize(src: FpsSample[]): { count: number; items: Stat[] } | null {
    if (!src.length) return null
    const sorted = src.map(s => s.fps).sort((a, b) => a - b)
    const min = sorted[0]!
    const p1 = sorted[Math.floor(sorted.length * 0.01)]!
    const avg = Math.round(sorted.reduce((sum, f) => sum + f, 0) / sorted.length)
    const drops = sorted.filter(f => f < DROP).length
    return {
      count: sorted.length,
      items: [
        { label: 'Min', value: min, tone: tone(min) },
        { label: '1% low', value: p1, tone: tone(p1) },
        { label: 'Avg', value: avg, tone: tone(avg) },
        { label: 'Max', value: sorted.at(-1)! },
        { label: `Drops <${DROP}`, value: drops, tone: drops > 0 ? 'red' : null },
      ],
    }
  }

  const stats = $derived(summarize(visible))
  const recStats = $derived(summarize(recorded))
  const region = $derived.by(() => {
    if (!recordStart) return null
    const x1 = Math.max(0, x(recordStart))
    const x2 = Math.min(W, recording ? W : x(recordEnd))
    return x2 > x1 ? { x: x1, w: x2 - x1 } : null
  })

  function tone(f: number) {
    return f >= 55 ? 'green' : f >= DROP ? 'yellow' : 'red'
  }

  function toggleRecord() {
    if (recording) {
      recording = false
      recordEnd = latest
    } else {
      recording = true
      recordStart = latest
      recordEnd = 0
    }
  }

  async function clear() {
    await clearFps().catch(() => {})
    fps.set([])
    recording = false
    recordStart = recordEnd = 0
  }
</script>

<Panel title="Frame rate" scroll>
  {#snippet toolbar()}
    <Segmented
      label="Time window"
      bind:value={windowSec}
      options={[
        { value: '15', label: '15 s' },
        { value: '30', label: '30 s' },
        { value: '60', label: '60 s' },
      ]}
    />
    <Button
      icon={recording ? 'stop' : 'record'}
      variant={recording ? 'primary' : 'default'}
      onclick={toggleRecord}
    >
      {recording ? 'Stop recording' : 'Record'}
    </Button>
  {/snippet}
  {#snippet actions()}
    <LiveControls res={fps} onclear={clear} />
  {/snippet}

  {#if fps.data.length === 0}
    <ResourceEmpty
      res={fps}
      total={0}
      loading="Waiting for frames…"
      failed="Could not load frame samples"
      icon="fps"
      title="No frame samples yet"
    >
      <p>Keep your app open in a visible tab — it reports its frame rate twice a second.</p>
    </ResourceEmpty>
  {:else}
    <div class="wrap">
      <div class="top">
        <div class="now">
          <span class="big num {tone(current)}">{current}</span>
          <span class="unit">fps</span>
          {#if recording}<Badge tone="red">● REC</Badge>{/if}
        </div>
        {#if stats}<StatList items={stats.items} variant="box" />{/if}
      </div>

      <figure class="chart">
        <svg
          viewBox="0 0 {W} {H}"
          preserveAspectRatio="none"
          role="img"
          aria-label="Frame rate over the last {windowSec} seconds"
        >
          <line x1="0" x2={W} y1={y(60)} y2={y(60)} class="grid target" />
          <line x1="0" x2={W} y1={y(DROP)} y2={y(DROP)} class="grid warn" />
          {#if region}<rect x={region.x} y="0" width={region.w} height={H} class="region" />{/if}
          {#if area}<path d={area} class="area" />{/if}
          {#if line}<path d={line} class="line" vector-effect="non-scaling-stroke" />{/if}
          <!-- By position: two tabs of the app can report in the same millisecond. -->
          {#each drops as d, i (i)}
            <line
              x1={x(d.timestamp)}
              x2={x(d.timestamp)}
              y1={y(d.fps)}
              y2={H}
              class="drop"
              vector-effect="non-scaling-stroke"
            />
          {/each}
        </svg>
        <span class="label l60" style:top="{(y(60) / H) * 100}%">60</span>
        <span class="label l30" style:top="{(y(DROP) / H) * 100}%">{DROP}</span>
        <figcaption class="axis"><span>−{windowSec}s</span><span>now</span></figcaption>
      </figure>

      {#if recStats && !recording}
        <section class="rec" aria-label="Recording result">
          <h3 class="section-title">
            Recording · {((recordEnd - recordStart) / 1000).toFixed(1)} s · {recStats.count} samples
          </h3>
          <StatList items={recStats.items} variant="box" />
        </section>
      {/if}
    </div>
  {/if}
</Panel>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px 32px;
  }
  .now {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .big {
    font-size: 44px;
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .unit {
    color: var(--fg-muted);
    margin-right: 8px;
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
  .chart {
    position: relative;
    margin: 0;
    height: 220px;
    padding: 0 0 18px 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-subtle);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .grid {
    stroke-dasharray: 4 4;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .target {
    stroke: color-mix(in srgb, var(--green) 45%, transparent);
  }
  .warn {
    stroke: color-mix(in srgb, var(--red) 45%, transparent);
  }
  .area {
    fill: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.75;
    stroke-linejoin: round;
  }
  .drop {
    stroke: var(--red);
    stroke-width: 1;
    opacity: 0.6;
  }
  .region {
    fill: var(--red-bg);
  }
  .label {
    position: absolute;
    left: 6px;
    transform: translateY(-50%);
    font-size: var(--fs-2xs);
    color: var(--fg-faint);
    font-family: var(--font-mono);
  }
  .axis {
    position: absolute;
    left: 24px;
    right: 8px;
    bottom: 2px;
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-2xs);
    color: var(--fg-faint);
  }
  .rec .section-title {
    padding-left: 0;
  }
</style>
