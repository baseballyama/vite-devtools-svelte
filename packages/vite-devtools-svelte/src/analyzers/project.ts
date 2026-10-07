import fs from 'node:fs'
import path from 'node:path'

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

interface PackageJson {
  name?: string
  version?: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

/** A non-empty string, or undefined (so `??` keeps the old `||` fallbacks). */
function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(v)) return out
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
  return out
}

function readPackageJson(file: string): PackageJson {
  const raw: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {}
  const pkg = isRecord(raw) ? raw : {}
  return {
    name: nonEmpty(pkg.name),
    version: nonEmpty(pkg.version),
    dependencies: stringMap(pkg.dependencies),
    devDependencies: stringMap(pkg.devDependencies),
  }
}

function _analyzeProjectUncached(root: string): ProjectInfo {
  const pkg = readPackageJson(path.join(root, 'package.json'))
  const deps = pkg.dependencies
  const devDeps = pkg.devDependencies
  const declared = (name: string) => nonEmpty(deps[name]) ?? nonEmpty(devDeps[name])

  return {
    name: pkg.name ?? path.basename(root),
    version: pkg.version ?? '0.0.0',
    svelteVersion: getInstalledVersion(root, 'svelte') ?? declared('svelte') ?? 'unknown',
    sveltekitVersion:
      getInstalledVersion(root, '@sveltejs/kit') ?? declared('@sveltejs/kit') ?? 'unknown',
    viteVersion: getInstalledVersion(root, 'vite') ?? declared('vite') ?? 'unknown',
    dependencies: deps,
    devDependencies: devDeps,
    routesDir: findRoutesDir(root),
    staticDir: findStaticDir(root),
  }
}

function getInstalledVersion(root: string, pkg: string): string | undefined {
  try {
    const pkgJsonPath = path.join(root, 'node_modules', pkg, 'package.json')
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson: unknown = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      return isRecord(pkgJson) ? nonEmpty(pkgJson.version) : undefined
    }
  } catch {
    // ignore
  }
  return undefined
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
