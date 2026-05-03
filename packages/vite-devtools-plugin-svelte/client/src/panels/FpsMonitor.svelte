<script lang="ts">
  import { onMount } from 'svelte'
  import { getFps, clearFps } from '../lib/rpc.js'
  import type { FpsSample } from '../lib/types.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import ActionButton from '../components/ActionButton.svelte'
  import Badge from '../components/Badge.svelte'

  let samples = $state<FpsSample[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let recording = $state(false)
  let recordStart = $state(0)
  let recordEnd = $state(0)

  // The visible window: last N seconds
  const VISIBLE_SECONDS = 30
  const CHART_W = 800
  const CHART_H = 180
  const TARGET_FPS = 60

  const currentFps = $derived(samples.length > 0 ? samples[samples.length - 1].fps : 0)

  const visibleSamples = $derived.by(() => {
    const cutoff = Date.now() - VISIBLE_SECONDS * 1000
    return samples.filter(s => s.timestamp >= cutoff)
  })

  const recordedSamples = $derived.by(() => {
    if (!recording && recordEnd === 0) return []
    const start = recordStart
    const end = recording ? Date.now() : recordEnd
    return samples.filter(s => s.timestamp >= start && s.timestamp <= end)
  })

  const stats = $derived.by(() => {
    const src = recordedSamples.length > 0 ? recordedSamples : visibleSamples
    if (src.length === 0) return { min: 0, max: 0, avg: 0, drops: 0 }
    let min = Infinity, max = -Infinity, sum = 0, drops = 0
    for (const s of src) {
      if (s.fps < min) min = s.fps
      if (s.fps > max) max = s.fps
      sum += s.fps
      if (s.fps < 30) drops++
    }
    return { min, max, avg: Math.round(sum / src.length), drops }
  })

  function fpsColor(fps: number): string {
    if (fps >= 55) return 'var(--color-success)'
    if (fps >= 30) return 'var(--color-warning-text)'
    return 'var(--color-error)'
  }

  function fpsVariant(fps: number): 'success' | 'warning' | 'error' {
    if (fps >= 55) return 'success'
    if (fps >= 30) return 'warning'
    return 'error'
  }

  // SVG chart path
  const chartPath = $derived.by(() => {
    const src = visibleSamples
    if (src.length < 2) return ''
    const now = Date.now()
    const startTime = now - VISIBLE_SECONDS * 1000
    const points = src.map(s => {
      const x = ((s.timestamp - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W
      const y = CHART_H - Math.min(s.fps, 120) / 120 * CHART_H
      return `${x},${y}`
    })
    return `M ${points.join(' L ')}`
  })

  // Area fill path (same as line but closed at bottom)
  const chartArea = $derived.by(() => {
    const src = visibleSamples
    if (src.length < 2) return ''
    const now = Date.now()
    const startTime = now - VISIBLE_SECONDS * 1000
    const points = src.map(s => {
      const x = ((s.timestamp - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W
      const y = CHART_H - Math.min(s.fps, 120) / 120 * CHART_H
      return `${x},${y}`
    })
    const firstX = ((src[0].timestamp - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W
    const lastX = ((src[src.length - 1].timestamp - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W
    return `M ${firstX},${CHART_H} L ${points.join(' L ')} L ${lastX},${CHART_H} Z`
  })

  // Recording region overlay
  const recordRegion = $derived.by(() => {
    if (recordStart === 0) return null
    const now = Date.now()
    const startTime = now - VISIBLE_SECONDS * 1000
    const end = recording ? now : recordEnd
    const x1 = Math.max(0, ((recordStart - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W)
    const x2 = Math.min(CHART_W, ((end - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W)
    if (x2 <= 0 || x1 >= CHART_W) return null
    return { x: x1, w: x2 - x1 }
  })

  // Drop markers (fps < 30)
  const dropMarkers = $derived.by(() => {
    const now = Date.now()
    const startTime = now - VISIBLE_SECONDS * 1000
    return visibleSamples
      .filter(s => s.fps < 30)
      .map(s => ({
        x: ((s.timestamp - startTime) / (VISIBLE_SECONDS * 1000)) * CHART_W,
        fps: s.fps,
      }))
  })

  async function refresh() {
    try { samples = await getFps() } catch { /* ignore */ }
  }

  function startRecording() {
    recording = true
    recordStart = Date.now()
    recordEnd = 0
  }

  function stopRecording() {
    recording = false
    recordEnd = Date.now()
  }

  async function clear() {
    await clearFps()
    samples = []
    recording = false
    recordStart = 0
    recordEnd = 0
  }

  onMount(() => {
    refresh()
    pollTimer = setInterval(refresh, 500)
    return () => { if (pollTimer) clearInterval(pollTimer) }
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>FPS Monitor</h2>
    <div class="actions">
      {#if recording}
        <ActionButton onclick={stopRecording}>Stop Recording</ActionButton>
      {:else}
        <ActionButton onclick={startRecording}>Record</ActionButton>
      {/if}
      <ActionButton onclick={clear}>Clear</ActionButton>
    </div>
  </div>

  <div class="fps-current">
    <span class="fps-number" style="color: {fpsColor(currentFps)}">{currentFps}</span>
    <span class="fps-unit">FPS</span>
    {#if recording}
      <Badge variant="error">REC</Badge>
    {/if}
  </div>

  <div class="stats-row">
    <div class="stat">
      <span class="stat-label">Min</span>
      <span class="stat-value" style="color: {fpsColor(stats.min)}">{stats.min}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Avg</span>
      <span class="stat-value" style="color: {fpsColor(stats.avg)}">{stats.avg}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Max</span>
      <span class="stat-value" style="color: {fpsColor(stats.max)}">{stats.max}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Drops</span>
      <Badge variant={stats.drops > 0 ? 'error' : 'success'}>{stats.drops}</Badge>
    </div>
  </div>

  <div class="chart-container">
    <svg viewBox="0 0 {CHART_W} {CHART_H}" preserveAspectRatio="none" class="chart">
      <!-- Grid lines -->
      <line x1="0" y1={CHART_H - 60 / 120 * CHART_H} x2={CHART_W} y2={CHART_H - 60 / 120 * CHART_H} class="grid-line target" />
      <line x1="0" y1={CHART_H - 30 / 120 * CHART_H} x2={CHART_W} y2={CHART_H - 30 / 120 * CHART_H} class="grid-line warn" />

      <!-- Recording region -->
      {#if recordRegion}
        <rect x={recordRegion.x} y="0" width={recordRegion.w} height={CHART_H} class="record-region" />
      {/if}

      <!-- Area fill -->
      {#if chartArea}
        <path d={chartArea} class="chart-area" />
      {/if}

      <!-- Line -->
      {#if chartPath}
        <path d={chartPath} class="chart-line" />
      {/if}

      <!-- Drop markers -->
      {#each dropMarkers as drop}
        <circle cx={drop.x} cy={CHART_H - drop.fps / 120 * CHART_H} r="3" class="drop-marker" />
      {/each}
    </svg>

    <!-- Labels -->
    <div class="chart-labels">
      <span class="chart-label target">60</span>
      <span class="chart-label warn">30</span>
    </div>
  </div>

  {#if recordedSamples.length > 0 && !recording}
    <Card title="Recording Result">
      <div class="record-stats">
        <span>Duration: {((recordEnd - recordStart) / 1000).toFixed(1)}s</span>
        <span>Samples: {recordedSamples.length}</span>
        <span>Min: <strong style="color: {fpsColor(stats.min)}">{stats.min}</strong></span>
        <span>Avg: <strong style="color: {fpsColor(stats.avg)}">{stats.avg}</strong></span>
        <span>Max: <strong style="color: {fpsColor(stats.max)}">{stats.max}</strong></span>
        {#if stats.drops > 0}
          <Badge variant="error">{stats.drops} drops below 30fps</Badge>
        {:else}
          <Badge variant="success">No drops</Badge>
        {/if}
      </div>
    </Card>
  {/if}
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  h2 { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); margin: 0; }
  .actions { display: flex; gap: var(--space-2); }

  .fps-current {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .fps-number {
    font-size: 48px;
    font-weight: 700;
    font-family: var(--font-mono);
    line-height: 1;
  }
  .fps-unit {
    font-size: var(--text-lg);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .stats-row {
    display: flex;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .stat-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-weight: 500;
  }
  .stat-value {
    font-size: var(--text-lg);
    font-weight: 700;
    font-family: var(--font-mono);
  }

  .chart-container {
    position: relative;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-base);
    overflow: hidden;
  }
  .chart {
    display: block;
    width: 100%;
    height: 180px;
  }
  .grid-line {
    stroke-width: 1;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .grid-line.target { stroke: var(--color-success); opacity: 0.45; }
  .grid-line.warn { stroke: var(--color-error); opacity: 0.45; }

  .record-region {
    fill: var(--color-error-bg);
  }

  .chart-area {
    fill: var(--color-info-bg);
  }
  .chart-line {
    fill: none;
    stroke: var(--color-accent-400);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .drop-marker {
    fill: var(--color-error);
    vector-effect: non-scaling-stroke;
  }

  .chart-labels {
    position: absolute;
    top: 0;
    right: 8px;
    bottom: 0;
    display: flex;
    flex-direction: column;
    pointer-events: none;
  }
  .chart-label {
    position: absolute;
    right: 0;
    font-size: 10px;
    font-family: var(--font-mono);
    transform: translateY(-50%);
  }
  .chart-label.target {
    top: calc(100% - 60 / 120 * 100%);
    color: var(--color-success);
  }
  .chart-label.warn {
    top: calc(100% - 30 / 120 * 100%);
    color: var(--color-error);
  }

  .record-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    align-items: center;
  }
  .record-stats strong { font-family: var(--font-mono); }
</style>
