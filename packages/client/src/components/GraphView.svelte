<script lang="ts">
  import { formatValue } from '../lib/format.js'
  import { layoutGraph, NODE_H, NODE_W, propagate, shortFile } from '../lib/graph-layout.js'
  import type { ReactiveNode, ReactiveEdge } from '../lib/types.js'

  interface Props {
    nodes: ReactiveNode[]
    edges: ReactiveEdge[]
    onSelectNode?: (node: ReactiveNode | null) => void
    changedNodeIds?: Set<string>
    /** Selected node id, bindable so lists and the graph stay in sync. */
    selectedNodeId?: string | null
  }

  let {
    nodes,
    edges,
    onSelectNode,
    changedNodeIds = new Set(),
    selectedNodeId = $bindable(null),
  }: Props = $props()

  // --- viewBox-based pan & zoom (always sharp, no CSS transform) ---
  // viewBox = (vbX, vbY, vbW, vbH)
  // zoom controls vbW/vbH (smaller = zoomed in), pan controls vbX/vbY
  let vbX = $state(0)
  let vbY = $state(0)
  let vbW = $state(800)
  let vbH = $state(400)
  let dragging = $state(false)
  let dragStartX = 0
  let dragStartY = 0
  let vbStartX = 0
  let vbStartY = 0
  let containerEl = $state<HTMLDivElement | null>(null)

  const ZOOM_FACTOR = 1.2
  const ZOOM_MIN_VB = 100 // minimum viewBox dimension (max zoom in)
  const ZOOM_MAX_VB = 8000 // maximum viewBox dimension (max zoom out)

  // Zoom percentage for display (relative to fit-to-view state)
  let fitVbW = $state(800)
  const zoomPercent = $derived(Math.round((fitVbW / vbW) * 100))

  let hasManuallyZoomed = false

  function zoomIn() {
    hasManuallyZoomed = true
    applyZoom(1 / ZOOM_FACTOR, vbX + vbW / 2, vbY + vbH / 2)
  }
  function zoomOut() {
    hasManuallyZoomed = true
    applyZoom(ZOOM_FACTOR, vbX + vbW / 2, vbY + vbH / 2)
  }
  function zoomReset() {
    hasManuallyZoomed = false
    fitToView()
  }

  function applyZoom(factor: number, cx: number, cy: number) {
    const newW = Math.min(ZOOM_MAX_VB, Math.max(ZOOM_MIN_VB, vbW * factor))
    const newH = Math.min(ZOOM_MAX_VB, Math.max(ZOOM_MIN_VB, vbH * factor))
    const ratio = newW / vbW
    // Keep the point (cx, cy) in the same screen position
    vbX = cx - (cx - vbX) * ratio
    vbY = cy - (cy - vbY) * ratio
    vbW = newW
    vbH = newH
  }

  function fitToView() {
    if (!containerEl || layout.width === 0) return
    const rect = containerEl.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      // Container hasn't laid out yet — try again on the next frame.
      requestAnimationFrame(() => fitToView())
      return
    }
    const aspect = rect.width / rect.height
    // Add breathing room around the graph so nodes don't kiss the edges.
    const PAD = NODE_W * 0.5
    const graphW = Math.max(layout.width, 200) + PAD * 2
    const graphH = Math.max(layout.height, 100) + PAD * 2
    const graphAspect = graphW / graphH

    let targetW: number
    let targetH: number
    if (graphAspect > aspect) {
      targetW = graphW
      targetH = graphW / aspect
    } else {
      targetH = graphH
      targetW = graphH * aspect
    }

    // Don't zoom out so far that nodes become illegible. Cap the viewBox
    // so the rendered scale never drops below ~70% of native — a NODE_W=160
    // box stays at >= ~110px on screen, where the 11px label inside is
    // still readable. If the graph is genuinely larger than that fits,
    // the user gets scroll/pan instead of an unreadable thumbnail.
    const MIN_NODE_SCREEN_W = 110
    const maxVbW = (rect.width / MIN_NODE_SCREEN_W) * NODE_W
    const maxVbH = (rect.height / MIN_NODE_SCREEN_W) * NODE_W
    if (targetW > maxVbW) {
      targetW = maxVbW
      targetH = maxVbW / aspect
    }
    if (targetH > maxVbH) {
      targetH = maxVbH
      targetW = maxVbH * aspect
    }

    vbW = targetW
    vbH = targetH

    // Center the visible window over the graph.
    vbX = (layout.width - vbW) / 2
    vbY = (layout.height - vbH) / 2
    fitVbW = vbW
  }

  // Auto-fit when node count changes
  let prevNodeCount = 0
  $effect(() => {
    const count = nodes.length
    if (count > 0 && count !== prevNodeCount && !hasManuallyZoomed) {
      requestAnimationFrame(() => fitToView())
    }
    prevNodeCount = count
  })

  // Mouse-wheel zoom (centered on cursor)
  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    hasManuallyZoomed = true
    const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
    if (!containerEl) return
    const rect = containerEl.getBoundingClientRect()
    // Convert screen coords to SVG coords
    const mx = vbX + ((e.clientX - rect.left) / rect.width) * vbW
    const my = vbY + ((e.clientY - rect.top) / rect.height) * vbH
    applyZoom(factor, mx, my)
  }

  // Drag to pan
  function handlePointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement
    if (target.closest('.node')) return
    hasManuallyZoomed = true
    dragging = true
    dragStartX = e.clientX
    dragStartY = e.clientY
    vbStartX = vbX
    vbStartY = vbY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging || !containerEl) return
    const rect = containerEl.getBoundingClientRect()
    // Convert pixel delta to viewBox delta
    const dx = ((e.clientX - dragStartX) / rect.width) * vbW
    const dy = ((e.clientY - dragStartY) / rect.height) * vbH
    vbX = vbStartX - dx
    vbY = vbStartY - dy
  }

  function handlePointerUp() {
    dragging = false
  }

  /** Fits a node label: at most `max` characters. */
  const clip = (s: string, max = 14) => (s.length > max ? s.slice(0, max - 1) + '…' : s)
  /** Node value label: strings as they are, anything else as compact JSON. */
  const valueLabel = (v: unknown) => clip(typeof v === 'string' ? v : formatValue(v))

  const layout = $derived(layoutGraph(nodes, edges))

  // Animation timing constants
  const NODE_GLOW_MS = 300
  const EDGE_TRAVEL_MS = 400

  const propagation = $derived(propagate(nodes, edges, changedNodeIds))

  // Node glow starts at: depth * (NODE_GLOW_MS + EDGE_TRAVEL_MS)
  function nodeDelayMs(nodeId: string): number {
    return (propagation.depths.get(nodeId) ?? 0) * (NODE_GLOW_MS + EDGE_TRAVEL_MS)
  }

  // Edge animation starts after the source node finishes glowing:
  //   sourceNodeDelay + NODE_GLOW_MS
  function edgeDelayMs(fromId: string): number {
    return nodeDelayMs(fromId) + NODE_GLOW_MS
  }

  /** Per kind: theme colour for outlines and edges, and the glow (an SVG filter needs a literal). */
  const KINDS: Record<ReactiveNode['type'], { color: string; glow: string }> = {
    state: { color: 'var(--blue)', glow: '#3b82f6' },
    derived: { color: 'var(--green)', glow: '#22c55e' },
    effect: { color: 'var(--red)', glow: '#ef4444' },
    template: { color: 'var(--purple)', glow: '#a855f7' },
  }

  function handleNodeClick(node: ReactiveNode) {
    selectedNodeId = selectedNodeId === node.id ? null : node.id
    onSelectNode?.(selectedNodeId ? node : null)
  }

  const nodeMap = $derived(new Map(nodes.map(n => [n.id, n])))

  let pulseKey = $state(0)
  $effect(() => {
    // Always re-trigger animation when there are changed nodes,
    // even if the same nodes changed again. This cancels any
    // in-progress animation ({#key} re-mounts the element) and
    // starts fresh, so rapid consecutive changes remain visible.
    if (changedNodeIds.size > 0) {
      queueMicrotask(() => {
        pulseKey++
      })
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="graph-container"
  bind:this={containerEl}
  onwheel={handleWheel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  class:dragging
>
  <!-- Named controls: "−" / "+" / "100%" alone do not say what the buttons do. -->
  <div class="zoom-controls">
    <button type="button" class="zoom-btn" onclick={zoomOut} title="Zoom out" aria-label="Zoom out"
      >−</button
    >
    <button
      type="button"
      class="zoom-label"
      onclick={zoomReset}
      title="Fit to view"
      aria-label="Fit to view (zoom {zoomPercent}%)">{zoomPercent}%</button
    >
    <button type="button" class="zoom-btn" onclick={zoomIn} title="Zoom in" aria-label="Zoom in"
      >+</button
    >
  </div>

  {#if nodes.length === 0}
    <p class="empty">No reactive signals tracked yet.</p>
  {:else}
    <svg width="100%" height="100%" viewBox="{vbX} {vbY} {vbW} {vbH}">
      <defs>
        {#each Object.entries(KINDS) as [type, { glow }] (type)}
          <filter id="glow-{type}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feFlood flood-color={glow} flood-opacity="0.7" />
            <feComposite in2="blur" operator="in" />
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        {/each}
      </defs>

      <!-- Component group backgrounds -->
      {#each layout.componentBoxes as box (`${box.x}:${box.componentFile}`)}
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx="10"
          ry="10"
          class="component-box"
        />
        <text x={box.x + 6} y={box.y + 11} class="component-label">{box.file}</text>
      {/each}

      <!-- Edges -->
      <!-- The runtime deduplicates edges, so `from→to` is unique. -->
      {#each edges as edge (`${edge.from}→${edge.to}`)}
        {@const fromPos = layout.positions.get(edge.from)}
        {@const toPos = layout.positions.get(edge.to)}
        {#if fromPos && toPos}
          {@const x1 = fromPos.x + NODE_W}
          {@const y1 = fromPos.y + NODE_H / 2}
          {@const x2 = toPos.x}
          {@const y2 = toPos.y + NODE_H / 2}
          {@const cx = (x1 + x2) / 2}
          {@const isHighlighted = selectedNodeId === edge.from || selectedNodeId === edge.to}
          {@const kind = KINDS[nodeMap.get(edge.from)!.type]}
          {@const stroke = isHighlighted ? 'var(--accent)' : kind.color}
          {@const pathD = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
          <!-- Base edge line -->
          <path d={pathD} class="edge" class:highlighted={isHighlighted} {stroke} />
          <!-- Bright overlay that sweeps left-to-right -->
          {#if propagation.edgeKeys.has(`${edge.from}→${edge.to}`)}
            {#key pulseKey}
              <path
                d={pathD}
                class="edge-sweep"
                stroke={kind.glow}
                style:--sweep-delay="{edgeDelayMs(edge.from)}ms"
                style:--sweep-dur="{EDGE_TRAVEL_MS}ms"
              />
            {/key}
          {/if}
          <polygon
            points="{x2 - 8},{y2 - 5} {x2},{y2} {x2 - 8},{y2 + 5}"
            class="arrow"
            class:highlighted={isHighlighted}
            fill={stroke}
          />
        {/if}
      {/each}

      <!-- Nodes -->
      {#each nodes as node (node.id)}
        {@const pos = layout.positions.get(node.id)}
        {#if pos}
          {@const kind = KINDS[node.type]}
          <g
            class="node"
            class:selected={selectedNodeId === node.id}
            transform="translate({pos.x}, {pos.y})"
            onclick={() => handleNodeClick(node)}
            role="button"
            tabindex="0"
            aria-label="{node.type} {node.name}"
            aria-pressed={selectedNodeId === node.id}
            onkeydown={e => {
              // Buttons activate on Space too (not only Enter).
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleNodeClick(node)
              }
            }}
          >
            {#if propagation.affected.has(node.id)}
              {#key pulseKey}
                <rect
                  x="-4"
                  y="-4"
                  width={NODE_W + 8}
                  height={NODE_H + 8}
                  rx="10"
                  ry="10"
                  fill="none"
                  stroke={kind.glow}
                  stroke-width="2"
                  class="glow-ring"
                  filter="url(#glow-{node.type})"
                  style:--node-delay="{nodeDelayMs(node.id)}ms"
                />
              {/key}
            {/if}
            <rect
              width={NODE_W}
              height={NODE_H}
              rx="6"
              ry="6"
              fill="var(--bg-elevated)"
              stroke={kind.color}
              stroke-width={selectedNodeId === node.id ? 2.5 : 1.5}
            />
            <circle cx="12" cy="16" r="4" fill={kind.color} />
            <text
              x="22"
              y="16"
              dominant-baseline="middle"
              class="node-name"
              font-size="11"
              font-family="DM Mono, monospace"
            >
              {clip(node.name)}
            </text>
            <text
              x={NODE_W - 6}
              y="16"
              text-anchor="end"
              dominant-baseline="middle"
              class="node-type"
              font-size="9"
              font-family="DM Sans, sans-serif"
              font-weight="600"
            >
              {node.type}
            </text>
            <text x="12" y="36" class="node-meta" font-size="9" font-family="DM Mono, monospace">
              {shortFile(node.componentFile)}
            </text>
            {#if node.value !== undefined && node.type !== 'effect'}
              <text
                x={NODE_W - 6}
                y="36"
                text-anchor="end"
                class="node-value"
                font-size="10"
                font-family="DM Mono, monospace"
                font-weight="500"
              >
                = {valueLabel(node.value)}
              </text>
            {/if}
            <line x1="6" y1="24" x2={NODE_W - 6} y2="24" class="node-divider" stroke-width="0.5" />
          </g>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .graph-container {
    overflow: hidden;
    flex: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    position: relative;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .graph-container.dragging {
    cursor: grabbing;
  }

  .empty {
    padding: 16px;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    cursor: default;
  }

  svg {
    display: block;
  }

  /* --- Zoom controls --- */
  .zoom-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    z-index: 10;
    overflow: hidden;
    cursor: default;
  }
  .zoom-btn,
  .zoom-label {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 13px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: var(--font-mono);
    line-height: 1;
  }
  .zoom-btn:hover,
  .zoom-label:hover {
    background: var(--bg-active);
    color: var(--fg);
  }
  .zoom-label {
    min-width: 44px;
    text-align: center;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    font-size: 10px;
  }

  /* --- Component group boxes --- */
  .component-box {
    fill: var(--bg-active);
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  .component-label {
    fill: var(--accent-hover);
    font-size: 9px;
    font-family: var(--font-mono);
    font-weight: 600;
  }

  /* --- Node text — themed via CSS vars so light mode flips automatically --- */
  .node-name {
    fill: var(--fg);
  }
  .node-type {
    fill: var(--fg-muted);
  }
  .node-meta {
    fill: var(--fg-faint);
  }
  .node-value {
    fill: var(--accent-hover);
  }
  .node-divider {
    stroke: var(--border);
    opacity: 1;
  }

  /* --- Edges --- */
  .edge {
    fill: none;
    stroke-width: 2;
    opacity: 0.5;
    transition: opacity 0.3s;
  }
  .edge.highlighted {
    stroke-width: 2.5;
    opacity: 1;
  }
  .arrow {
    opacity: 0.5;
    transition: opacity 0.3s;
  }
  .arrow.highlighted {
    opacity: 1;
  }

  /* Light sweep: a bright overlay path that reveals left-to-right via stroke-dashoffset */
  .edge-sweep {
    fill: none;
    stroke-width: 3.5;
    opacity: 0.9;
    /* Total dash length — must be longer than any edge path. 600 is safe for our layout. */
    stroke-dasharray: 600;
    stroke-dashoffset: 600;
    stroke-linecap: round;
    animation: sweep-line var(--sweep-dur, 400ms) ease-in-out var(--sweep-delay, 0ms) 1 forwards;
  }

  @keyframes sweep-line {
    0% {
      stroke-dashoffset: 600;
      opacity: 0.9;
    }
    100% {
      stroke-dashoffset: 0;
      opacity: 0;
    }
  }

  /* --- Nodes --- */
  .node {
    cursor: pointer;
  }
  .node:hover rect {
    stroke-width: 2.5;
  }

  .glow-ring {
    opacity: 0;
    animation: ring-pulse 0.3s ease-out var(--node-delay, 0ms) 1 forwards;
  }

  @keyframes ring-pulse {
    0% {
      opacity: 0;
      stroke-width: 0;
    }
    30% {
      opacity: 1;
      stroke-width: 3;
    }
    100% {
      opacity: 0;
      stroke-width: 1;
    }
  }
</style>
