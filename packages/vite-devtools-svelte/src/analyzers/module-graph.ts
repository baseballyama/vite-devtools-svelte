import fs from 'node:fs'
import path from 'node:path'

import type { ModuleGraphData, ModuleNode } from '../types.js'

/** Minimal shape of a Vite module-graph node that we read. */
export interface GraphModuleLike {
  file?: string | null
  importedModules: Iterable<{ file?: string | null }>
}

function classify(file: string): ModuleNode['type'] {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.svelte') return 'svelte'
  if (ext === '.ts') return 'ts'
  if (ext === '.js') return 'js'
  if (ext === '.css') return 'css'
  return 'other'
}

/** Whether `file` lies inside `root` (`..foo/x` does; `../x` and other drives do not). */
function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/**
 * Build the project-local module graph (node_modules and files outside
 * `root` excluded) and detect import cycles.
 *
 * Modules are keyed by `file`, so the variants Vite keeps of one file
 * (`?svelte&type=style`, client + ssr environments) are one node; an edge
 * between two variants of the same file is not a self-import and is dropped.
 * `isCyclic` marks exactly the modules on some import cycle (strongly
 * connected components), and `cycles` lists, for each of them, a shortest
 * cycle through it unless an earlier listed cycle already contains it. The
 * former depth-first search missed modules whose cycle only closed through
 * an already visited module, and recursed once per import level.
 */
export function buildModuleGraph(root: string, allModules: GraphModuleLike[]): ModuleGraphData {
  const modules: ModuleNode[] = []
  const idMap = new Map<string, ModuleNode>()

  for (const mod of allModules) {
    // a node_modules path segment (not `src/node_modules_utils.ts`)
    if (!mod.file || mod.file.split(/[\\/]/).includes('node_modules')) continue
    if (!isInside(root, mod.file)) continue
    if (idMap.has(mod.file)) continue // deduplicate across environments
    let size: number | undefined
    try {
      size = fs.statSync(mod.file).size
    } catch {
      /* ignore */
    }
    const node: ModuleNode = {
      id: path.relative(root, mod.file),
      file: mod.file,
      type: classify(mod.file),
      importedBy: [],
      imports: [],
      size,
    }
    idMap.set(mod.file, node)
    modules.push(node)
  }

  // Edges, deduplicated with Sets
  const importSets = new Map<ModuleNode, Set<string>>()
  const importedBySets = new Map<ModuleNode, Set<string>>()
  for (const mod of allModules) {
    const node = mod.file ? idMap.get(mod.file) : undefined
    if (!node) continue
    let imports = importSets.get(node)
    if (!imports) importSets.set(node, (imports = new Set()))
    for (const imp of mod.importedModules) {
      const impNode = imp.file ? idMap.get(imp.file) : undefined
      if (!impNode || impNode === node) continue
      if (!imports.has(impNode.id)) {
        imports.add(impNode.id)
        node.imports.push(impNode.id)
      }
      let by = importedBySets.get(impNode)
      if (!by) importedBySets.set(impNode, (by = new Set()))
      if (!by.has(node.id)) {
        by.add(node.id)
        impNode.importedBy.push(node.id)
      }
    }
  }

  const byId = new Map(modules.map(m => [m.id, m]))
  const component = stronglyConnectedComponents(modules, byId)
  const componentSize = new Map<number, number>()
  for (const c of component.values()) componentSize.set(c, (componentSize.get(c) ?? 0) + 1)
  const cyclic = (id: string) => componentSize.get(component.get(id)!)! > 1

  const cycles: string[][] = []
  const covered = new Set<string>()
  for (const m of modules) {
    if (!cyclic(m.id)) continue
    m.isCyclic = true
    if (covered.has(m.id)) continue
    const cycle = shortestCycleThrough(m.id, byId, component)
    for (const id of cycle) covered.add(id)
    cycles.push(cycle)
  }

  return { modules, cycles }
}

/** Tarjan's algorithm, iterative (import chains can be deeper than the call stack). */
function stronglyConnectedComponents(
  modules: ModuleNode[],
  byId: Map<string, ModuleNode>,
): Map<string, number> {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const component = new Map<string, number>()
  let next = 0
  let count = 0
  const visit = (id: string) => {
    index.set(id, next)
    low.set(id, next)
    next++
    stack.push(id)
    onStack.add(id)
  }
  for (const start of modules) {
    if (index.has(start.id)) continue
    visit(start.id)
    const work: Array<{ id: string; i: number }> = [{ id: start.id, i: 0 }]
    while (work.length > 0) {
      const frame = work.at(-1)!
      const out = byId.get(frame.id)!.imports
      if (frame.i < out.length) {
        const w = out[frame.i++]!
        if (!index.has(w)) {
          visit(w)
          work.push({ id: w, i: 0 })
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!))
        }
        continue
      }
      work.pop()
      const parent = work.at(-1)
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!))
      if (low.get(frame.id) === index.get(frame.id)) {
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          component.set(w, count)
        } while (w !== frame.id)
        count++
      }
    }
  }
  return component
}

/** `[start, …, start]`: a shortest import cycle through `start` (which must be on one). */
function shortestCycleThrough(
  start: string,
  byId: Map<string, ModuleNode>,
  component: Map<string, number>,
): string[] {
  const own = component.get(start)
  const parent = new Map<string, string>()
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!
    for (const next of byId.get(id)!.imports) {
      if (next === start) {
        const cycle = [start]
        for (let at = id; at !== start; at = parent.get(at)!) cycle.splice(1, 0, at)
        cycle.push(start)
        return cycle
      }
      if (component.get(next) !== own || parent.has(next)) continue
      parent.set(next, id)
      queue.push(next)
    }
  }
  /* v8 ignore next -- unreachable: every module of a non-trivial component is on a cycle */
  return [start, start]
}
