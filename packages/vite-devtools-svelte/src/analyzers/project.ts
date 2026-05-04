import fs from 'fs'
import path from 'path'
import type { ProjectInfo } from '../types.js'

const CACHE_TTL_MS = 5000
let _cachedResult: ProjectInfo | null = null
let _cachedRoot: string | null = null
let _cachedAt = 0

export function analyzeProject(root: string): ProjectInfo {
  const now = Date.now()
  if (_cachedResult && _cachedRoot === root && now - _cachedAt < CACHE_TTL_MS) {
    return _cachedResult
  }
  const result = _analyzeProjectUncached(root)
  _cachedResult = result
  _cachedRoot = root
  _cachedAt = now
  return result
}

function _analyzeProjectUncached(root: string): ProjectInfo {
  const pkgPath = path.join(root, 'package.json')
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) : {}

  const deps = pkg.dependencies || {}
  const devDeps = pkg.devDependencies || {}

  return {
    name: pkg.name || path.basename(root),
    version: pkg.version || '0.0.0',
    svelteVersion:
      getInstalledVersion(root, 'svelte') || deps.svelte || devDeps.svelte || 'unknown',
    sveltekitVersion:
      getInstalledVersion(root, '@sveltejs/kit') ||
      deps['@sveltejs/kit'] ||
      devDeps['@sveltejs/kit'] ||
      'unknown',
    viteVersion: getInstalledVersion(root, 'vite') || deps.vite || devDeps.vite || 'unknown',
    dependencies: deps,
    devDependencies: devDeps,
    routesDir: findRoutesDir(root),
    staticDir: findStaticDir(root),
  }
}

function getInstalledVersion(root: string, pkg: string): string | null {
  try {
    const pkgJsonPath = path.join(root, 'node_modules', pkg, 'package.json')
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      return pkgJson.version
    }
  } catch {
    // ignore
  }
  return null
}

function findRoutesDir(root: string): string {
  const candidates = [path.join(root, 'src', 'routes'), path.join(root, 'src', 'pages')]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return path.join(root, 'src', 'routes')
}

function findStaticDir(root: string): string {
  const candidates = [path.join(root, 'static'), path.join(root, 'public')]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return path.join(root, 'static')
}
