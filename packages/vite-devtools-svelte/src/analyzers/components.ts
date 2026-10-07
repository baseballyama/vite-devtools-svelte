import fs from 'node:fs'
import path from 'node:path'

import type { ComponentRelation } from '../types.js'
import { parseScripts } from './script.js'

type ImportCache = Map<string, { mtimeMs: number; size: number; specifiers: string[] }>

/**
 * `.svelte` specifiers per component file of the last analysis, reused while
 * the file's mtime and size are unchanged: parsing every component again on
 * each request is what the analysis spends most on.
 */
let importCache: ImportCache = new Map()

export function analyzeComponents(root: string): ComponentRelation[] {
  const srcDir = path.join(root, 'src')
  if (!fs.existsSync(srcDir)) return []

  const svelteFiles: string[] = []
  findSvelteFiles(srcDir, svelteFiles)

  const cache: ImportCache = new Map()
  const relations = svelteFiles.map(file => {
    const imports = new Set<string>() // a component imported twice is one relation
    for (const specifier of cachedImports(file, cache)) {
      const resolved = resolveImportPath(specifier, path.dirname(file), root)
      if (resolved) imports.add(path.relative(root, resolved))
    }
    return {
      file: path.relative(root, file),
      name: path.basename(file, '.svelte'),
      imports: [...imports],
    }
  })
  importCache = cache // files no longer found drop out
  return relations
}

function cachedImports(file: string, cache: ImportCache): string[] {
  let entry
  try {
    const { mtimeMs, size } = fs.statSync(file)
    entry = importCache.get(file)
    if (entry?.mtimeMs !== mtimeMs || entry.size !== size) {
      entry = { mtimeMs, size, specifiers: componentImports(fs.readFileSync(file, 'utf-8')) }
    }
  } catch {
    return [] // unreadable (permissions, removed meanwhile): listed without imports
  }
  cache.set(file, entry)
  return entry.specifiers
}

function findSvelteFiles(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue
      findSvelteFiles(fullPath, files)
    } else if (entry.name.endsWith('.svelte')) {
      files.push(fullPath)
    }
  }
}

/**
 * `.svelte` specifiers the component's scripts import, re-export or
 * `import()` (with a literal), read from the parser's module summary:
 * commented-out imports and look-alikes in strings or markup do not count.
 * Type-only imports are no render relation.
 */
function componentImports(content: string): string[] {
  const specifiers: string[] = []
  if (!content.includes('.svelte')) return specifiers
  for (const { code, result } of parseScripts(content)) {
    const { module } = result
    for (const { moduleRequest, entries } of module.staticImports) {
      if (entries.length === 0 || entries.some(e => !e.isType)) specifiers.push(moduleRequest.value)
    }
    for (const { entries } of module.staticExports) {
      for (const { moduleRequest, isType } of entries) {
        if (moduleRequest && !isType) specifiers.push(moduleRequest.value)
      }
    }
    for (const { moduleRequest } of module.dynamicImports) {
      const literal = stringLiteral(code.slice(moduleRequest.start, moduleRequest.end))
      if (literal !== undefined) specifiers.push(literal)
    }
  }
  return specifiers.filter(s => s.endsWith('.svelte'))
}

/** The value of a quoted string without escapes or interpolation, else undefined. */
function stringLiteral(expression: string): string | undefined {
  const quote = expression[0]
  if (quote !== '"' && quote !== "'" && quote !== '`') return undefined
  const value = expression.slice(1, -1)
  const plain =
    expression.length >= 2 &&
    expression.endsWith(quote) &&
    !value.includes(quote) &&
    !value.includes('\\') &&
    !(quote === '`' && value.includes('${'))
  return plain ? value : undefined
}

function resolveImportPath(importPath: string, dir: string, root: string): string | null {
  // $lib alias (SvelteKit 2) or the `#lib/*` subpath import SvelteKit 3 uses
  // instead, both conventionally mapped to <root>/src/lib. Resolved from the
  // analysed root: the nearest package.json above the importing file (used
  // before) may belong to a nested package under src/.
  if (importPath.startsWith('$lib/') || importPath.startsWith('#lib/')) {
    const libPath = path.join(root, 'src', 'lib', importPath.slice(5))
    return fs.existsSync(libPath) ? libPath : null
  }
  if (importPath.startsWith('.')) {
    const resolved = path.resolve(dir, importPath)
    if (fs.existsSync(resolved)) return resolved
  }
  return null
}
