import fs from 'node:fs';
import path from 'node:path';

import type { BuildAnalysis, BuildChunk } from '../types.js';

const WEB_EXTENSIONS = new Set(['.js', '.css', '.html']);

/** The files Vite's build manifest in `outDir` marks as entries (empty without one). */
function readEntryFiles(outDir: string): Set<string> {
  const files = new Set<string>();
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(outDir, '.vite/manifest.json'), 'utf-8'));
  } catch {
    return files; // missing or malformed
  }
  if (typeof manifest !== 'object' || manifest === null) return files;
  for (const chunk of Object.values(manifest) as unknown[]) {
    if (typeof chunk !== 'object' || chunk === null) continue;
    const { isEntry, file } = chunk as { isEntry?: unknown; file?: unknown };
    if (isEntry === true && typeof file === 'string') files.add(file);
  }
  return files;
}

/**
 * Scan common SvelteKit build output directories for emitted web assets.
 * Adapter output under `build/` is listed separately from `.svelte-kit/output`,
 * so a client asset the adapter copies appears in both.
 * An unreadable entry (e.g. a dangling symlink) is skipped instead of ending
 * the scan of its directory; directory symlinks are not followed, and a file
 * symlink counts once with its target.
 */
export function analyzeBuild(root: string): BuildAnalysis {
  const chunks: BuildChunk[] = [];
  const seen = new Set<string>();
  const output = path.resolve(root, '.svelte-kit/output');
  const build = path.resolve(root, 'build');
  const clientEntries = readEntryFiles(path.join(output, 'client'));
  const serverEntries = readEntryFiles(path.join(output, 'server'));
  const isOutputEntry = (rel: string) => {
    const slash = rel.indexOf('/');
    if (slash === -1) return false;
    const dir = rel.slice(0, slash);
    const entries = dir === 'client' ? clientEntries : dir === 'server' ? serverEntries : null;
    return entries?.has(rel.slice(slash + 1)) ?? false;
  };
  // Adapters copy the client output without its manifest, under a prefix such
  // as adapter-node's `client${paths.base}`, so any trailing part may match.
  const isBuildEntry = (rel: string) => {
    for (let at = 0; ;) {
      if (clientEntries.has(rel.slice(at))) return true;
      const slash = rel.indexOf('/', at);
      if (slash === -1) return false;
      at = slash + 1;
    }
  };
  const walkDir = (d: string, base: string, isEntry: (rel: string) => boolean) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walkDir(full, base, isEntry);
        continue;
      }
      if (!WEB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      let real: string;
      let stat: fs.Stats;
      try {
        real = fs.realpathSync(full);
        stat = fs.statSync(real);
      } catch {
        continue;
      }
      if (!stat.isFile() || seen.has(real)) continue;
      seen.add(real);
      chunks.push({
        name: entry.name,
        file: path.relative(root, full),
        size: stat.size,
        isEntry: isEntry(path.relative(base, full).split(path.sep).join('/')),
      });
    }
  };
  walkDir(output, output, isOutputEntry);
  walkDir(build, build, isBuildEntry);
  chunks.sort((a, b) => b.size - a.size);
  return { chunks, totalSize: chunks.reduce((s, c) => s + c.size, 0), timestamp: Date.now() };
}
