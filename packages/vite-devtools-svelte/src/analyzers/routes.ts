import fs from 'fs'
import path from 'path'
import type { RouteInfo, ParamInfo, RouteFile } from '../types.js'

export function analyzeRoutes(routesDir: string): RouteInfo[] {
  if (!fs.existsSync(routesDir)) return []

  const routes: RouteInfo[] = []
  scanDirectory(routesDir, routesDir, routes)
  return routes.sort((a, b) => a.path.localeCompare(b.path))
}

function scanDirectory(dir: string, rootDir: string, routes: RouteInfo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  const files: RouteFile[] = []
  let hasRouteFiles = false

  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanDirectory(path.join(dir, entry.name), rootDir, routes)
      continue
    }

    const routeFile = classifyFile(entry.name, path.join(dir, entry.name))
    if (routeFile) {
      files.push(routeFile)
      hasRouteFiles = true
    }
  }

  if (hasRouteFiles) {
    const relativePath = path.relative(rootDir, dir)
    const routePath = buildRoutePath(relativePath)
    const params = extractParams(relativePath)

    routes.push({
      id: relativePath || '/',
      path: routePath,
      pattern: routePath,
      segments: routePath.split('/').filter(Boolean),
      hasPage: files.some(f => f.type === 'page'),
      hasLayout: files.some(f => f.type === 'layout'),
      hasServerPage: files.some(f => f.type === 'page-load-server'),
      hasServerLayout: files.some(f => f.type === 'layout-load-server'),
      hasEndpoint: files.some(f => f.type === 'endpoint'),
      hasPageLoad: files.some(f => f.type === 'page-load'),
      hasLayoutLoad: files.some(f => f.type === 'layout-load'),
      params,
      files,
    })
  }
}

function classifyFile(name: string, fullPath: string): RouteFile | null {
  const map: Record<string, RouteFile['type']> = {
    '+page.svelte': 'page',
    '+layout.svelte': 'layout',
    '+page.server.ts': 'page-load-server',
    '+page.server.js': 'page-load-server',
    '+layout.server.ts': 'layout-load-server',
    '+layout.server.js': 'layout-load-server',
    '+page.ts': 'page-load',
    '+page.js': 'page-load',
    '+layout.ts': 'layout-load',
    '+layout.js': 'layout-load',
    '+server.ts': 'endpoint',
    '+server.js': 'endpoint',
    '+error.svelte': 'error',
  }

  const type = map[name]
  if (!type) return null
  return { type, path: fullPath }
}

function buildRoutePath(relativePath: string): string {
  if (!relativePath) return '/'

  const parts = relativePath.split(path.sep)
  const pathParts = parts.map(part => {
    // SvelteKit group syntax: (group) -> ignored in URL
    if (part.startsWith('(') && part.endsWith(')')) return null

    // Dynamic params: [param] -> :param
    if (part.startsWith('[') && part.endsWith(']')) {
      const inner = part.slice(1, -1)
      if (inner.startsWith('...')) return `*${inner.slice(3)}`
      if (inner.startsWith('[') && inner.endsWith(']')) return `:${inner.slice(1, -1)}?`
      return `:${inner}`
    }

    return part
  })

  return '/' + pathParts.filter(Boolean).join('/')
}

function extractParams(relativePath: string): ParamInfo[] {
  if (!relativePath) return []

  const params: ParamInfo[] = []
  const parts = relativePath.split(path.sep)

  for (const part of parts) {
    if (!part.startsWith('[') || !part.endsWith(']')) continue

    const inner = part.slice(1, -1)

    if (inner.startsWith('...')) {
      params.push({ name: inner.slice(3), optional: false, rest: true })
    } else if (inner.startsWith('[') && inner.endsWith(']')) {
      params.push({ name: inner.slice(1, -1), optional: true, rest: false })
    } else {
      const matcherSplit = inner.split('=')
      params.push({
        name: matcherSplit[0],
        optional: false,
        rest: false,
        matcher: matcherSplit[1],
      })
    }
  }

  return params
}
