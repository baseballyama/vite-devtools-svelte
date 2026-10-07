import path from 'node:path'

import { parseSync } from 'vite'

import type { LoadProfile } from '../types.js'

/** Server-side hook the profiled `load` wrappers report to (set by the plugin on the dev server). */
export const LOAD_RECORDER = '__svelte_devtools_record_load'

const LOAD_FILES: Record<string, LoadProfile['type']> = {
  '+page.server.ts': 'server',
  '+page.server.js': 'server',
  '+layout.server.ts': 'server',
  '+layout.server.js': 'server',
  '+page.ts': 'universal',
  '+page.js': 'universal',
  '+layout.ts': 'universal',
  '+layout.js': 'universal',
}

/**
 * The route id of a load file: its directory under `<root>/src/routes`, or
 * under the first `routes` directory on its path when it lies elsewhere
 * (a custom routes dir); `/` when there is none.
 */
function routeOf(file: string, root: string): string {
  const dir = file.slice(0, file.lastIndexOf('/'))
  const routesDir = path.posix.join(root, 'src/routes')
  if (dir === routesDir || dir.startsWith(`${routesDir}/`)) {
    return dir.slice(routesDir.length) || '/'
  }
  const segments = dir.split('/')
  const i = segments.indexOf('routes')
  return i === -1 ? '/' : `/${segments.slice(i + 1).join('/')}`
}

/**
 * Wrap the exported `load` of a SvelteKit load file (`+page.ts`,
 * `+layout.server.js`, …) so each call reports its duration and data size,
 * or `null` when `id` is not a load file or declares no exported `load`.
 *
 * Only the `export` keyword is removed (the local binding stays, so the
 * module's own references keep the original) and a profiled wrapper is
 * exported as `load` instead; line numbers are unchanged.
 */
export function profileLoad(code: string, id: string, root: string): string | null {
  // Cheap checks first: this runs for every module the dev server serves.
  const type = LOAD_FILES[id.slice(id.lastIndexOf('/') + 1)]
  if (!type || id.includes('node_modules') || !code.includes('load')) return null
  // The module record only: oxc builds it natively, without materialising
  // an AST in JS.
  const { module, errors } = parseSync(id, code)
  if (errors.length > 0) return null
  const stmt = module.staticExports.find(s => s.entries.some(e => e.exportName.name === 'load'))
  const entry = stmt?.entries.find(e => e.exportName.name === 'load')
  // Declaration exports only: their entries span the declaration (to the
  // statement's end); `export { load }` / `export … from` are left alone.
  if (!stmt || entry?.localName.name !== 'load' || entry.end !== stmt.end) return null
  // Names the stripped `export` covered besides `load`, exported again.
  const others = stmt.entries.map(e => e.localName.name!).filter(n => n !== 'load')
  const local = code.slice(0, stmt.start) + code.slice(entry.start)
  return local + profiledExport(others, routeOf(id, root), id, type)
}

// Measuring must never change what load does: a result JSON can't encode (a
// universal load may return BigInts, cycles, class instances…) is recorded
// with size 0 instead of failing the load, and a recorder failure is
// swallowed. A load that throws (including SvelteKit's `redirect()` /
// `error()`) rethrows unchanged, unrecorded.
function profiledExport(
  others: string[],
  route: string,
  file: string,
  type: LoadProfile['type'],
): string {
  const args = [route, file, type].map(v => JSON.stringify(v)).join(', ')
  return `${others.length > 0 ? `\nexport { ${others.join(', ')} };` : ''}
const __profiled_load = async (event) => {
  const __start = performance.now();
  const __result = await load(event);
  try {
    const __duration = performance.now() - __start;
    let __dataSize = 0;
    try { __dataSize = JSON.stringify(__result || {}).length; } catch {}
    if (typeof globalThis.${LOAD_RECORDER} === 'function') {
      globalThis.${LOAD_RECORDER}(${args}, __duration, __dataSize);
    }
  } catch {}
  return __result;
};
export { __profiled_load as load };
`
}
