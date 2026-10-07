// Helpers for the reactivity integration tests (see plugin.ts): mount real
// compiled components and read what the injected runtime recorded.
import { mount, unmount, flushSync, type Component } from 'svelte'

export interface GraphNode {
  id: string
  type: string
  name: string
  componentId: number
  componentFile: string
  value?: unknown
}
export interface Graph {
  nodes: GraphNode[]
  edges: Array<{ from: string; to: string }>
  [k: string]: unknown
}

export const dt = (): any => (window as any).__SVELTE_DEVTOOLS__

export function render<P extends Record<string, any>>(Comp: Component<P>, props?: P) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const app = mount(Comp, { target, props: (props ?? {}) as P })
  flushSync()
  return {
    target,
    app,
    destroy() {
      unmount(app)
      flushSync()
      target.remove()
    },
  }
}

/** Live component instances whose name (file basename) is `name`. */
export const instances = (name: string) =>
  dt()
    .getTree()
    .filter((c: { name: string }) => c.name === name) as Array<{
    id: number
    name: string
    file: string
    parentId: number | null
  }>

/** The single live instance named `name` (throws when 0 or > 1). */
export function instance(name: string) {
  const list = instances(name)
  if (list.length !== 1) throw new Error(`expected 1 live ${name}, found ${list.length}`)
  return list[0]
}

export const graph = (componentId: number | null = null): Graph =>
  dt().getReactiveGraph(componentId)

export function node(g: Graph, componentId: number, name: string): GraphNode {
  const n = g.nodes.find(x => x.componentId === componentId && x.name === name)
  if (!n)
    throw new Error(`no node ${componentId}:${name} in [${g.nodes.map(x => x.id).join(', ')}]`)
  return n
}

export const incoming = (g: Graph, id: string) => g.edges.filter(e => e.to === id).map(e => e.from)
export const outgoing = (g: Graph, id: string) => g.edges.filter(e => e.from === id).map(e => e.to)

/**
 * One state poll tick (what the 200 ms interval runs), with every object
 * re-check due: in-place proxy mutations are otherwise found by the
 * time-based re-check (>= 1 s after the last one).
 */
export function poll() {
  const d = dt()
  for (const meta of d._pollMeta.values()) meta.nextCheckAt = 0
  d._deepCredit = 1000
  d._pollStateValues()
}

export const timeline = (): Array<{
  id: string
  name: string
  oldValue: unknown
  newValue: unknown
}> => dt().getStateTimeline()

export { flushSync }
