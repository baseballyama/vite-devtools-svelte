import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listServers, registerServer, registryDir, selectServer } from '../src/mcp/registry.js';
import type { RegistryEntry } from '../src/mcp/registry.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vds-registry-'));
  dirs.push(dir);
  return path.join(dir, 'servers');
}

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id: `${process.pid}-5173`,
  host: os.hostname(),
  pid: process.pid,
  url: 'http://localhost:5173/__svelte-devtools/mcp',
  token: 't',
  root: '/work/app',
  packageName: 'app',
  startedAt: 1,
  ...over,
});

describe('registryDir', () => {
  it('honours the override, then XDG_CACHE_HOME, then ~/.cache', () => {
    expect(registryDir({ VITE_DEVTOOLS_SVELTE_REGISTRY: '/x' })).toBe('/x');
    expect(registryDir({ XDG_CACHE_HOME: '/c' })).toBe(
      path.join('/c', 'vite-devtools-svelte', 'servers'),
    );
    expect(registryDir({})).toBe(
      path.join(os.homedir(), '.cache', 'vite-devtools-svelte', 'servers'),
    );
  });
});

describe('registerServer / listServers', () => {
  it.skipIf(process.platform === 'win32')('keeps the entry and its directory owner-only', () => {
    const dir = tmpDir();
    registerServer(dir, entry());
    expect(fs.statSync(path.join(dir, `${process.pid}-5173.json`)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('writes an entry and removes it', () => {
    const dir = tmpDir();
    const unregister = registerServer(dir, entry());
    expect(listServers(dir)).toEqual([entry()]);
    unregister();
    unregister(); // idempotent
    expect(listServers(dir)).toEqual([]);
  });

  it('lists newest first and drops entries of dead processes', () => {
    const dir = tmpDir();
    registerServer(dir, entry({ id: 'old', startedAt: 1 }));
    registerServer(dir, entry({ id: 'new', startedAt: 2 }));
    // A pid that cannot be running.
    registerServer(dir, entry({ id: 'dead', pid: 2 ** 22 + 1 }));
    expect(listServers(dir).map(e => e.id)).toEqual(['new', 'old']);
    expect(fs.existsSync(path.join(dir, 'dead.json'))).toBe(false);
  });

  it('skips entries of other hosts without removing them', () => {
    const dir = tmpDir();
    registerServer(dir, entry({ id: 'far', host: 'elsewhere', pid: 2 ** 22 + 1 }));
    expect(listServers(dir)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'far.json'))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('tightens a loose directory of ours', () => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    registerServer(dir, entry());
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('refuses a registry path that is not a directory', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.symlinkSync(os.tmpdir(), dir);
    expect(() => registerServer(dir, entry())).toThrow('is not a directory owned by this user');
  });

  it.skipIf(process.platform === 'win32')('skips symlinked entries', () => {
    const dir = tmpDir();
    registerServer(dir, entry({ id: 'real' }));
    fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'link.json'));
    expect(listServers(dir).map(e => e.id)).toEqual(['real']);
  });

  it('skips unreadable, invalid and non-entry files', () => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{');
    fs.writeFileSync(path.join(dir, 'other.json'), '{"id":1}');
    fs.writeFileSync(path.join(dir, 'null.json'), 'null');
    fs.writeFileSync(path.join(dir, 'x.json.123.tmp'), JSON.stringify(entry()));
    expect(listServers(dir)).toEqual([]);
    expect(listServers(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('selectServer', () => {
  const app = entry({ id: 'a', root: '/work/app', packageName: 'app' });
  const web = entry({ id: 'w', root: '/work/mono/apps/web', packageName: 'web' });
  const docs = entry({ id: 'd', root: '/work/mono/apps/docs', packageName: 'docs' });

  it('picks the server whose root contains cwd', () => {
    expect(selectServer([app, web], '/work/app/src/lib')).toEqual({ kind: 'found', entry: app });
  });

  it('prefers the innermost root', () => {
    const outer = entry({ id: 'o', root: '/work' });
    expect(selectServer([outer, app], '/work/app')).toEqual({ kind: 'found', entry: app });
  });

  it('treats a sibling whose name starts with .. as outside', () => {
    expect(selectServer([app], '/work/app/..cache')).toEqual({ kind: 'found', entry: app });
    expect(selectServer([app], '/work/..app')).toEqual({ kind: 'none', others: [app] });
  });

  it('reports two servers of the same root as ambiguous', () => {
    const twice = entry({ id: 'a2', root: '/work/app' });
    expect(selectServer([app, twice], '/work/app')).toEqual({
      kind: 'ambiguous',
      candidates: [app, twice],
    });
  });

  it('picks the only server inside cwd (a monorepo root)', () => {
    expect(selectServer([app, web], '/work/mono')).toEqual({ kind: 'found', entry: web });
    expect(selectServer([web, docs], '/work/mono')).toEqual({
      kind: 'ambiguous',
      candidates: [web, docs],
    });
  });

  it('reports no match with the other servers', () => {
    expect(selectServer([app], '/elsewhere')).toEqual({ kind: 'none', others: [app] });
  });

  it('picks by id, root or package name', () => {
    expect(selectServer([web, docs], '/work/mono', 'd')).toEqual({ kind: 'found', entry: docs });
    expect(selectServer([web, docs], '/work/mono', 'apps/web')).toEqual({
      kind: 'found',
      entry: web,
    });
    expect(selectServer([web, docs], '/', 'docs')).toEqual({ kind: 'found', entry: docs });
    const slash = entry({ id: 's', root: '/work/mono/apps/web/' });
    expect(selectServer([slash], '/work/mono', 'apps/web')).toEqual({
      kind: 'found',
      entry: slash,
    });
    expect(selectServer([web, docs], '/', 'nope')).toEqual({ kind: 'none', others: [web, docs] });
    const docs2 = entry({ id: 'd2', root: '/other/docs', packageName: 'docs' });
    expect(selectServer([docs, docs2], '/', 'docs')).toEqual({
      kind: 'ambiguous',
      candidates: [docs, docs2],
    });
  });
});
