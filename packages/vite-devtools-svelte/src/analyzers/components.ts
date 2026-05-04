import fs from 'fs'
import path from 'path'
import type { ComponentRelation } from '../types.js'

export function analyzeComponents(root: string): ComponentRelation[] {
  const srcDir = path.join(root, 'src')
  if (!fs.existsSync(srcDir)) return []

  const svelteFiles: string[] = []
  findSvelteFiles(srcDir, svelteFiles)

  return svelteFiles.map(file => {
    const content = fs.readFileSync(file, 'utf-8')
    const imports = extractSvelteImports(content, file)
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

function extractSvelteImports(content: string, filePath: string): string[] {
  const imports: string[] = []
  const dir = path.dirname(filePath)

  // Match: import X from './Component.svelte'
  // Match: import X from '$lib/Component.svelte'
  const importRegex = /import\s+[\w{}\s,*]+\s+from\s+['"]([^'"]+\.svelte)['"]/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1]
    const resolved = resolveImportPath(importPath, dir, filePath)
    if (resolved) imports.push(resolved)
  }

  return imports
}

function resolveImportPath(importPath: string, dir: string, fromFile: string): string | null {
  // Handle $lib alias
  if (importPath.startsWith('$lib/')) {
    const root = findProjectRoot(fromFile)
    if (root) {
      const libPath = path.join(root, 'src', 'lib', importPath.slice(5))
      if (fs.existsSync(libPath)) return libPath
    }
    return null
  }

  // Relative import
  if (importPath.startsWith('.')) {
    const resolved = path.resolve(dir, importPath)
    if (fs.existsSync(resolved)) return resolved
  }

  return null
}

function findProjectRoot(filePath: string): string | null {
  let dir = path.dirname(filePath)
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  return null
}

function getComponentName(filePath: string): string {
  return path.basename(filePath, '.svelte')
}
