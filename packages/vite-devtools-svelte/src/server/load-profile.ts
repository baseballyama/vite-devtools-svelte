import { parseSync } from 'vite';

import type { LoadProfile } from '../types.js';
import { HOT_EVENTS } from './collector.js';

/** Server-side hook the profiled `load` wrappers report to (set by the plugin on the dev server). */
export const LOAD_RECORDER = '__svelte_devtools_record_load';

const LOAD_FILES: Record<string, LoadProfile['type']> = {
  '+page.server.ts': 'server',
  '+page.server.js': 'server',
  '+layout.server.ts': 'server',
  '+layout.server.js': 'server',
  '+page.ts': 'universal',
  '+page.js': 'universal',
  '+layout.ts': 'universal',
  '+layout.js': 'universal',
};

function routeOf(file: string, routesDir: string): string | null {
  const dir = file.slice(0, file.lastIndexOf('/'));
  if (dir === routesDir) return '/';
  return dir.startsWith(`${routesDir}/`) ? dir.slice(routesDir.length) : null;
}

// Only the `export` keyword is removed, so the module's own references keep
// the original `load` and line numbers are unchanged. `routesDir` is absolute
// and `/`-separated.
export function profileLoad(code: string, id: string, routesDir: string): string | null {
  // Cheap checks first: this runs for every module the dev server serves.
  const type = LOAD_FILES[id.slice(id.lastIndexOf('/') + 1)];
  if (!type || id.includes('node_modules') || !code.includes('load')) return null;
  const route = routeOf(id, routesDir);
  if (route === null) return null;
  // The module record only: oxc builds it natively, without materialising
  // an AST in JS.
  const { module, errors } = parseSync(id, code);
  if (errors.length > 0) return null;
  const stmt = module.staticExports.find(s => s.entries.some(e => e.exportName.name === 'load'));
  const entry = stmt?.entries.find(e => e.exportName.name === 'load');
  // Declaration exports only: their entries span the declaration (to the
  // statement's end); `export { load }` / `export … from` are left alone.
  if (!stmt || entry?.localName.name !== 'load' || entry.end !== stmt.end) return null;
  // Names the stripped `export` covered besides `load`, exported again.
  const others = stmt.entries.map(e => e.localName.name!).filter(n => n !== 'load');
  const local = code.slice(0, stmt.start) + code.slice(entry.start);
  return local + profiledExport(others, route, id, type);
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
  const args = [route, file, type].map(v => JSON.stringify(v)).join(', ');
  const report = `route: ${JSON.stringify(route)}, file: ${JSON.stringify(file)}, type: ${JSON.stringify(type)}`;
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
    } else {
      import.meta.hot?.send(${JSON.stringify(HOT_EVENTS.loadProfile)}, { ${report}, duration: __duration, dataSize: __dataSize });
    }
  } catch {}
  return __result;
};
export { __profiled_load as load };
`;
}

export type LoadReport = Pick<LoadProfile, 'route' | 'file' | 'type' | 'duration' | 'dataSize'>;

export function loadProfileOf(report: LoadReport): LoadProfile {
  return { ...report, duration: Math.round(report.duration * 100) / 100, timestamp: Date.now() };
}

// Same bound as file paths in the RPC arguments.
const MAX_STRING = 4096;

// The payload comes from the user's app: anything not shaped like a report is dropped. Only
// universal loads run in the browser; server loads always use the recorder.
export function parseLoadReport(payload: unknown): LoadReport | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { route, file, type, duration, dataSize } = payload as Record<string, unknown>;
  if (typeof route !== 'string' || route.length > MAX_STRING) return null;
  if (typeof file !== 'string' || file.length > MAX_STRING) return null;
  if (type !== 'universal') return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;
  if (typeof dataSize !== 'number' || !Number.isInteger(dataSize) || dataSize < 0) return null;
  return { route, file, type, duration, dataSize };
}
