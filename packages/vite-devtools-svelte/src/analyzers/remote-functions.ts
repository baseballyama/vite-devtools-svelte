import fs from 'node:fs';
import path from 'node:path';

import type { RemoteFunctionInfo, RemoteFunctionsResult } from '../types.js';

/** The parts of SvelteKit's resolved config that decide which files are remote modules. */
export interface RemoteConfig {
  srcDir: string;
  moduleExtensions: string[];
}

/** Loads a module the way the dev server's SSR environment runs it. */
export type ImportModule = (file: string) => Promise<Record<string, unknown>>;

/** Null when SvelteKit is absent or `experimental.remoteFunctions` is off. */
export function remoteConfigOf(kitOptions: unknown): RemoteConfig | null {
  const options = kitOptions as
    | {
        experimental?: { remoteFunctions?: unknown };
        files?: { src?: unknown };
        moduleExtensions?: unknown;
      }
    | undefined;
  if (options?.experimental?.remoteFunctions !== true) return null;
  const srcDir = options.files?.src;
  const exts = options.moduleExtensions;
  if (typeof srcDir !== 'string') return null;
  return {
    srcDir,
    moduleExtensions:
      Array.isArray(exts) && exts.every(e => typeof e === 'string') ? exts : ['.js', '.ts'],
  };
}

/**
 * `remote.ts` and `*.remote.ts` (any of `moduleExtensions`) under `srcDir`.
 * SvelteKit itself never scans: it registers a remote module when its server
 * transform runs, so this finds the ones no request has reached yet.
 * Remote modules shipped in packages (node_modules) are not listed.
 */
export function findRemoteFiles(srcDir: string, moduleExtensions: string[]): string[] {
  const out: string[] = [];
  const isRemote = (name: string) =>
    moduleExtensions.some(ext => name === `remote${ext}` || name.endsWith(`.remote${ext}`));
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // removed mid-scan, or unreadable
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path.join(dir, entry.name));
      } else if (isRemote(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(srcDir);
  return out.toSorted();
}

/**
 * SvelteKit's internal metadata, set on every remote export when the module
 * runs on the server (`init_remote_functions`). Not a public API: checked
 * field by field so a changed shape drops entries instead of throwing.
 */
function metadataOf(value: unknown): { type: string; id: string; line?: number } | null {
  if ((typeof value !== 'function' && typeof value !== 'object') || value === null) return null;
  const meta = (value as { __?: unknown }).__;
  if (typeof meta !== 'object' || meta === null) return null;
  const { type, id, dev_loc } = meta as { type?: unknown; id?: unknown; dev_loc?: unknown };
  if (typeof type !== 'string' || typeof id !== 'string') return null;
  const line = (dev_loc as { line?: unknown } | undefined)?.line;
  return typeof line === 'number' ? { type, id, line } : { type, id };
}

/**
 * Runs each remote module in the SSR environment and reads what SvelteKit
 * attached to its exports. A module that fails to load (a syntax error, or a
 * non-remote export SvelteKit rejects) is reported in `errors`, not thrown.
 */
export async function analyzeRemoteFunctions(
  root: string,
  config: RemoteConfig | null,
  importModule: ImportModule | null,
): Promise<RemoteFunctionsResult> {
  if (!config) return { enabled: false, functions: [], errors: [] };
  const files = findRemoteFiles(config.srcDir, config.moduleExtensions);
  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  if (!importModule) {
    return {
      enabled: true,
      functions: [],
      errors: files.map(file => ({
        file: relative(file),
        message: 'the SSR environment cannot run modules in this process',
      })),
    };
  }
  const loaded = await Promise.all(
    files.map(async file => {
      try {
        return { file, exports: await importModule(file) };
      } catch (e) {
        return { file, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const functions: RemoteFunctionInfo[] = [];
  const errors: RemoteFunctionsResult['errors'] = [];
  for (const entry of loaded) {
    const file = relative(entry.file);
    if (entry.error !== undefined) {
      errors.push({ file, message: entry.error });
      continue;
    }
    for (const [name, value] of Object.entries(entry.exports ?? {})) {
      const meta = metadataOf(value);
      if (meta) functions.push({ name, file, ...meta });
    }
  }
  return { enabled: true, functions, errors };
}
