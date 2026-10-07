import fs from 'node:fs'
import path from 'node:path'

import type { ProjectInfo } from '../types.js'

const CACHE_TTL_MS = 5000
let cache: { root: string; at: number; info: ProjectInfo } | undefined

/** Project metadata, cached for {@link CACHE_TTL_MS} per root (every RPC derives from it). */
export function analyzeProject(root: string): ProjectInfo {
  const now = Date.now()
  if (cache?.root !== root || now - cache.at >= CACHE_TTL_MS) {
    cache = { root, at: now, info: analyzeProjectUncached(root) }
  }
  return cache.info
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
  let raw: unknown = {}
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    // Missing, unreadable or invalid (e.g. mid-edit): every RPC derives from
    // this analysis, so a syntax error used to break all panels at once.
  }
  const pkg = isRecord(raw) ? raw : {}
  return {
    name: nonEmpty(pkg.name),
    version: nonEmpty(pkg.version),
    dependencies: stringMap(pkg.dependencies),
    devDependencies: stringMap(pkg.devDependencies),
  }
}

function analyzeProjectUncached(root: string): ProjectInfo {
  const pkg = readPackageJson(path.join(root, 'package.json'))
  const deps = pkg.dependencies
  const devDeps = pkg.devDependencies
  // installed, else declared
  const versionOf = (name: string) =>
    getInstalledVersion(root, name) ?? nonEmpty(deps[name]) ?? nonEmpty(devDeps[name]) ?? 'unknown'

  return {
    name: pkg.name ?? path.basename(root),
    version: pkg.version ?? '0.0.0',
    svelteVersion: versionOf('svelte'),
    sveltekitVersion: versionOf('@sveltejs/kit'),
    viteVersion: versionOf('vite'),
    dependencies: deps,
    devDependencies: devDeps,
    routesDir: firstExisting(root, 'src/routes', 'src/pages'),
    staticDir: firstExisting(root, 'static', 'public'),
  }
}

function getInstalledVersion(root: string, pkg: string): string | undefined {
  try {
    const pkgJson: unknown = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf-8'),
    )
    return isRecord(pkgJson) ? nonEmpty(pkgJson.version) : undefined
  } catch {
    return undefined // not installed, or an unreadable manifest
  }
}

/** The first of `dirs` (under `root`) that exists, else the first. */
function firstExisting(root: string, ...dirs: string[]): string {
  const paths = dirs.map(d => path.join(root, d))
  return paths.find(p => fs.existsSync(p)) ?? paths[0]!
}
