import fs from 'node:fs'
import path from 'node:path'

import type { AssetInfo } from '../types.js'

const MIME_TYPES: Record<string, string> = {
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

/**
 * List files in the static directory. `publicBase` is the dev server's
 * public base (Vite `base`); static files are served under it, so each asset
 * gets a previewable `url` without a dedicated file-serving endpoint.
 */
export function analyzeAssets(staticDir: string, publicBase = '/'): AssetInfo[] {
  if (!fs.existsSync(staticDir)) return []

  const assets: AssetInfo[] = []
  const base = publicBase.endsWith('/') ? publicBase : `${publicBase}/`
  scanDir(staticDir, staticDir, base, assets)
  return assets.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function scanDir(dir: string, rootDir: string, base: string, assets: AssetInfo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      scanDir(fullPath, rootDir, base, assets)
      continue
    }

    // Skip hidden files
    if (entry.name.startsWith('.')) continue

    // Follows symlinks; a dangling link or one to a directory is not an asset
    // (statSync used to throw and fail the whole listing).
    let stat: fs.Stats
    try {
      stat = fs.statSync(fullPath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()

    const relativePath = path.relative(rootDir, fullPath)
    assets.push({
      name: entry.name,
      path: fullPath,
      relativePath,
      url: base + relativePath.split(path.sep).map(encodeURIComponent).join('/'),
      size: stat.size,
      type: MIME_TYPES[ext] ?? 'application/octet-stream',
      mtime: stat.mtimeMs,
    })
  }
}
