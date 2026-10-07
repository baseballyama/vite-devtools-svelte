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

/**
 * Build the project-local module graph (node_modules and files outside
 * `root` excluded) and detect import cycles.
 */
export function buildModuleGraph(root: string, allModules: GraphModuleLike[]): ModuleGraphData {
  const modules: ModuleNode[] = []
  const idMap = new Map<string, ModuleNode>()
  const moduleById = new Map<string, ModuleNode>()

  for (const mod of allModules) {
    if (!mod.file || mod.file.includes('node_modules')) continue
    const relFile = path.relative(root, mod.file)
    if (relFile.startsWith('..')) continue
    if (idMap.has(mod.file)) continue // deduplicate across environments
    let size: number | undefined
    try {
      size = fs.statSync(mod.file).size
    } catch {
      /* ignore */
    }
    const node: ModuleNode = {
      id: relFile,
      file: mod.file,
      type: classify(mod.file),
      importedBy: [],
      imports: [],
      size,
    }
    idMap.set(mod.file, node)
    moduleById.set(relFile, node)
    modules.push(node)
  }

  // Build edges using Sets for O(1) dedup
  const importedBySets = new Map<ModuleNode, Set<string>>()
  for (const mod of allModules) {
    if (!mod.file) continue
    const node = idMap.get(mod.file)
    if (!node) continue
    const importsSet = new Set(node.imports)
    for (const imp of mod.importedModules) {
      const impNode = imp.file ? idMap.get(imp.file) : undefined
      if (!impNode) continue
      if (!importsSet.has(impNode.id)) {
        importsSet.add(impNode.id)
        node.imports.push(impNode.id)
      }
      let by = importedBySets.get(impNode)
      if (!by) importedBySets.set(impNode, (by = new Set(impNode.importedBy)))
      if (!by.has(node.id)) {
        by.add(node.id)
        impNode.importedBy.push(node.id)
      }
    }
  }

  // Detect cycles (DFS), push/pop path buffer to avoid array copies
  const cycles: string[][] = []
  const visited = new Set<string>()
  const stack = new Set<string>()
  const pathBuf: string[] = []
  function dfs(id: string) {
    if (stack.has(id)) {
      const cycleStart = pathBuf.indexOf(id)
      if (cycleStart >= 0) {
        const cycle = pathBuf.slice(cycleStart).concat(id)
        if (cycle.length > 2) cycles.push(cycle) // skip self-references
      }
      return
    }
    if (visited.has(id)) return
    visited.add(id)
    stack.add(id)
    pathBuf.push(id)
    const node = moduleById.get(id)
    if (node) for (const imp of node.imports) dfs(imp)
    pathBuf.pop()
    stack.delete(id)
  }
  for (const m of modules) dfs(m.id)

  const cyclicIds = new Set(cycles.flat())
  for (const m of modules) if (cyclicIds.has(m.id)) m.isCyclic = true

  return { modules, cycles }
}
