import fs from 'fs'
import path from 'path'
import type { AssetInfo } from '../types.js'

export const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.html': 'text/html',
}

export function analyzeAssets(staticDir: string): AssetInfo[] {
  if (!fs.existsSync(staticDir)) return []

  const assets: AssetInfo[] = []
  scanDir(staticDir, staticDir, assets)
  return assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function scanDir(dir: string, rootDir: string, assets: AssetInfo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      scanDir(fullPath, rootDir, assets)
      continue
    }

    // Skip hidden files
    if (entry.name.startsWith('.')) continue

    const stat = fs.statSync(fullPath)
    const ext = path.extname(entry.name).toLowerCase()

    assets.push({
      name: entry.name,
      path: fullPath,
      relativePath: path.relative(rootDir, fullPath),
      size: stat.size,
      type: MIME_TYPES[ext] || 'application/octet-stream',
      mtime: stat.mtimeMs,
    })
  }
}
