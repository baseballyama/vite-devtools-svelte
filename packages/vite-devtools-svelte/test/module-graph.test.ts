import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Module graph from Vite's module nodes: filtering, deduplication, edges and
 * cycle detection, checked against a transitive-closure reference.
 */
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { buildModuleGraph } from '../src/analyzers/module-graph.js'
import type { GraphModuleLike } from '../src/analyzers/module-graph.js'

const ROOT = path.join(os.tmpdir(), 'sdt-mg-root')

interface Mod extends GraphModuleLike {
  importedModules: Set<Mod>
}
const mod = (file: string | null): Mod => ({ file, importedModules: new Set() })
const at = (rel: string) => mod(path.join(ROOT, rel))
function link(from: Mod, ...to: Mod[]) {
  for (const t of to) from.importedModules.add(t)
}

describe('buildModuleGraph: which modules are nodes', () => {
  it.each<[label: string, file: string | null, kept: boolean]>([
    ['project file', path.join(ROOT, 'src/a.ts'), true],
    ['no file (virtual module)', null, false],
    ['empty file', '', false],
    ['node_modules dependency', path.join(ROOT, 'node_modules/dep/index.js'), false],
    ['nested node_modules', path.join(ROOT, 'packages/x/node_modules/y.js'), false],
    ['name containing node_modules', path.join(ROOT, 'src/node_modules_utils.ts'), true],
    ['outside the root', path.join(path.dirname(ROOT), 'other/a.ts'), false],
    ['sibling dir sharing the prefix', `${ROOT}-other/a.ts`, false],
    ['dot-dot prefixed name inside the root', path.join(ROOT, '..cache/a.ts'), true],
    ['the root itself', ROOT, false],
  ])('%s → kept: %s', (_label, file, kept) => {
    const graph = buildModuleGraph(ROOT, [mod(file)])
    expect(graph.modules.length > 0).toBe(kept)
  })

  it.each([
    ['a.svelte', 'svelte'],
    ['a.ts', 'ts'],
    ['a.js', 'js'],
    ['a.css', 'css'],
    ['a.SVELTE', 'svelte'],
    ['a.mjs', 'other'],
    ['a.json', 'other'],
    ['noext', 'other'],
  ])('%s is typed %s', (file, type) => {
    expect(buildModuleGraph(ROOT, [at(file)]).modules[0]!.type).toBe(type)
  })

  it('ids are root-relative; size comes from disk when readable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-mg-'))
    try {
      fs.writeFileSync(path.join(root, 'a.ts'), '12345')
      const graph = buildModuleGraph(root, [
        mod(path.join(root, 'a.ts')),
        mod(path.join(root, 'gone.ts')),
      ])
      expect(graph.modules.map(m => [m.id, m.size])).toEqual([
        ['a.ts', 5],
        ['gone.ts', undefined],
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('buildModuleGraph: edges', () => {
  it('merges variants of one file (environments, ?query modules) into one node', () => {
    const a = at('src/a.svelte')
    const aStyle = at('src/a.svelte') // `a.svelte?svelte&type=style&lang.css` has the same file
    const b = at('src/b.ts')
    const c = at('src/c.ts')
    link(a, aStyle, b)
    link(aStyle, c)
    const graph = buildModuleGraph(ROOT, [a, aStyle, b, c, { ...a }])
    const byId = Object.fromEntries(graph.modules.map(m => [m.id, m]))
    expect(graph.modules).toHaveLength(3)
    // the import of its own style variant is not a self-import
    expect(byId['src/a.svelte']!.imports).toEqual(['src/b.ts', 'src/c.ts'])
    expect(byId['src/a.svelte']!.isCyclic).toBeUndefined()
    expect(graph.cycles).toEqual([])
  })

  it('drops imports of filtered modules and deduplicates repeated edges', () => {
    const a = at('a.ts')
    const b = at('b.ts')
    const dep = mod(path.join(ROOT, 'node_modules/d/index.js'))
    const virtual = mod(null)
    link(a, b, dep, virtual)
    const a2 = at('a.ts')
    link(a2, b)
    const graph = buildModuleGraph(ROOT, [a, b, dep, virtual, a2])
    const byId = Object.fromEntries(graph.modules.map(m => [m.id, m]))
    expect(byId['a.ts']!.imports).toEqual(['b.ts'])
    expect(byId['b.ts']!.importedBy).toEqual(['a.ts'])
  })

  it.each<[label: string, edges: Array<[number, number]>, cycles: number[][]]>([
    ['self-loop is not a cycle', [[0, 0]], []],
    [
      'two-module cycle',
      [
        [0, 1],
        [1, 0],
      ],
      [[0, 1, 0]],
    ],
    [
      'three-module cycle',
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      [[0, 1, 2, 0]],
    ],
    [
      'chain without cycle',
      [
        [0, 1],
        [1, 2],
      ],
      [],
    ],
    [
      'diamond without cycle',
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 3],
      ],
      [],
    ],
    // c (2) closes its cycle through b, which DFS had already visited: the
    // former DFS listed only [a, b, a] and left c unmarked.
    [
      'cycle through a visited module',
      [
        [0, 1],
        [1, 0],
        [0, 2],
        [2, 1],
      ],
      [
        [0, 1, 0],
        [2, 1, 0, 2],
      ],
    ],
    [
      'two separate cycles',
      [
        [0, 1],
        [1, 0],
        [2, 3],
        [3, 2],
      ],
      [
        [0, 1, 0],
        [2, 3, 2],
      ],
    ],
  ])('%s', (_label, edges, cycles) => {
    const mods = [0, 1, 2, 3].map(i => at(`m${i}.ts`))
    for (const [from, to] of edges) link(mods[from]!, mods[to]!)
    const graph = buildModuleGraph(ROOT, mods)
    expect(graph.cycles).toEqual(cycles.map(c => c.map(i => `m${i}.ts`)))
    const cyclic = new Set(cycles.flat())
    expect(graph.modules.map(m => m.isCyclic === true)).toEqual(
      [0, 1, 2, 3].map(i => cyclic.has(i)),
    )
  })

  // 20k frames is past V8's default stack (~11k for a simple recursive walk).
  it('handles import chains far deeper than the call stack', { timeout: 30_000 }, () => {
    const n = 20_000
    const mods = Array.from({ length: n }, (_, i) => at(`m${i}.ts`))
    for (let i = 0; i < n - 1; i++) link(mods[i]!, mods[i + 1]!)
    link(mods[n - 1]!, mods[0]!)
    const graph = buildModuleGraph(ROOT, mods)
    expect(graph.cycles).toHaveLength(1)
    expect(graph.cycles[0]).toHaveLength(n + 1)
    expect(graph.modules.every(m => m.isCyclic)).toBe(true)
  })
})

const id = (i: number) => `m${i}.ts`

/** Reference: `reach[i][j]` = j is reachable from i over at least one non-self edge. */
function reachability(n: number, edges: Array<[number, number]>): boolean[][] {
  const reach = Array.from({ length: n }, () => Array.from({ length: n }, () => false))
  for (const [from, to] of edges.filter(([a, b]) => a !== b)) reach[from]![to] = true
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) reach[i]![j] = reach[i]![j]! || (reach[i]![k]! && reach[k]![j]!)
    }
  }
  return reach
}

/** Reference: the distinct non-self imports of module i, sorted. */
function importsOf(i: number, edges: Array<[number, number]>): string[] {
  const targets = edges.filter(([a, b]) => a === i && b !== i).map(([, b]) => id(b))
  return [...new Set(targets)].toSorted()
}

describe('buildModuleGraph properties', () => {
  const graphArb = fc
    .integer({ min: 1, max: 9 })
    .chain(n =>
      fc.tuple(
        fc.constant(n),
        fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1)), { maxLength: n * 3 }),
      ),
    )

  it('matches a transitive-closure reference for edges and cycles', () => {
    fc.assert(
      fc.property(graphArb, ([n, edges]) => {
        const mods = Array.from({ length: n }, (_, i) => at(`m${i}.ts`))
        for (const [a, b] of edges) link(mods[a]!, mods[b]!)
        const graph = buildModuleGraph(ROOT, mods)
        const reach = reachability(n, edges)

        const byId = new Map(graph.modules.map(m => [m.id, m]))
        for (let i = 0; i < n; i++) {
          const m = byId.get(id(i))!
          expect(m.imports.toSorted()).toEqual(importsOf(i, edges))
          expect(new Set(m.imports).size).toBe(m.imports.length)
          for (const target of m.imports) expect(byId.get(target)!.importedBy).toContain(m.id)
          expect(m.importedBy.length).toBe(
            graph.modules.filter(o => o.imports.includes(m.id)).length,
          )
          expect(m.isCyclic === true).toBe(reach[i]![i])
        }

        const inCycles = new Set<string>()
        for (const cycle of graph.cycles) {
          expect(cycle.length).toBeGreaterThanOrEqual(3)
          expect(cycle[0]).toBe(cycle.at(-1))
          const inner = cycle.slice(0, -1)
          expect(new Set(inner).size).toBe(inner.length) // simple cycle
          for (let k = 0; k < cycle.length - 1; k++)
            expect(byId.get(cycle[k]!)!.imports).toContain(cycle[k + 1])
          for (const c of inner) inCycles.add(c)
        }
        // every module on a cycle is shown in a listed cycle, and only those
        expect([...inCycles].toSorted()).toEqual(
          graph.modules
            .filter(m => m.isCyclic)
            .map(m => m.id)
            .toSorted(),
        )
      }),
      { numRuns: 300 },
    )
  })
})
