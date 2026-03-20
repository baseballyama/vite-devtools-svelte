<script lang="ts">
  import type { ReactiveNode, ReactiveEdge } from '../lib/types.js'

  interface Props {
    nodes: ReactiveNode[]
    edges: ReactiveEdge[]
    onSelectNode?: (node: ReactiveNode | null) => void
    changedNodeIds?: Set<string>
  }

  let { nodes, edges, onSelectNode, changedNodeIds = new Set() }: Props = $props()
  let selectedNodeId = $state<string | null>(null)

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
  const ZOOM_MIN_VB = 100   // minimum viewBox dimension (max zoom in)
  const ZOOM_MAX_VB = 8000  // maximum viewBox dimension (max zoom out)

  // Layout constants
  const NODE_W = 160
  const NODE_H = 58
  const LAYER_GAP_X = 280
  const NODE_GAP_Y = 78
  const COMP_GROUP_GAP = 28  // extra gap between component groups in same layer
  const PADDING = 40

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
  function zoomReset() { hasManuallyZoomed = false; fitToView() }

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
    const aspect = rect.width / rect.height
    const graphW = Math.max(layout.width, 200)
    const graphH = Math.max(layout.height, 100)
    const graphAspect = graphW / graphH

    if (graphAspect > aspect) {
      // Graph is wider — fit width
      vbW = graphW
      vbH = graphW / aspect
    } else {
      // Graph is taller — fit height
      vbH = graphH
      vbW = graphH * aspect
    }

    // Center the graph in the viewBox
    vbX = (graphW - vbW) / 2
    vbY = (graphH - vbH) / 2
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

  function shortFile(file: string): string {
    if (!file) return ''
    return file.split('/').pop()?.replace('.svelte', '') || ''
  }

  function formatValue(v: unknown): string {
    if (v === undefined) return ''
    const s = String(v)
    return s.length > 14 ? s.slice(0, 13) + '…' : s
  }

  // Layered DAG layout with component grouping and barycenter ordering
  const layout = $derived.by(() => {
    if (nodes.length === 0) return { positions: new Map<string, { x: number; y: number }>(), width: 0, height: 0, componentBoxes: [] as { file: string; x: number; y: number; w: number; h: number }[] }

    const nodeById = new Map(nodes.map(n => [n.id, n]))
    const inDegree = new Map<string, number>()
    const adj = new Map<string, string[]>()
    const radj = new Map<string, string[]>() // reverse adjacency
    for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); radj.set(n.id, []) }
    for (const e of edges) {
      adj.get(e.from)?.push(e.to)
      radj.get(e.to)?.push(e.from)
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1)
    }

    // --- Layer assignment (topological sort BFS) ---
    const layers: string[][] = []
    let queue = nodes.filter(n => (inDegree.get(n.id) || 0) === 0).map(n => n.id)
    const visited = new Set<string>()
    while (queue.length > 0) {
      layers.push([...queue])
      for (const id of queue) visited.add(id)
      const next: string[] = []
      for (const id of queue) {
        for (const target of adj.get(id) || []) {
          inDegree.set(target, (inDegree.get(target) || 0) - 1)
          if (inDegree.get(target) === 0 && !visited.has(target)) next.push(target)
        }
      }
      queue = next
    }
    const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id)
    if (remaining.length > 0) layers.push(remaining)

    // --- Within each layer, group by component then sort by barycenter ---
    // Initial ordering: group by componentFile
    for (let i = 0; i < layers.length; i++) {
      layers[i].sort((a, b) => {
        const na = nodeById.get(a)!, nb = nodeById.get(b)!
        const cmp = na.componentFile.localeCompare(nb.componentFile)
        if (cmp !== 0) return cmp
        // Within same component: state before derived before effect
        const typeOrder = { state: 0, derived: 1, effect: 2 }
        return (typeOrder[na.type] ?? 3) - (typeOrder[nb.type] ?? 3)
      })
    }

    // Barycenter heuristic: adjust ordering to reduce edge crossings
    // Run a few passes forward and backward
    const posInLayer = new Map<string, number>()
    for (const layer of layers) {
      for (let j = 0; j < layer.length; j++) posInLayer.set(layer[j], j)
    }

    for (let pass = 0; pass < 4; pass++) {
      // Forward pass: order each layer by avg position of predecessors
      for (let i = 1; i < layers.length; i++) {
        const bary = new Map<string, number>()
        for (const id of layers[i]) {
          const preds = radj.get(id) || []
          if (preds.length > 0) {
            const avg = preds.reduce((s, p) => s + (posInLayer.get(p) ?? 0), 0) / preds.length
            bary.set(id, avg)
          } else {
            bary.set(id, posInLayer.get(id) ?? 0)
          }
        }
        // Stable sort by barycenter, keeping component groups together
        layers[i].sort((a, b) => {
          const na = nodeById.get(a)!, nb = nodeById.get(b)!
          const cmp = na.componentFile.localeCompare(nb.componentFile)
          if (cmp !== 0) return cmp
          return (bary.get(a) ?? 0) - (bary.get(b) ?? 0)
        })
        for (let j = 0; j < layers[i].length; j++) posInLayer.set(layers[i][j], j)
      }

      // Backward pass
      for (let i = layers.length - 2; i >= 0; i--) {
        const bary = new Map<string, number>()
        for (const id of layers[i]) {
          const succs = adj.get(id) || []
          if (succs.length > 0) {
            const avg = succs.reduce((s, p) => s + (posInLayer.get(p) ?? 0), 0) / succs.length
            bary.set(id, avg)
          } else {
            bary.set(id, posInLayer.get(id) ?? 0)
          }
        }
        layers[i].sort((a, b) => {
          const na = nodeById.get(a)!, nb = nodeById.get(b)!
          const cmp = na.componentFile.localeCompare(nb.componentFile)
          if (cmp !== 0) return cmp
          return (bary.get(a) ?? 0) - (bary.get(b) ?? 0)
        })
        for (let j = 0; j < layers[i].length; j++) posInLayer.set(layers[i][j], j)
      }
    }

    // --- Compute positions with component group gaps ---
    // Step 1: initial top-aligned placement to get total height per layer
    const layerSlots: { id: string; comp: string }[][] = []
    const layerHeights: number[] = []
    for (let i = 0; i < layers.length; i++) {
      const slots: { id: string; comp: string }[] = []
      let h = PADDING
      let prevComp = ''
      for (let j = 0; j < layers[i].length; j++) {
        const id = layers[i][j]
        const n = nodeById.get(id)!
        const comp = n.componentFile
        if (j > 0 && comp !== prevComp) h += COMP_GROUP_GAP
        slots.push({ id, comp })
        h += NODE_GAP_Y
        prevComp = comp
      }
      layerSlots.push(slots)
      layerHeights.push(h)
    }

    // Step 2: find max height across all layers
    const totalHeight = Math.max(...layerHeights, PADDING * 2)

    // Step 3: place nodes, centering each layer vertically within totalHeight
    const positions = new Map<string, { x: number; y: number }>()
    for (let i = 0; i < layers.length; i++) {
      const offset = (totalHeight - layerHeights[i]) / 2
      let y = PADDING + offset
      let prevComp = ''
      for (let j = 0; j < layerSlots[i].length; j++) {
        const { id, comp } = layerSlots[i][j]
        if (j > 0 && comp !== prevComp) y += COMP_GROUP_GAP
        positions.set(id, { x: PADDING + i * LAYER_GAP_X, y })
        y += NODE_GAP_Y
        prevComp = comp
      }
    }

    // Step 4: refine Y positions — pull each node toward its connected neighbors' average Y
    // This reduces long diagonal edges. Run a few passes.
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        if (layer.length <= 1) continue
        // Compute ideal Y for each node based on neighbors
        const idealY = new Map<string, number>()
        for (const id of layer) {
          const preds = radj.get(id) || []
          const succs = adj.get(id) || []
          const neighbors = [...preds, ...succs].filter(nid => positions.has(nid))
          if (neighbors.length > 0) {
            const avgY = neighbors.reduce((s, nid) => s + positions.get(nid)!.y, 0) / neighbors.length
            idealY.set(id, avgY)
          }
        }
        // Sort by current Y to maintain relative ordering
        const sorted = [...layer].sort((a, b) => positions.get(a)!.y - positions.get(b)!.y)
        // Try to move each node toward its ideal Y without overlapping
        for (let j = 0; j < sorted.length; j++) {
          const id = sorted[j]
          const ideal = idealY.get(id)
          if (ideal === undefined) continue
          const cur = positions.get(id)!
          // Determine min/max Y to avoid overlapping with neighbors in same layer
          const prevId = j > 0 ? sorted[j - 1] : null
          const nextId = j < sorted.length - 1 ? sorted[j + 1] : null
          const prevNode = prevId ? nodeById.get(prevId) : null
          const curNode = nodeById.get(id)!
          const gapAbove = (prevId && prevNode && prevNode.componentFile !== curNode.componentFile) ? COMP_GROUP_GAP : 0
          const minY = prevId ? positions.get(prevId)!.y + NODE_GAP_Y + gapAbove : PADDING
          const nextNode = nextId ? nodeById.get(nextId) : null
          const gapBelow = (nextId && nextNode && nextNode.componentFile !== curNode.componentFile) ? COMP_GROUP_GAP : 0
          const maxY = nextId ? positions.get(nextId)!.y - NODE_GAP_Y - gapBelow : totalHeight
          const newY = Math.max(minY, Math.min(maxY, ideal))
          positions.set(id, { x: cur.x, y: newY })
        }
      }
    }

    let maxY = 0
    for (const [, pos] of positions) {
      maxY = Math.max(maxY, pos.y + NODE_H)
    }

    // --- Compute component bounding boxes per layer ---
    // Group by (layerIndex, componentFile) so boxes never span multiple columns
    const BOX_PAD = 14
    const componentBoxes: { file: string; x: number; y: number; w: number; h: number }[] = []
    for (let i = 0; i < layers.length; i++) {
      // Collect nodes per component in this layer
      const groups = new Map<string, { x: number; y: number }[]>()
      for (const id of layers[i]) {
        const n = nodeById.get(id)!
        const pos = positions.get(id)!
        const file = shortFile(n.componentFile)
        if (!groups.has(file)) groups.set(file, [])
        groups.get(file)!.push(pos)
      }
      for (const [file, poses] of groups) {
        let minY_ = Infinity, maxY_ = -Infinity
        for (const p of poses) {
          minY_ = Math.min(minY_, p.y)
          maxY_ = Math.max(maxY_, p.y + NODE_H)
        }
        const x = PADDING + i * LAYER_GAP_X
        componentBoxes.push({
          file,
          x: x - BOX_PAD,
          y: minY_ - BOX_PAD,
          w: NODE_W + BOX_PAD * 2,
          h: maxY_ - minY_ + BOX_PAD * 2,
        })
      }
    }

    return {
      positions,
      width: PADDING * 2 + layers.length * LAYER_GAP_X,
      height: maxY + PADDING,
      componentBoxes,
    }
  })

  // Animation timing constants
  const NODE_GLOW_MS = 300
  const EDGE_TRAVEL_MS = 400

  // Propagation analysis: compute affected nodes, edge keys, and BFS depths in one pass
  const propagation = $derived.by(() => {
    const empty = { affected: new Set<string>(), edgeKeys: new Set<string>(), depths: new Map<string, number>() }
    if (changedNodeIds.size === 0) return empty

    // Build adjacency once (shared by affected + depths computation)
    const adj = new Map<string, string[]>()
    for (const n of nodes) adj.set(n.id, [])
    for (const e of edges) adj.get(e.from)?.push(e.to)

    // BFS: compute depths and collect all affected nodes simultaneously
    const depths = new Map<string, number>()
    const queue: { id: string; depth: number }[] = []
    for (const id of changedNodeIds) queue.push({ id, depth: 0 })
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (depths.has(id)) continue
      depths.set(id, depth)
      for (const dep of adj.get(id) || []) queue.push({ id: dep, depth: depth + 1 })
    }

    const affected = new Set(depths.keys())
    const edgeKeys = new Set<string>()
    for (const e of edges) {
      if (affected.has(e.from) && affected.has(e.to)) edgeKeys.add(`${e.from}→${e.to}`)
    }

    return { affected, edgeKeys, depths }
  })

  const affectedNodeIds = $derived(propagation.affected)
  const affectedEdgeKeys = $derived(propagation.edgeKeys)
  const nodeDepths = $derived(propagation.depths)

  // Node glow starts at: depth * (NODE_GLOW_MS + EDGE_TRAVEL_MS)
  function nodeDelayMs(nodeId: string): number {
    const depth = nodeDepths.get(nodeId) ?? 0
    return depth * (NODE_GLOW_MS + EDGE_TRAVEL_MS)
  }

  // Edge animation starts after the source node finishes glowing:
  //   sourceNodeDelay + NODE_GLOW_MS
  function edgeDelayMs(fromId: string): number {
    return nodeDelayMs(fromId) + NODE_GLOW_MS
  }

  function nodeColor(type: ReactiveNode['type']): string {
    switch (type) {
      case 'state': return 'var(--color-info)'
      case 'derived': return 'var(--color-success)'
      case 'effect': return 'var(--color-error)'
      default: return 'var(--color-text-muted)'
    }
  }
  function nodeGlowColor(type: ReactiveNode['type']): string {
    switch (type) {
      case 'state': return '#3b82f6'
      case 'derived': return '#22c55e'
      case 'effect': return '#ef4444'
      default: return '#999'
    }
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
      queueMicrotask(() => { pulseKey++ })
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
  <div class="zoom-controls">
    <button class="zoom-btn" onclick={zoomOut} title="Zoom out">−</button>
    <button class="zoom-label" onclick={zoomReset} title="Fit to view">{zoomPercent}%</button>
    <button class="zoom-btn" onclick={zoomIn} title="Zoom in">+</button>
  </div>

  {#if nodes.length === 0}
    <p class="empty">No reactive signals tracked yet.</p>
  {:else}
    <svg width="100%" height="100%" viewBox="{vbX} {vbY} {vbW} {vbH}">
      <defs>
        <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feFlood flood-color="#3b82f6" flood-opacity="0.7" />
          <feComposite in2="blur" operator="in" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feFlood flood-color="#22c55e" flood-opacity="0.7" />
          <feComposite in2="blur" operator="in" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feFlood flood-color="#ef4444" flood-opacity="0.7" />
          <feComposite in2="blur" operator="in" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <!-- Component group backgrounds -->
      {#each layout.componentBoxes as box}
        <rect
          x={box.x} y={box.y} width={box.w} height={box.h}
          rx="10" ry="10"
          class="component-box"
        />
        <text
          x={box.x + 6} y={box.y + 11}
          class="component-label"
        >{box.file}</text>
      {/each}

      <!-- Edges -->
      {#each edges as edge}
        {@const fromPos = layout.positions.get(edge.from)}
        {@const toPos = layout.positions.get(edge.to)}
        {#if fromPos && toPos}
          {@const x1 = fromPos.x + NODE_W}
          {@const y1 = fromPos.y + NODE_H / 2}
          {@const x2 = toPos.x}
          {@const y2 = toPos.y + NODE_H / 2}
          {@const cx = (x1 + x2) / 2}
          {@const isHighlighted = selectedNodeId === edge.from || selectedNodeId === edge.to}
          {@const fromNode = nodeMap.get(edge.from)}
          {@const edgeKey = `${edge.from}→${edge.to}`}
          {@const isPulsing = affectedEdgeKeys.has(edgeKey)}
          {@const edgeMs = edgeDelayMs(edge.from)}
          {@const pathD = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
          <!-- Base edge line -->
          <path
            d={pathD}
            class="edge"
            class:highlighted={isHighlighted}
            stroke={isHighlighted ? 'var(--color-accent)' : fromNode ? nodeColor(fromNode.type) : 'var(--color-text-muted)'}
          />
          <!-- Bright overlay that sweeps left-to-right -->
          {#if isPulsing}
            {#key pulseKey}
              <path
                d={pathD}
                class="edge-sweep"
                stroke={fromNode ? nodeGlowColor(fromNode.type) : '#fff'}
                style="--sweep-delay: {edgeMs}ms; --sweep-dur: {EDGE_TRAVEL_MS}ms;"
              />
            {/key}
          {/if}
          <polygon
            points="{x2 - 8},{y2 - 5} {x2},{y2} {x2 - 8},{y2 + 5}"
            class="arrow"
            class:highlighted={isHighlighted}
            fill={isHighlighted ? 'var(--color-accent)' : fromNode ? nodeColor(fromNode.type) : 'var(--color-text-muted)'}
          />
        {/if}
      {/each}

      <!-- Nodes -->
      {#each nodes as node}
        {@const pos = layout.positions.get(node.id)}
        {#if pos}
          {@const hasValue = node.value !== undefined && node.type !== 'effect'}
          {@const isAffected = affectedNodeIds.has(node.id)}
          {@const nodeMs = nodeDelayMs(node.id)}
          {@const glowFilter = node.type === 'state' ? 'url(#glow-blue)' : node.type === 'derived' ? 'url(#glow-green)' : 'url(#glow-red)'}
          <g
            class="node"
            class:selected={selectedNodeId === node.id}
            transform="translate({pos.x}, {pos.y})"
            onclick={() => handleNodeClick(node)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter') handleNodeClick(node) }}
          >
            {#if isAffected}
              {#key pulseKey}
                <rect
                  x="-4" y="-4"
                  width={NODE_W + 8} height={NODE_H + 8}
                  rx="10" ry="10"
                  fill="none"
                  stroke={nodeGlowColor(node.type)}
                  stroke-width="2"
                  class="glow-ring"
                  filter={glowFilter}
                  style="--node-delay: {nodeMs}ms;"
                />
              {/key}
            {/if}
            <rect
              width={NODE_W} height={NODE_H}
              rx="6" ry="6"
              fill="var(--color-surface)"
              stroke={nodeColor(node.type)}
              stroke-width={selectedNodeId === node.id ? 2.5 : 1.5}
            />
            <circle cx="12" cy="16" r="4" fill={nodeColor(node.type)} />
            <text x="22" y="16" dominant-baseline="middle" fill="#e5e5e5" font-size="11" font-family="DM Mono, monospace">
              {node.name.length > 14 ? node.name.slice(0, 13) + '…' : node.name}
            </text>
            <text x={NODE_W - 6} y="16" text-anchor="end" dominant-baseline="middle" fill="#999" font-size="9" font-family="DM Sans, sans-serif" font-weight="600">
              {node.type}
            </text>
            <text x="12" y="36" fill="#999" font-size="9" font-family="DM Mono, monospace">
              {shortFile(node.componentFile)}
            </text>
            {#if hasValue}
              <text x={NODE_W - 6} y="36" text-anchor="end" fill="#ff6633" font-size="10" font-family="DM Mono, monospace" font-weight="500">
                = {formatValue(node.value)}
              </text>
            {/if}
            <line x1="6" y1="24" x2={NODE_W - 6} y2="24" stroke="#333" stroke-width="0.5" opacity="0.5" />
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
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-base);
    position: relative;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .graph-container.dragging { cursor: grabbing; }

  .empty {
    padding: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    cursor: default;
  }

  svg { display: block; }

  /* --- Zoom controls --- */
  .zoom-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    z-index: 10;
    overflow: hidden;
    cursor: default;
  }
  .zoom-btn, .zoom-label {
    background: none; border: none;
    color: var(--color-text-muted);
    font-size: 13px; padding: 4px 10px;
    cursor: pointer; font-family: var(--font-mono); line-height: 1;
  }
  .zoom-btn:hover, .zoom-label:hover {
    background: var(--color-surface-active);
    color: var(--color-text);
  }
  .zoom-label {
    min-width: 44px; text-align: center;
    border-left: 1px solid var(--color-border);
    border-right: 1px solid var(--color-border);
    font-size: 10px;
  }

  /* --- Component group boxes --- */
  .component-box {
    fill: rgba(255, 255, 255, 0.02);
    stroke: rgba(255, 255, 255, 0.08);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  .component-label {
    fill: rgba(255, 160, 80, 0.7);
    font-size: 9px;
    font-family: var(--font-mono);
    font-weight: 600;
  }

  /* --- Edges --- */
  .edge { fill: none; stroke-width: 2; opacity: 0.5; transition: opacity 0.3s; }
  .edge.highlighted { stroke-width: 2.5; opacity: 1; }
  .arrow { opacity: 0.5; transition: opacity 0.3s; }
  .arrow.highlighted { opacity: 1; }

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
    0%   { stroke-dashoffset: 600; opacity: 0.9; }
    100% { stroke-dashoffset: 0; opacity: 0; }
  }

  /* --- Nodes --- */
  .node { cursor: pointer; }
  .node:hover rect { stroke-width: 2.5; }

  .glow-ring {
    opacity: 0;
    animation: ring-pulse 0.3s ease-out var(--node-delay, 0ms) 1 forwards;
  }

  @keyframes ring-pulse {
    0%   { opacity: 0; stroke-width: 0; }
    30%  { opacity: 1; stroke-width: 3; }
    100% { opacity: 0; stroke-width: 1; }
  }
</style>
