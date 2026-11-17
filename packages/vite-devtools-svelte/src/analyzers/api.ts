import fs from 'node:fs'
import path from 'node:path'

import { parseSync } from 'vite'
import type { ViteDevServer } from 'vite'

import type { ApiEndpoint, RouteInfo } from '../types.js'

/** The request handlers a SvelteKit `+server` file may export, in display order. */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** What a module exports by name, and the specifiers it re-exports wholesale (`export * from`). */
export interface ModuleExports {
  names: Set<string>
  stars: string[]
  /**
   * Whether the module has any `import` / `export`. One without may be
   * CommonJS (`exports.GET = …`), whose exports no ESM parse sees.
   */
  esm: boolean
}

type Program = ReturnType<typeof parseSync>['program']
type ExportDeclaration = Extract<Program['body'][number], { type: 'ExportNamedDeclaration' }>
type VariableDeclaration = Extract<
  NonNullable<ExportDeclaration['declaration']>,
  { type: 'VariableDeclaration' }
>
type BindingPattern = VariableDeclaration['declarations'][number]['id']
type ArrayElement = NonNullable<
  Extract<BindingPattern, { type: 'ArrayPattern' }>['elements'][number]
>
/** A pattern, or the `...rest` an array pattern may end with. */
type Binding = BindingPattern | ArrayElement

/** Every name a binding pattern declares: `a`, `{ a, b: c, ...d }`, `[e = 1, ...f]`. */
function bindingNames(pattern: Binding, out: Set<string>): void {
  switch (pattern.type) {
    case 'Identifier':
      out.add(pattern.name)
      break
    case 'ObjectPattern':
      for (const p of pattern.properties) {
        bindingNames(p.type === 'RestElement' ? p.argument : p.value, out)
      }
      break
    case 'ArrayPattern':
      for (const e of pattern.elements) if (e) bindingNames(e, out)
      break
    case 'AssignmentPattern':
      bindingNames(pattern.left, out)
      break
    case 'RestElement':
      bindingNames(pattern.argument, out)
      break
  }
}

/**
 * What a `+server` module exports. Parsed, not substring-matched: the old
 * `content.includes('export const GET')` also matched `export const GETTER`
 * and commented-out code, and missed `export { handler as GET }`. Covers
 * declarations (destructuring included), export lists and re-exports;
 * `export * from` is reported in `stars` for the caller to follow. Null
 * when the module cannot be parsed.
 */
export function moduleExports(code: string, filename: string): ModuleExports | null {
  // The language (js / ts) follows the file extension.
  const { program, module, errors } = parseSync(filename, code)
  if (errors.length > 0) return null
  const names = new Set<string>()
  const stars: string[] = []
  for (const node of program.body) {
    // Type-only exports (`export type { GET }`, `export type * from`) have no runtime value.
    if (
      (node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') &&
      node.exportKind === 'type'
    ) {
      continue
    }
    if (node.type === 'ExportAllDeclaration') {
      // `export * as GET from` exports a namespace object, which SvelteKit
      // cannot call as a handler: only a bare `export *` adds names.
      if (!node.exported) stars.push(node.source.value)
      continue
    }
    if (node.type !== 'ExportNamedDeclaration') continue
    const decl = node.declaration
    if ((decl?.type === 'FunctionDeclaration' || decl?.type === 'ClassDeclaration') && decl.id) {
      names.add(decl.id.name)
    } else if (decl?.type === 'VariableDeclaration') {
      // `export declare const` is type-only (`exportKind: 'type'`), skipped above.
      for (const d of decl.declarations) bindingNames(d.id, names)
    }
    for (const spec of node.specifiers) {
      if (spec.exportKind === 'type') continue
      const exported = spec.exported
      names.add(exported.type === 'Literal' ? exported.value : exported.name)
    }
  }
  return { names, stars, esm: module.hasModuleSyntax }
}

/** Resolve an import specifier from `importer` to a file, or null when it is not one. */
export type ResolveFile = (specifier: string, importer: string) => Promise<string | null>

const EXTENSIONS = ['', '.ts', '.js', '/index.ts', '/index.js']

/**
 * Resolution without a dev server: relative specifiers only, with the
 * extensions SvelteKit modules use. Aliases (`$lib`) and packages need
 * the dev server's resolver.
 */
// oxlint-disable-next-line require-await -- async so a throw becomes a rejection the caller catches
export const resolveRelative: ResolveFile = async (specifier, importer) => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
  const target = path.resolve(path.dirname(importer), specifier)
  const candidates = EXTENSIONS.map(ext => target + ext)
  // TypeScript sources import `./x.js` for `./x.ts`.
  if (target.endsWith('.js')) candidates.push(`${target.slice(0, -'.js'.length)}.ts`)
  return candidates.find(isFile) ?? null
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Resolution through the dev server's plugins (SSR), so aliases such as
 * `$lib` resolve as in the app; {@link resolveRelative} while there is no
 * server. Virtual modules and externals are not files to parse.
 */
export function serverResolver(server: () => ServerEnvironments | undefined): ResolveFile {
  return async (specifier, importer) => {
    const ssr = server()?.environments.ssr
    if (!ssr) return resolveRelative(specifier, importer)
    const resolved = await ssr.pluginContainer.resolveId(specifier, importer)
    return resolved && !resolved.external && path.isAbsolute(resolved.id) ? resolved.id : null
  }
}

/** The part of a dev server {@link serverResolver} uses. */
export interface ServerEnvironments {
  environments: Partial<
    Record<'ssr', Pick<ViteDevServer['environments'][string], 'pluginContainer'>>
  >
}

/** Longest `export *` chain followed; deeper chains count as unknown. */
export const MAX_DEPTH = 8
/** Larger modules are not read: no handler barrel is this big, and parsing blocks the server. */
export const MAX_MODULE_BYTES = 2 * 1024 * 1024

/**
 * Reads and parses each module once per analysis, however many endpoints
 * re-export it (a shared `$lib` barrel otherwise parses once per endpoint).
 * Null for a module that cannot be read or parsed, or is over
 * {@link MAX_MODULE_BYTES}.
 */
export type ModuleCache = Map<string, Promise<ModuleExports | null>>

function loadExports(module: string, cache: ModuleCache): Promise<ModuleExports | null> {
  let entry = cache.get(module)
  if (!entry) {
    entry = readExports(module)
    cache.set(module, entry)
  }
  return entry
}

async function readExports(module: string): Promise<ModuleExports | null> {
  try {
    if ((await fs.promises.stat(module)).size > MAX_MODULE_BYTES) return null
    return moduleExports(await fs.promises.readFile(module, 'utf-8'), module)
  } catch {
    return null // vanished or unreadable
  }
}

/**
 * The names `file` exports, following `export * from` through `resolve`.
 * `complete` is false when part of it could not be read: a module
 * {@link ModuleCache} has no exports for, a re-exported module without
 * ESM syntax (perhaps CommonJS), a specifier that does not resolve to a
 * file, or a chain deeper than {@link MAX_DEPTH}.
 */
export async function collectExports(
  file: string,
  resolve: ResolveFile,
  cache: ModuleCache = new Map(),
): Promise<{ names: Set<string>; complete: boolean }> {
  const names = new Set<string>()
  const seen = new Set<string>()
  let complete = true
  async function visit(module: string, depth: number): Promise<void> {
    if (seen.has(module)) return
    seen.add(module)
    const exports = await loadExports(module, cache)
    // `export *` from a module without ESM syntax: perhaps CommonJS, exports unknown.
    // (The endpoint itself may be empty: it then exports nothing.)
    if (!exports || (depth > 0 && !exports.esm)) {
      complete = false
      return
    }
    // A star never re-exports `default`; nor does it matter for handlers.
    for (const name of exports.names) names.add(name)
    await Promise.all(
      exports.stars.map(async specifier => {
        let target: string | null = null
        if (depth < MAX_DEPTH) {
          // A resolver that throws (a plugin rejecting the specifier) leaves
          // this star unknown; it must not fail every endpoint.
          target = await resolve(specifier, module).catch(() => null)
        }
        if (target) await visit(target, depth + 1)
        else complete = false
      }),
    )
  }
  await visit(file, 0)
  return { names, complete }
}

/**
 * List `+server` endpoints and the HTTP methods they export. A `fallback`
 * handler answers every method, and SvelteKit answers `HEAD` from `GET`.
 * `complete` is false when some exports could not be followed (see
 * {@link collectExports}): `methods` may then miss handlers. `url` is the
 * route path under the dev server's `base` (SvelteKit's `paths.base`), the
 * path the app actually serves.
 */
export async function analyzeApiEndpoints(
  routes: RouteInfo[],
  base = '/',
  resolve: ResolveFile = resolveRelative,
): Promise<ApiEndpoint[]> {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  const cache: ModuleCache = new Map()
  const endpoints = routes.map(async (route): Promise<ApiEndpoint | null> => {
    const serverFile = route.files.find(f => f.type === 'endpoint')
    if (!serverFile) return null
    const { names, complete } = await collectExports(serverFile.path, resolve, cache)
    const methods: string[] = names.has('fallback')
      ? [...HTTP_METHODS]
      : HTTP_METHODS.filter(m => names.has(m) || (m === 'HEAD' && names.has('GET')))
    return {
      route: route.id,
      path: route.path,
      url: prefix + route.path,
      methods,
      complete,
      file: serverFile.path,
    }
  })
  return (await Promise.all(endpoints)).filter(e => e !== null)
}
