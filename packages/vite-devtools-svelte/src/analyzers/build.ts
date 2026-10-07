import fs from 'node:fs'
import path from 'node:path'

import type { BuildAnalysis, BuildChunk } from '../types.js'

const WEB_EXTENSIONS = new Set(['.js', '.css', '.html'])

/** Scan common SvelteKit build output directories for emitted web assets. */
export function analyzeBuild(root: string): BuildAnalysis {
  const chunks: BuildChunk[] = []
  const dirs = [
    path.resolve(root, '.svelte-kit/output'),
    path.resolve(root, 'build/client'),
    path.resolve(root, 'build'),
  ]
  const walkDir = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walkDir(full)
        continue
      }
      if (!WEB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      chunks.push({
        name: entry.name,
        file: path.relative(root, full),
        size: fs.statSync(full).size,
        modules: [],
        isEntry: entry.name.includes('index') || entry.name.includes('start'),
      })
    }
  }
  for (const dir of dirs) {
    try {
      walkDir(dir)
    } catch {
      /* directory doesn't exist or not readable */
    }
  }
  chunks.sort((a, b) => b.size - a.size)
  return { chunks, totalSize: chunks.reduce((s, c) => s + c.size, 0), timestamp: Date.now() }
}
