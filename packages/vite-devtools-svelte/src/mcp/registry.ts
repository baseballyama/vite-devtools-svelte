import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isInside } from '../server/security.js';

/**
 * Running dev servers announce their MCP endpoint here, one file each, so the
 * `vite-devtools-svelte mcp` stdio server can find them without a port or a
 * token in the user's MCP config.
 */
export interface RegistryEntry {
  /** `<pid>-<port>`: unique among running servers, and the file name. */
  id: string;
  /** With `pid`: a home shared between machines holds other hosts' servers. */
  host: string;
  pid: number;
  /** Full URL of the MCP endpoint. */
  url: string;
  token: string;
  /** Vite root of the app. */
  root: string;
  packageName: string;
  startedAt: number;
}

/** Per-user directory of entries; `VITE_DEVTOOLS_SVELTE_REGISTRY` overrides it. */
export function registryDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VITE_DEVTOOLS_SVELTE_REGISTRY) return env.VITE_DEVTOOLS_SVELTE_REGISTRY;
  return path.join(cacheHome(env), 'vite-devtools-svelte', 'servers');
}

function cacheHome(env: NodeJS.ProcessEnv): string {
  // An empty variable counts as unset (XDG Base Directory spec).
  if (env.XDG_CACHE_HOME) return env.XDG_CACHE_HOME;
  if (process.platform === 'win32' && env.LOCALAPPDATA) return env.LOCALAPPDATA;
  return path.join(os.homedir(), '.cache');
}

// The overrides may point at a shared place: only a directory and files of
// our own are trusted (POSIX; Windows keeps LOCALAPPDATA per user).
const ownedByUs = (stat: fs.Stats) =>
  process.platform === 'win32' || stat.uid === process.getuid?.();

function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || !ownedByUs(stat)) {
    throw new Error(`${dir} is not a directory owned by this user`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

/** Writes `entry` (owner-only: it holds the token). Returns a function removing it. */
export function registerServer(dir: string, entry: RegistryEntry): () => void {
  ensurePrivateDir(dir);
  const file = path.join(dir, `${entry.id}.json`);
  // A fresh, exclusive temp file (never a planted one), renamed so a reader
  // never sees a half-written entry.
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  return () => fs.rmSync(file, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to another user.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isEntry(value: unknown): value is RegistryEntry {
  const v = value as RegistryEntry;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    typeof v.host === 'string' &&
    Number.isInteger(v.pid) &&
    typeof v.url === 'string' &&
    typeof v.token === 'string' &&
    typeof v.root === 'string' &&
    typeof v.packageName === 'string'
  );
}

/** Entries of running servers on this host, newest first. Removes those of dead processes. */
export function listServers(dir: string): RegistryEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const host = os.hostname();
  const entries: RegistryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let entry: unknown;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || !ownedByUs(stat)) continue;
      entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!isEntry(entry) || entry.host !== host) continue;
    if (isAlive(entry.pid)) entries.push(entry);
    else fs.rmSync(file, { force: true });
  }
  return entries.toSorted((a, b) => b.startedAt - a.startedAt);
}

/** Whether `child` is `parent` or inside it (any separator, any case on Windows). */
const contains = (parent: string, child: string) =>
  path.relative(parent, child) === '' || isInside(parent, child);

export type Selection =
  | { kind: 'found'; entry: RegistryEntry }
  | { kind: 'none'; others: RegistryEntry[] }
  | { kind: 'ambiguous'; candidates: RegistryEntry[] };

/**
 * The dev server an MCP client in `cwd` means. `server` picks one by id,
 * root or package name; otherwise a server whose root contains `cwd` wins
 * (the innermost), then the only server inside `cwd` (a monorepo root).
 */
export function selectServer(entries: RegistryEntry[], cwd: string, server?: string): Selection {
  if (server !== undefined) {
    const root = path.resolve(cwd, server);
    const matches = entries.filter(
      e => e.id === server || e.packageName === server || path.relative(e.root, root) === '',
    );
    if (matches.length === 1) return { kind: 'found', entry: matches[0]! };
    return matches.length === 0
      ? { kind: 'none', others: entries }
      : { kind: 'ambiguous', candidates: matches };
  }
  const enclosing = entries.filter(e => contains(e.root, cwd));
  if (enclosing.length > 0) {
    const depth = Math.max(...enclosing.map(e => e.root.length));
    const innermost = enclosing.filter(e => e.root.length === depth);
    return innermost.length === 1
      ? { kind: 'found', entry: innermost[0]! }
      : { kind: 'ambiguous', candidates: innermost };
  }
  const inside = entries.filter(e => contains(cwd, e.root));
  if (inside.length === 1) return { kind: 'found', entry: inside[0]! };
  return inside.length === 0
    ? { kind: 'none', others: entries }
    : { kind: 'ambiguous', candidates: inside };
}
