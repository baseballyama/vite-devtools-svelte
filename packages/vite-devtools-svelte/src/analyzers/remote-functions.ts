import fs from 'node:fs';
import path from 'node:path';

import { parseSync } from 'vite';

import type { RemoteFunctionInfo, RemoteFunctionsResult } from '../types.js';
import { relativeId } from './components.js';

/** The parts of a module runner's evaluated module node read here (Vite's `EvaluatedModuleNode`). */
export interface EvaluatedModuleLike {
  file: string;
  evaluated: boolean;
  exports: unknown;
}

const KINDS = new Set(['query', 'command', 'form', 'prerender']);
const QUERY_VARIANTS = new Set(['batch', 'live']);

/** `files.src` when SvelteKit has `experimental.remoteFunctions` on, else null. */
export function remoteSrcDirOf(kitOptions: unknown): string | null {
  const options = kitOptions as
    | { experimental?: { remoteFunctions?: unknown }; files?: { src?: unknown } }
    | undefined;
  const src = options?.files?.src;
  return options?.experimental?.remoteFunctions === true && typeof src === 'string' ? src : null;
}

/**
 * SvelteKit's rule (`/[/.]remote\.[^/]+$/` on the module id): `remote.<ext>`
 * or `<name>.remote.<ext>`, any extension. Declaration files never run.
 */
export function isRemoteFile(file: string): boolean {
  const name = path.basename(file);
  if (name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.d.cts')) return false;
  if (name.startsWith('remote.')) return name.length > 'remote.'.length;
  const at = name.indexOf('.remote.');
  return at !== -1 && name.length > at + '.remote.'.length;
}

/** Remote files under `dir`, skipping `node_modules` and dot-directories (`.svelte-kit`, `.git`). */
export function findRemoteFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return; // removed mid-scan, or unreadable
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          walk(path.join(d, entry.name));
        }
      } else if (isRemoteFile(entry.name)) {
        out.push(path.join(d, entry.name));
      }
    }
  };
  walk(dir);
  return out.toSorted();
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const hasKitPeer = (pkg: Record<string, unknown> | null) =>
  typeof pkg?.peerDependencies === 'object' &&
  pkg.peerDependencies !== null &&
  '@sveltejs/kit' in pkg.peerDependencies;

/**
 * Where a package's published files are: its `files` entries (a glob is cut
 * back to the directory before its first wildcard; negations are skipped),
 * else the whole package. A workspace package linked into node_modules also
 * has its tests and fixtures on disk, which are not part of it.
 */
function publishedRoots(dir: string, files: unknown): string[] {
  if (!Array.isArray(files)) return [dir];
  const roots = new Set<string>();
  for (const entry of files) {
    if (typeof entry !== 'string' || entry.startsWith('!')) continue;
    const wildcard = ['*', '?', '[', '{']
      .map(c => entry.indexOf(c))
      .filter(i => i !== -1)
      .reduce((a, b) => Math.min(a, b), entry.length);
    const fixed =
      wildcard < entry.length ? entry.slice(0, entry.lastIndexOf('/', wildcard) + 1) : entry;
    const at = path.join(dir, fixed);
    // npm ignores entries that leave the package; walking them could cover the disk.
    const rel = path.relative(dir, at);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    roots.add(at);
  }
  return [...roots];
}

/** `name`'s directory as Node resolves it from `root`: the nearest node_modules up the tree (hoisted workspaces). */
function installedPackage(root: string, name: string): string | null {
  for (let dir = root; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

/**
 * The remote files the app's direct dependencies ship: SvelteKit only treats
 * a file in node_modules as remote when its package has a peer dependency on
 * `@sveltejs/kit`.
 */
export function packageRemoteFiles(root: string): Array<{ file: string; pkg: string }> {
  const app = readJson(path.join(root, 'package.json'));
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = app?.[field];
    if (typeof deps === 'object' && deps !== null) for (const n of Object.keys(deps)) names.add(n);
  }
  const out: Array<{ file: string; pkg: string }> = [];
  for (const name of [...names].toSorted()) {
    const installed = installedPackage(root, name);
    if (!installed) continue;
    const pkg = readJson(path.join(installed, 'package.json'));
    if (!hasKitPeer(pkg)) continue;
    const dir = fs.realpathSync.native(installed);
    const files = new Set<string>();
    for (const r of publishedRoots(dir, pkg?.files)) {
      if (isRemoteFile(r) && fs.existsSync(r)) files.add(r);
      else for (const f of findRemoteFiles(r)) files.add(f);
    }
    for (const file of [...files].toSorted()) out.push({ file, pkg: name });
  }
  return out;
}

/** The package a file under the app's node_modules belongs to: `pkg` or `@scope/pkg`. */
function packageNameOf(rel: string): string | undefined {
  const at = rel.lastIndexOf('node_modules/');
  if (at === -1 || (at > 0 && rel[at - 1] !== '/')) return undefined;
  const [first = '', second] = rel.slice(at + 'node_modules/'.length).split('/');
  return first.startsWith('@') && second ? `${first}/${second}` : first || undefined;
}

type Program = ReturnType<typeof parseSync>['program'];
type Statement = Program['body'][number];
type VariableDeclaration = Extract<Statement, { type: 'VariableDeclaration' }>;
type Expression = NonNullable<VariableDeclaration['declarations'][number]['init']>;

/** Which `$app/server` function a callee is: `query`, `q.batch`, `server.query.live`, … */
function kindOf(callee: Expression, named: Map<string, string>, namespaces: Set<string>) {
  if (callee.type === 'Identifier') {
    const imported = named.get(callee.name);
    return imported && KINDS.has(imported) ? imported : null;
  }
  if (callee.type !== 'MemberExpression' || callee.computed) return null;
  if (callee.property.type !== 'Identifier') return null;
  const prop = callee.property.name;
  const obj = callee.object;
  if (obj.type === 'Identifier') {
    if (namespaces.has(obj.name)) return KINDS.has(prop) ? prop : null;
    return named.get(obj.name) === 'query' && QUERY_VARIANTS.has(prop) ? `query_${prop}` : null;
  }
  const nsQuery =
    obj.type === 'MemberExpression' &&
    !obj.computed &&
    obj.object.type === 'Identifier' &&
    namespaces.has(obj.object.name) &&
    obj.property.type === 'Identifier' &&
    obj.property.name === 'query';
  return nsQuery && QUERY_VARIANTS.has(prop) ? `query_${prop}` : null;
}

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let i = code.indexOf('\n'); i !== -1 && i < offset; i = code.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * The remote functions a module declares, read without running it:
 * `export const x = query(…)` and `const x = form(…); export { x }`, with
 * the kind taken from the `$app/server` import. Re-exports from other
 * modules are not followed. Null when the module cannot be parsed.
 */
export function staticRemoteExports(
  code: string,
  filename: string,
): Array<{ name: string; type: string; line: number }> | null {
  const { program, errors } = parseSync(filename, code);
  if (errors.length > 0) return null;
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== '$app/server') continue;
    if (node.importKind === 'type') continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportNamespaceSpecifier') namespaces.add(spec.local.name);
      else if (spec.type === 'ImportSpecifier' && spec.importKind !== 'type') {
        const imported = spec.imported;
        named.set(spec.local.name, imported.type === 'Literal' ? imported.value : imported.name);
      }
    }
  }
  if (named.size === 0 && namespaces.size === 0) return [];

  const locals = new Map<string, { type: string; start: number }>();
  const exported: Array<{ name: string; local: string }> = [];
  for (const node of program.body) {
    const exportDecl = node.type === 'ExportNamedDeclaration' ? node : null;
    const decl = exportDecl ? exportDecl.declaration : node;
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type !== 'Identifier' || d.init?.type !== 'CallExpression') continue;
        const type = kindOf(d.init.callee, named, namespaces);
        if (!type) continue;
        locals.set(d.id.name, { type, start: d.start });
        if (exportDecl) exported.push({ name: d.id.name, local: d.id.name });
      }
    }
    if (exportDecl && !exportDecl.source && exportDecl.exportKind !== 'type') {
      for (const spec of exportDecl.specifiers) {
        if (spec.exportKind === 'type' || spec.local.type !== 'Identifier') continue;
        const name = spec.exported.type === 'Literal' ? spec.exported.value : spec.exported.name;
        exported.push({ name, local: spec.local.name });
      }
    }
  }
  return exported.flatMap(({ name, local }) => {
    const found = locals.get(local);
    return found ? [{ name, type: found.type, line: lineAt(code, found.start) }] : [];
  });
}

/**
 * SvelteKit's internal metadata, set on every remote export when its module
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

function realFile(file: string): string {
  try {
    return fs.realpathSync.native(file).split(path.sep).join('/');
  } catch {
    return file.split(path.sep).join('/');
  }
}

/** The parse of every remote file the scan reaches; costly, so the plugin caches it until a file changes. */
export interface RemoteScan {
  entries: Array<{ file: string; name: string; type: string; line: number; pkg?: string }>;
  /** Real paths of files that could not be parsed. */
  errors: string[];
}

export function scanRemoteFiles(root: string, srcDir: string): RemoteScan {
  const sources: Array<{ file: string; pkg?: string }> = [
    ...findRemoteFiles(srcDir).map(file => ({ file })),
    ...packageRemoteFiles(root),
  ];
  const scan: RemoteScan = { entries: [], errors: [] };
  const seen = new Set<string>();
  for (const { file, pkg } of sources) {
    const real = realFile(file);
    // One file reached twice (an aliased dependency, a link into src) counts once.
    if (seen.has(real)) continue;
    seen.add(real);
    let found;
    try {
      found = staticRemoteExports(fs.readFileSync(file, 'utf-8'), file);
    } catch {
      continue; // removed since the scan
    }
    if (!found) scan.errors.push(real);
    for (const f of found ?? [])
      scan.entries.push(pkg ? { file: real, ...f, pkg } : { file: real, ...f });
  }
  return scan;
}

/**
 * Every remote function of the app, without running any module:
 * - static: remote files under `src` and in dependencies (see {@link packageRemoteFiles}), parsed;
 * - runtime: remote modules the app has already loaded on the server, read
 *   from the SSR module runner. These carry SvelteKit's id and kind, and also
 *   cover modules the scan does not reach (outside `src`, transitive packages).
 * Running a module from here would register its endpoints with the dev
 * server and cache any error it throws outside a request, so unloaded ones
 * are listed from the parse only (`loaded: false`, no `id`).
 */
export function analyzeRemoteFunctions(
  root: string,
  srcDir: string | null,
  evaluated: Iterable<EvaluatedModuleLike>,
  scan: RemoteScan | null = srcDir === null ? null : scanRemoteFiles(root, srcDir),
): RemoteFunctionsResult {
  if (srcDir === null || scan === null) return { enabled: false, functions: [], errors: [] };
  // Files are real paths, so the root must be too (a symlinked or `subst` root).
  const realRoot = realFile(root);
  const byKey = new Map<string, RemoteFunctionInfo>();
  const add = (file: string, info: Omit<RemoteFunctionInfo, 'file' | 'package'>, pkg?: string) => {
    const key = `${file}\0${info.name}`;
    const entry: RemoteFunctionInfo = {
      ...byKey.get(key),
      ...info,
      file: relativeId(realRoot, file),
    };
    if (pkg) entry.package = pkg;
    byKey.set(key, entry);
  };

  for (const { file, pkg, ...f } of scan.entries) add(file, { ...f, loaded: false }, pkg);

  for (const node of evaluated) {
    if (!node.evaluated || !isRemoteFile(node.file)) continue;
    if (typeof node.exports !== 'object' || node.exports === null) continue;
    const real = realFile(node.file);
    const pkg = packageNameOf(relativeId(realRoot, real));
    for (const [name, value] of Object.entries(node.exports)) {
      const meta = metadataOf(value);
      if (meta) add(real, { name, ...meta, loaded: true }, pkg);
    }
  }

  const functions = [...byKey.values()].toSorted(
    (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
  );
  const errors = scan.errors.map(file => ({
    file: relativeId(realRoot, file),
    message: 'could not be parsed',
  }));
  return { enabled: true, functions, errors };
}
