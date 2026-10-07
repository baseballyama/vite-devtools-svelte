<script lang="ts">
  import { datasetVersion } from '../lib/versions.js'
  import { getFps, clearFps } from '../lib/rpc.js'
  import type { FpsSample } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import Panel from '../components/Panel.svelte'
  import Button from '../components/Button.svelte'
  import Badge from '../components/Badge.svelte'
  import Segmented from '../components/Segmented.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import LiveControls from '../components/LiveControls.svelte'

  const fps = resource<FpsSample[]>(getFps, { initial: [], interval: 500, version: datasetVersion('fps') })

  const W = 1000
  const H = 200
  const MAX = 120
  let windowSec = $state<'15' | '30' | '60'>('30')
  let recording = $state(false)
  let recordStart = $state(0)
  let recordEnd = $state(0)

  // Anchor the x-axis to the newest sample (not wall-clock) so a paused or
  // throttled stream does not scroll the chart into emptiness.
  const latest = $derived(fps.data.at(-1)?.timestamp ?? Date.now())
  const span = $derived(Number(windowSec) * 1000)
  const visible = $derived(fps.data.filter((s) => s.timestamp >= latest - span))
  const current = $derived(fps.data.at(-1)?.fps ?? 0)

  const x = (t: number) => ((t - (latest - span)) / span) * W
  const y = (f: number) => H - (Math.min(f, MAX) / MAX) * H

  const line = $derived(visible.length > 1 ? 'M' + visible.map((s) => `${x(s.timestamp).toFixed(1)},${y(s.fps).toFixed(1)}`).join('L') : '')
  const area = $derived(line ? `${line}L${x(visible.at(-1)!.timestamp).toFixed(1)},${H}L${x(visible[0].timestamp).toFixed(1)},${H}Z` : '')
  const drops = $derived(visible.filter((s) => s.fps < 30))

  const recorded = $derived.by(() => {
    if (!recordStart) return []
    const end = recording ? Infinity : recordEnd
    return fps.data.filter((s) => s.timestamp >= recordStart && s.timestamp <= end)
  })

  function summarize(src: FpsSample[]) {
    if (!src.length) return null
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let drops = 0
    for (const s of src) {
      min = Math.min(min, s.fps)
      max = Math.max(max, s.fps)
      sum += s.fps
      if (s.fps < 30) drops++
    }
    const sorted = src.map((s) => s.fps).sort((a, b) => a - b)
    return { min, max, avg: Math.round(sum / src.length), p1: sorted[Math.floor(sorted.length * 0.01)], drops, count: src.length }
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
    return f >= 55 ? 'good' : f >= 30 ? 'fair' : 'poor'
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
    <Button icon={recording ? 'stop' : 'record'} variant={recording ? 'primary' : 'default'} onclick={toggleRecord}>
      {recording ? 'Stop recording' : 'Record'}
    </Button>
  {/snippet}
  {#snippet actions()}
    <LiveControls res={fps} onclear={clear} />
  {/snippet}

  {#if fps.data.length === 0}
    {#if fps.loading}
      <EmptyState title="Waiting for frames…" />
    {:else}
      <EmptyState icon="fps" title="No frame samples yet"><p>Keep your app open in a visible tab — it reports its frame rate twice a second.</p></EmptyState>
    {/if}
  {:else}
    <div class="wrap">
      <div class="top">
        <div class="now">
          <span class="big num {tone(current)}">{current}</span>
          <span class="unit">fps</span>
          {#if recording}<Badge tone="red">● REC</Badge>{/if}
        </div>
        {#if stats}
          <dl class="stats">
            <div><dt>Min</dt><dd class="num {tone(stats.min)}">{stats.min}</dd></div>
            <div><dt>1% low</dt><dd class="num {tone(stats.p1)}">{stats.p1}</dd></div>
            <div><dt>Avg</dt><dd class="num {tone(stats.avg)}">{stats.avg}</dd></div>
            <div><dt>Max</dt><dd class="num">{stats.max}</dd></div>
            <div><dt>Drops &lt;30</dt><dd class="num" class:poor={stats.drops > 0}>{stats.drops}</dd></div>
          </dl>
        {/if}
      </div>

      <figure class="chart">
        <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Frame rate over the last {windowSec} seconds">
          <line x1="0" x2={W} y1={y(60)} y2={y(60)} class="grid target" />
          <line x1="0" x2={W} y1={y(30)} y2={y(30)} class="grid warn" />
          {#if region}<rect x={region.x} y="0" width={region.w} height={H} class="region" />{/if}
          {#if area}<path d={area} class="area" />{/if}
          {#if line}<path d={line} class="line" vector-effect="non-scaling-stroke" />{/if}
          {#each drops as d (d.timestamp)}
            <line x1={x(d.timestamp)} x2={x(d.timestamp)} y1={y(d.fps)} y2={H} class="drop" vector-effect="non-scaling-stroke" />
          {/each}
        </svg>
        <span class="label l60" style:top="{(y(60) / H) * 100}%">60</span>
        <span class="label l30" style:top="{(y(30) / H) * 100}%">30</span>
        <figcaption class="axis"><span>−{windowSec}s</span><span>now</span></figcaption>
      </figure>

      {#if recStats && !recording}
        <section class="rec" aria-label="Recording result">
          <h3 class="section-title">Recording · {((recordEnd - recordStart) / 1000).toFixed(1)} s · {recStats.count} samples</h3>
          <dl class="stats">
            <div><dt>Min</dt><dd class="num {tone(recStats.min)}">{recStats.min}</dd></div>
            <div><dt>1% low</dt><dd class="num {tone(recStats.p1)}">{recStats.p1}</dd></div>
            <div><dt>Avg</dt><dd class="num {tone(recStats.avg)}">{recStats.avg}</dd></div>
            <div><dt>Max</dt><dd class="num">{recStats.max}</dd></div>
            <div><dt>Drops &lt;30</dt><dd class="num" class:poor={recStats.drops > 0}>{recStats.drops}</dd></div>
          </dl>
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
  .stats {
    display: flex;
    flex-wrap: wrap;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .stats div {
    padding: 6px 14px;
    border-right: 1px solid var(--border);
  }
  .stats div:last-child {
    border-right: 0;
  }
  .stats dt {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .stats dd {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .good {
    color: var(--green);
  }
  .fair {
    color: var(--yellow);
  }
  .poor {
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
