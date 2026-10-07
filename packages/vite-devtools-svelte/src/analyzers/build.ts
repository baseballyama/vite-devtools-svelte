import fs from 'node:fs'
import path from 'node:path'

import type { BuildAnalysis, BuildChunk } from '../types.js'

const WEB_EXTENSIONS = new Set(['.js', '.css', '.html'])

/**
 * Scan common SvelteKit build output directories for emitted web assets.
 * Each file is counted once: `build/client` lies inside `build`, which used
 * to list (and add to `totalSize`) every client file twice. An unreadable
 * entry (e.g. a dangling symlink) is skipped instead of ending the scan of
 * its directory; directory symlinks are not followed.
 */
export function analyzeBuild(root: string): BuildAnalysis {
  const chunks: BuildChunk[] = []
  const seen = new Set<string>()
  const dirs = [
    path.resolve(root, '.svelte-kit/output'),
    path.resolve(root, 'build/client'),
    path.resolve(root, 'build'),
  ]
  const walkDir = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return // directory doesn't exist or is not readable
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walkDir(full)
        continue
      }
      if (!WEB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      let real: string
      let stat: fs.Stats
      try {
        real = fs.realpathSync(full)
        stat = fs.statSync(real)
      } catch {
        continue
      }
      if (!stat.isFile() || seen.has(real)) continue
      seen.add(real)
      chunks.push({
        name: entry.name,
        file: path.relative(root, full),
        size: stat.size,
        modules: [],
        isEntry: entry.name.includes('index') || entry.name.includes('start'),
      })
    }
  }
  for (const dir of dirs) walkDir(dir)
  chunks.sort((a, b) => b.size - a.size)
  return { chunks, totalSize: chunks.reduce((s, c) => s + c.size, 0), timestamp: Date.now() }
}
