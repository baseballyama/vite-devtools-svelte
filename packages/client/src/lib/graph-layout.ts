/**
 * Pure layout and propagation analysis for `<GraphView>` (the reactive
 * dependency graph). Kept out of the component so it is plain, testable
 * TypeScript; the component only renders the result.
 */
import { componentName } from './format.js'
import type { ReactiveEdge, ReactiveNode } from './types.js'

// Layout constants (also used by the renderer for node geometry).
export const NODE_W = 160
export const NODE_H = 58
const LAYER_GAP_X = 280
const NODE_GAP_Y = 78
const COMP_GROUP_GAP = 28 // extra gap between component groups in same layer
const PADDING = 40

/**
 * Within a component: state before derived before effect. Typed as a partial
 * record so a node type a newer runtime adds sorts last instead of breaking.
 */
const TYPE_ORDER: Partial<Record<string, number>> = { state: 0, derived: 1, effect: 2, template: 3 }

interface Point {
  x: number
  y: number
}

/** Background box grouping one component's nodes within one layer. */
interface ComponentBox {
  /** Display name (`shortFile`). */
  file: string
  /** Full path: the identity of the group. */
  componentFile: string
  x: number
  y: number
  w: number
  h: number
}

export interface GraphLayout {
  /** Top-left corner of each node, by node id. */
  positions: Map<string, Point>
  width: number
  height: number
  componentBoxes: ComponentBox[]
}

/** What a change set reaches downstream, for the propagation animation. */
export interface Propagation {
  affected: Set<string>
  /** `from→to` keys of edges between affected nodes. */
  edgeKeys: Set<string>
  /** BFS distance from the nearest changed node. */
  depths: Map<string, number>
}

/** File name without directory or `.svelte` extension. */
export const shortFile = (file: string) => componentName(file, '')

/** Layered DAG layout with component grouping and barycenter ordering. */
export function layoutGraph(
  nodes: readonly ReactiveNode[],
  edges: readonly ReactiveEdge[],
): GraphLayout {
  if (nodes.length === 0) return { positions: new Map(), width: 0, height: 0, componentBoxes: [] }

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  const radj = new Map<string, string[]>() // reverse adjacency
  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
    radj.set(n.id, [])
  }
  // An edge to a node outside `nodes` would be layered as an unknown id and
  // crash the sort below; callers filter them, but the layout must not rely on it.
  edges = edges.filter(e => nodeById.has(e.from) && nodeById.has(e.to))
  // From here on every id in `edges` has entries in the maps above.
  for (const e of edges) {
    adj.get(e.from)!.push(e.to)
    radj.get(e.to)!.push(e.from)
    inDegree.set(e.to, inDegree.get(e.to)! + 1)
  }

  // --- Layer assignment (topological sort BFS) ---
  const layers: string[][] = []
  let queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id)
  const visited = new Set<string>()
  while (queue.length > 0) {
    layers.push([...queue])
    for (const id of queue) visited.add(id)
    const next: string[] = []
    for (const id of queue) {
      for (const target of adj.get(id)!) {
        inDegree.set(target, inDegree.get(target)! - 1)
        if (inDegree.get(target) === 0 && !visited.has(target)) next.push(target)
      }
    }
    queue = next
  }
  const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id)
  if (remaining.length > 0) layers.push(remaining)

  // --- Within each layer, group by component then sort by barycenter ---
  // Initial ordering: group by componentFile
  for (const layer of layers) {
    layer.sort((a, b) => {
      const na = nodeById.get(a)!,
        nb = nodeById.get(b)!
      const cmp = na.componentFile.localeCompare(nb.componentFile)
      if (cmp !== 0) return cmp
      // Within same component: state before derived before effect
      return (TYPE_ORDER[na.type] ?? 3) - (TYPE_ORDER[nb.type] ?? 3)
    })
  }

  // Barycenter heuristic: adjust ordering to reduce edge crossings
  // Run a few passes forward and backward
  const posInLayer = new Map<string, number>()
  for (const layer of layers) {
    for (const [j, id] of layer.entries()) posInLayer.set(id, j)
  }

  for (let pass = 0; pass < 4; pass++) {
    // Forward pass: order each layer by avg position of predecessors
    for (const layer of layers.slice(1)) {
      const bary = new Map<string, number>()
      for (const id of layer) {
        // Past the first layer every node has a predecessor: it was layered
        // when its last incoming edge was consumed, or sits in a cycle.
        const preds = radj.get(id)!
        bary.set(id, preds.reduce((s, p) => s + posInLayer.get(p)!, 0) / preds.length)
      }
      // Stable sort by barycenter, keeping component groups together
      layer.sort((a, b) => {
        const na = nodeById.get(a)!,
          nb = nodeById.get(b)!
        const cmp = na.componentFile.localeCompare(nb.componentFile)
        if (cmp !== 0) return cmp
        return bary.get(a)! - bary.get(b)!
      })
      for (const [j, id] of layer.entries()) posInLayer.set(id, j)
    }

    // Backward pass
    for (let i = layers.length - 2; i >= 0; i--) {
      const layer = layers[i]!
      const bary = new Map<string, number>()
      for (const id of layer) {
        const succs = adj.get(id)!
        if (succs.length > 0) {
          const avg = succs.reduce((s, p) => s + posInLayer.get(p)!, 0) / succs.length
          bary.set(id, avg)
        } else {
          bary.set(id, posInLayer.get(id)!)
        }
      }
      layer.sort((a, b) => {
        const na = nodeById.get(a)!,
          nb = nodeById.get(b)!
        const cmp = na.componentFile.localeCompare(nb.componentFile)
        if (cmp !== 0) return cmp
        return bary.get(a)! - bary.get(b)!
      })
      for (const [j, id] of layer.entries()) posInLayer.set(id, j)
    }
  }

  // --- Compute positions with component group gaps ---
  // Step 1: initial top-aligned placement to get total height per layer
  const layerSlots: { id: string; comp: string }[][] = []
  const layerHeights: number[] = []
  for (const layer of layers) {
    const slots: { id: string; comp: string }[] = []
    let h = PADDING
    let prevComp = ''
    for (const [j, id] of layer.entries()) {
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
  const positions = new Map<string, Point>()
  for (const [i, slots] of layerSlots.entries()) {
    const offset = (totalHeight - layerHeights[i]!) / 2
    let y = PADDING + offset
    let prevComp = ''
    for (const [j, { id, comp }] of slots.entries()) {
      if (j > 0 && comp !== prevComp) y += COMP_GROUP_GAP
      positions.set(id, { x: PADDING + i * LAYER_GAP_X, y })
      y += NODE_GAP_Y
      prevComp = comp
    }
  }

  // Step 4: refine Y positions — pull each node toward its connected neighbors' average Y
  // This reduces long diagonal edges. Run a few passes.
  for (let pass = 0; pass < 6; pass++) {
    for (const layer of layers) {
      if (layer.length <= 1) continue
      // Compute ideal Y for each node based on neighbors
      const idealY = new Map<string, number>()
      for (const id of layer) {
        const preds = radj.get(id)!
        const succs = adj.get(id)!
        const neighbors = [...preds, ...succs].filter(nid => positions.has(nid))
        if (neighbors.length > 0) {
          const avgY = neighbors.reduce((s, nid) => s + positions.get(nid)!.y, 0) / neighbors.length
          idealY.set(id, avgY)
        }
      }
      // Sort by current Y to maintain relative ordering
      const sorted = layer.toSorted((a, b) => positions.get(a)!.y - positions.get(b)!.y)
      // Try to move each node toward its ideal Y without overlapping
      for (const [j, id] of sorted.entries()) {
        const ideal = idealY.get(id)
        if (ideal === undefined) continue
        const cur = positions.get(id)!
        // Determine min/max Y to avoid overlapping with neighbors in same layer
        const prevId = j > 0 ? sorted[j - 1]! : null
        const nextId = j < sorted.length - 1 ? sorted[j + 1]! : null
        const prevNode = prevId ? nodeById.get(prevId) : null
        const curNode = nodeById.get(id)!
        const gapAbove =
          prevId && prevNode && prevNode.componentFile !== curNode.componentFile
            ? COMP_GROUP_GAP
            : 0
        const minY = prevId ? positions.get(prevId)!.y + NODE_GAP_Y + gapAbove : PADDING
        const nextNode = nextId ? nodeById.get(nextId) : null
        const gapBelow =
          nextId && nextNode && nextNode.componentFile !== curNode.componentFile
            ? COMP_GROUP_GAP
            : 0
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
  const componentBoxes: ComponentBox[] = []
  for (const [i, layer] of layers.entries()) {
    // Collect nodes per component in this layer. Keyed by the full path:
    // two `Row.svelte` in different folders are different groups (keyed by
    // the short name, one box would span both and the nodes between them).
    const groups = new Map<string, Point[]>()
    for (const id of layer) {
      const n = nodeById.get(id)!
      const pos = positions.get(id)!
      const group = groups.get(n.componentFile)
      if (group) group.push(pos)
      else groups.set(n.componentFile, [pos])
    }
    for (const [componentFile, poses] of groups) {
      const file = shortFile(componentFile)
      let minY_ = Infinity
      let maxY_ = -Infinity
      for (const p of poses) {
        minY_ = Math.min(minY_, p.y)
        maxY_ = Math.max(maxY_, p.y + NODE_H)
      }
      const x = PADDING + i * LAYER_GAP_X
      componentBoxes.push({
        file,
        componentFile,
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
}

/** Propagation analysis: affected nodes, edge keys and BFS depths in one pass. */
export function propagate(
  nodes: readonly ReactiveNode[],
  edges: readonly ReactiveEdge[],
  changedNodeIds: ReadonlySet<string>,
): Propagation {
  if (changedNodeIds.size === 0)
    return { affected: new Set(), edgeKeys: new Set(), depths: new Map() }

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
    for (const dep of adj.get(id) ?? []) queue.push({ id: dep, depth: depth + 1 })
  }

  const affected = new Set(depths.keys())
  const edgeKeys = new Set<string>()
  for (const e of edges) {
    if (affected.has(e.from) && affected.has(e.to)) edgeKeys.add(`${e.from}→${e.to}`)
  }

  return { affected, edgeKeys, depths }
}
