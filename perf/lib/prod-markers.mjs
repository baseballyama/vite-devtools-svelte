// Production no-op check shared by perf/check-prod-noop.mjs and
// e2e/compat/smoke.mjs.

import fs from 'node:fs';
import path from 'node:path';

// Strings that only exist in code emitted by vite-devtools-svelte.
export const PROD_MARKERS = [
  '__SVELTE_DEVTOOLS__',
  'svelte-devtools:',
  'virtual:svelte-devtools',
  '__svelte_devtools_record_load',
  '@vitejs/devtools/client/inject',
  // hub inject used by the SvelteKit template injector
  '/__devtools/embedded.js',
  '__devtools',
];

const BUILD_EXTS = new Set(['.js', '.mjs', '.html', '.css', '.json']);

/** Marker hits in the build output under `dir`; a missing `dir` has none. */
export function findProdMarkers(dir, root = dir) {
  const hits = [];
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (BUILD_EXTS.has(path.extname(ent.name))) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of PROD_MARKERS)
          if (text.includes(m)) hits.push({ file: path.relative(root, p), marker: m });
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}
