import fs from 'node:fs'
import path from 'node:path'

import type { ComponentRelation } from '../types.js'

export function analyzeComponents(root: string): ComponentRelation[] {
  const srcDir = path.join(root, 'src')
  if (!fs.existsSync(srcDir)) return []

  const svelteFiles: string[] = []
  findSvelteFiles(srcDir, svelteFiles)

  return svelteFiles.map(file => {
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf-8')
    } catch {
      /* unreadable (permissions, removed meanwhile): listed without imports */
    }
    const imports = extractSvelteImports(content, file, root)
    const name = getComponentName(file)

    return {
      file: path.relative(root, file),
      name,
      imports: imports.map(i => path.relative(root, i)),
    }
  })
}

function findSvelteFiles(dir: string, files: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue
      findSvelteFiles(fullPath, files)
    } else if (entry.name.endsWith('.svelte')) {
      files.push(fullPath)
    }
  }
}

function extractSvelteImports(content: string, filePath: string, root: string): string[] {
  const imports = new Set<string>() // a component imported twice is one relation
  const dir = path.dirname(filePath)

  // Match: import X from './Component.svelte'
  // Match: import X from '$lib/Component.svelte' (SvelteKit 2) or '#lib/…' (SvelteKit 3)
  const importRegex = /import\s+[\w${}\s,*]+\s+from\s+['"]([^'"]+\.svelte)['"]/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1]!
    const resolved = resolveImportPath(importPath, dir, root)
    if (resolved) imports.add(resolved)
  }

  return [...imports]
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

  // Relative import
  if (importPath.startsWith('.')) {
    const resolved = path.resolve(dir, importPath)
    if (fs.existsSync(resolved)) return resolved
  }

  return null
}

function getComponentName(filePath: string): string {
  return path.basename(filePath, '.svelte')
}
