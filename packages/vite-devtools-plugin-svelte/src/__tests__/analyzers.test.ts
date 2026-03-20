import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { analyzeRoutes } from '../analyzers/routes.js'
import { analyzeAssets, MIME_TYPES } from '../analyzers/assets.js'
import { analyzeProject } from '../analyzers/project.js'
import { analyzeComponents } from '../analyzers/components.js'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')
const ROUTES_DIR = path.join(FIXTURES_DIR, 'src', 'routes')
const STATIC_DIR = path.join(FIXTURES_DIR, 'static')

// =====================================================================
// Route Analyzer
// =====================================================================

describe('analyzeRoutes', () => {
  it('should detect routes from fixture directory', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    expect(routes.length).toBeGreaterThan(0)
  })

  it('should detect the root page route', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const root = routes.find(r => r.path === '/')
    expect(root).toBeDefined()
    expect(root!.hasPage).toBe(true)
    expect(root!.hasLayout).toBe(true)
  })

  it('should detect dynamic route parameters', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const slugRoute = routes.find(r => r.path.includes(':slug'))
    expect(slugRoute).toBeDefined()
    expect(slugRoute!.params.length).toBe(1)
    expect(slugRoute!.params[0].name).toBe('slug')
    expect(slugRoute!.params[0].rest).toBe(false)
    expect(slugRoute!.params[0].optional).toBe(false)
  })

  it('should detect endpoints (server routes)', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const apiRoute = routes.find(r => r.path.includes('hello'))
    expect(apiRoute).toBeDefined()
    expect(apiRoute!.hasEndpoint).toBe(true)
  })

  it('should detect page server load files', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const slugRoute = routes.find(r => r.path.includes(':slug'))
    expect(slugRoute).toBeDefined()
    expect(slugRoute!.hasServerPage).toBe(true)
  })

  it('should return empty array for nonexistent directory', () => {
    const routes = analyzeRoutes('/nonexistent/path')
    expect(routes).toEqual([])
  })

  // --- SvelteKit route group syntax ---

  it('should handle route group syntax (auth)', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const loginRoute = routes.find(r => r.path === '/login')
    expect(loginRoute).toBeDefined()
    expect(loginRoute!.hasPage).toBe(true)
    // Group (auth) should be stripped from the URL path
    expect(loginRoute!.path).not.toContain('(auth)')
  })

  // --- Rest params ---

  it('should detect rest params [...rest]', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const docsRoute = routes.find(r => r.path.includes('*rest'))
    expect(docsRoute).toBeDefined()
    expect(docsRoute!.params.length).toBe(1)
    expect(docsRoute!.params[0].name).toBe('rest')
    expect(docsRoute!.params[0].rest).toBe(true)
    expect(docsRoute!.params[0].optional).toBe(false)
  })

  // --- Optional params ---

  it('should detect optional params [[optional]]', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const settingsRoute = routes.find(r => r.path.includes('optional'))
    expect(settingsRoute).toBeDefined()
    expect(settingsRoute!.params.length).toBe(1)
    expect(settingsRoute!.params[0].name).toBe('optional')
    expect(settingsRoute!.params[0].optional).toBe(true)
    expect(settingsRoute!.params[0].rest).toBe(false)
    // Optional params become :param? in the path
    expect(settingsRoute!.path).toContain(':optional?')
  })

  // --- Matcher params ---

  it('should detect matcher params [id=integer]', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const usersRoute = routes.find(r => r.path.includes(':id'))
    expect(usersRoute).toBeDefined()
    expect(usersRoute!.params.length).toBe(1)
    expect(usersRoute!.params[0].name).toBe('id')
    expect(usersRoute!.params[0].matcher).toBe('integer')
    expect(usersRoute!.params[0].rest).toBe(false)
    expect(usersRoute!.params[0].optional).toBe(false)
  })

  // --- Layout server ---

  it('should detect layout server load files', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const dashboardRoute = routes.find(r => r.path === '/dashboard')
    expect(dashboardRoute).toBeDefined()
    expect(dashboardRoute!.hasServerLayout).toBe(true)
  })

  // --- Universal page load ---

  it('should detect universal page load files', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const dashboardRoute = routes.find(r => r.path === '/dashboard')
    expect(dashboardRoute).toBeDefined()
    expect(dashboardRoute!.hasPageLoad).toBe(true)
  })

  // --- Multiple endpoints ---

  it('should detect multiple API endpoint routes', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const apiEndpoints = routes.filter(r => r.hasEndpoint)
    expect(apiEndpoints.length).toBeGreaterThanOrEqual(2) // hello + users
  })

  // --- Route files ---

  it('should include route files in the route info', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const root = routes.find(r => r.path === '/')
    expect(root).toBeDefined()
    expect(root!.files.length).toBeGreaterThan(0)
    const pageFile = root!.files.find(f => f.type === 'page')
    expect(pageFile).toBeDefined()
    expect(pageFile!.path).toContain('+page.svelte')
  })

  // --- Sort order ---

  it('should return routes sorted by path', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const paths = routes.map(r => r.path)
    const sorted = [...paths].sort()
    expect(paths).toEqual(sorted)
  })

  // --- Segments ---

  it('should split path into segments', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const slugRoute = routes.find(r => r.path.includes(':slug'))
    expect(slugRoute).toBeDefined()
    expect(slugRoute!.segments).toContain('blog')
    expect(slugRoute!.segments).toContain(':slug')
  })

  // --- Root path segments ---

  it('root route should have empty segments array', () => {
    const routes = analyzeRoutes(ROUTES_DIR)
    const root = routes.find(r => r.path === '/')
    expect(root).toBeDefined()
    expect(root!.segments.filter(Boolean)).toEqual([])
  })
})

// =====================================================================
// Asset Analyzer
// =====================================================================

describe('analyzeAssets', () => {
  it('should detect assets in static directory', () => {
    const assets = analyzeAssets(STATIC_DIR)
    expect(assets.length).toBeGreaterThan(0)
  })

  it('should detect favicon.png', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const favicon = assets.find(a => a.name === 'favicon.png')
    expect(favicon).toBeDefined()
    expect(favicon!.type).toBe('image/png')
    expect(favicon!.size).toBeGreaterThan(0)
  })

  it('should detect svg files', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const svg = assets.find(a => a.name === 'logo.svg')
    expect(svg).toBeDefined()
    expect(svg!.type).toBe('image/svg+xml')
  })

  it('should return empty array for nonexistent directory', () => {
    const assets = analyzeAssets('/nonexistent/path')
    expect(assets).toEqual([])
  })

  // --- Hidden files ---

  it('should skip hidden files (starting with .)', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const hidden = assets.find(a => a.name === '.hidden')
    expect(hidden).toBeUndefined()
  })

  // --- Nested directories ---

  it('should detect files in nested subdirectories', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const font = assets.find(a => a.name === 'custom.woff2')
    expect(font).toBeDefined()
    expect(font!.type).toBe('font/woff2')
    expect(font!.relativePath).toContain('fonts')
  })

  // --- JSON files ---

  it('should detect JSON files with correct MIME type', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const json = assets.find(a => a.name === 'data.json')
    expect(json).toBeDefined()
    expect(json!.type).toBe('application/json')
  })

  // --- Unknown file extension ---

  it('should use application/octet-stream for unknown extensions', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const unknown = assets.find(a => a.name === 'unknown.xyz')
    expect(unknown).toBeDefined()
    expect(unknown!.type).toBe('application/octet-stream')
  })

  // --- Sort order ---

  it('should return assets sorted by relative path', () => {
    const assets = analyzeAssets(STATIC_DIR)
    const paths = assets.map(a => a.relativePath)
    const sorted = [...paths].sort()
    expect(paths).toEqual(sorted)
  })

  // --- Full path ---

  it('should include absolute path for each asset', () => {
    const assets = analyzeAssets(STATIC_DIR)
    for (const asset of assets) {
      expect(path.isAbsolute(asset.path)).toBe(true)
      expect(fs.existsSync(asset.path)).toBe(true)
    }
  })

  // --- mtime ---

  it('should include modification time for each asset', () => {
    const assets = analyzeAssets(STATIC_DIR)
    for (const asset of assets) {
      expect(asset.mtime).toBeGreaterThan(0)
    }
  })
})

// =====================================================================
// MIME Types
// =====================================================================

describe('MIME_TYPES', () => {
  it('should have common web types', () => {
    expect(MIME_TYPES['.html']).toBe('text/html')
    expect(MIME_TYPES['.js']).toBe('text/javascript')
    expect(MIME_TYPES['.css']).toBe('text/css')
    expect(MIME_TYPES['.json']).toBe('application/json')
    expect(MIME_TYPES['.png']).toBe('image/png')
    expect(MIME_TYPES['.svg']).toBe('image/svg+xml')
  })

  it('should have image types', () => {
    expect(MIME_TYPES['.jpg']).toBe('image/jpeg')
    expect(MIME_TYPES['.jpeg']).toBe('image/jpeg')
    expect(MIME_TYPES['.gif']).toBe('image/gif')
    expect(MIME_TYPES['.webp']).toBe('image/webp')
    expect(MIME_TYPES['.avif']).toBe('image/avif')
    expect(MIME_TYPES['.ico']).toBe('image/x-icon')
  })

  it('should have font types', () => {
    expect(MIME_TYPES['.woff']).toBe('font/woff')
    expect(MIME_TYPES['.woff2']).toBe('font/woff2')
    expect(MIME_TYPES['.ttf']).toBe('font/ttf')
    expect(MIME_TYPES['.otf']).toBe('font/otf')
    expect(MIME_TYPES['.eot']).toBe('application/vnd.ms-fontobject')
  })

  it('should have media types', () => {
    expect(MIME_TYPES['.mp4']).toBe('video/mp4')
    expect(MIME_TYPES['.webm']).toBe('video/webm')
    expect(MIME_TYPES['.mp3']).toBe('audio/mpeg')
    expect(MIME_TYPES['.wav']).toBe('audio/wav')
    expect(MIME_TYPES['.ogg']).toBe('audio/ogg')
  })

  it('should have document types', () => {
    expect(MIME_TYPES['.pdf']).toBe('application/pdf')
    expect(MIME_TYPES['.xml']).toBe('application/xml')
    expect(MIME_TYPES['.txt']).toBe('text/plain')
  })
})

// =====================================================================
// Project Analyzer
// =====================================================================

describe('analyzeProject', () => {
  it('should read project info from package.json', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.name).toBe('test-fixture')
    expect(info.version).toBe('1.0.0')
  })

  it('should detect routesDir', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.routesDir).toContain('src')
    expect(info.routesDir).toContain('routes')
  })

  it('should detect staticDir', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.staticDir).toContain('static')
  })

  it('should extract dependencies', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.dependencies).toHaveProperty('svelte')
    expect(info.dependencies).toHaveProperty('@sveltejs/kit')
  })

  it('should extract devDependencies', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.devDependencies).toHaveProperty('vite')
  })

  it('should return svelte version from package.json deps', () => {
    const info = analyzeProject(FIXTURES_DIR)
    // Without node_modules, it falls back to deps
    expect(info.svelteVersion).toBe('^5.0.0')
  })

  it('should return sveltekit version from package.json deps', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.sveltekitVersion).toBe('^2.0.0')
  })

  it('should return vite version from devDependencies', () => {
    const info = analyzeProject(FIXTURES_DIR)
    expect(info.viteVersion).toBe('^8.0.0')
  })

  it('should handle missing package.json gracefully', () => {
    const info = analyzeProject('/tmp/nonexistent-project-dir-12345')
    expect(info.name).toBeDefined()
    expect(info.version).toBe('0.0.0')
    expect(info.dependencies).toEqual({})
    expect(info.devDependencies).toEqual({})
  })

  it('should return routesDir as src/routes when it exists', () => {
    const info = analyzeProject(FIXTURES_DIR)
    const expectedRoutesDir = path.join(FIXTURES_DIR, 'src', 'routes')
    expect(info.routesDir).toBe(expectedRoutesDir)
  })

  it('should return staticDir as static when it exists', () => {
    const info = analyzeProject(FIXTURES_DIR)
    const expectedStaticDir = path.join(FIXTURES_DIR, 'static')
    expect(info.staticDir).toBe(expectedStaticDir)
  })

  it('should cache results for the same root', () => {
    // First call
    const info1 = analyzeProject(FIXTURES_DIR)
    // Second call should be cached
    const info2 = analyzeProject(FIXTURES_DIR)
    expect(info1).toBe(info2) // Same reference = cached
  })

  it('should invalidate cache for different root', () => {
    const info1 = analyzeProject(FIXTURES_DIR)
    const info2 = analyzeProject('/tmp/different-root-12345')
    expect(info1).not.toBe(info2)
  })
})

// =====================================================================
// Component Analyzer
// =====================================================================

describe('analyzeComponents', () => {
  it('should find svelte component files', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    expect(components.length).toBeGreaterThan(0)
  })

  it('should detect Counter component', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    const counter = components.find(c => c.name === 'Counter')
    expect(counter).toBeDefined()
    expect(counter!.file).toContain('Counter.svelte')
  })

  it('should detect route page components', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    const page = components.find(c => c.name === '+page')
    expect(page).toBeDefined()
  })

  it('should detect layout components', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    const layout = components.find(c => c.name === '+layout')
    expect(layout).toBeDefined()
  })

  it('should detect nested components', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    const deep = components.find(c => c.name === 'DeepComponent')
    expect(deep).toBeDefined()
    expect(deep!.file).toContain('Nested')
  })

  it('should detect components with relative svelte imports', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    const deep = components.find(c => c.name === 'DeepComponent')
    expect(deep).toBeDefined()
    expect(deep!.imports.length).toBeGreaterThan(0)
    expect(deep!.imports.some(i => i.includes('Counter.svelte'))).toBe(true)
  })

  it('should detect components with $lib imports', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    const withLib = components.find(c => c.name === 'WithLibImport')
    expect(withLib).toBeDefined()
    expect(withLib!.imports.length).toBeGreaterThan(0)
    expect(withLib!.imports.some(i => i.includes('Counter.svelte'))).toBe(true)
  })

  it('should return relative file paths', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    for (const c of components) {
      expect(path.isAbsolute(c.file)).toBe(false)
      expect(c.file.startsWith('src/')).toBe(true)
    }
  })

  it('should extract component name from filename', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    for (const c of components) {
      expect(c.name).not.toContain('.svelte')
      expect(c.name.length).toBeGreaterThan(0)
    }
  })

  it('should return empty array when src directory does not exist', () => {
    const components = analyzeComponents('/nonexistent/path')
    expect(components).toEqual([])
  })

  it('should not include node_modules files', () => {
    const components = analyzeComponents(FIXTURES_DIR)
    for (const c of components) {
      expect(c.file).not.toContain('node_modules')
    }
  })
})
