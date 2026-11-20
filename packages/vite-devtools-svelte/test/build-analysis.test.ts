import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterAll, vi, afterEach } from 'vitest';

import { analyzeBuild } from '../src/analyzers/build.js';

const roots: string[] = [];
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
});

function root(files: Record<string, string> = {}): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-build-'));
  roots.push(r);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(r, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return r;
}

/** chmod 000 only locks a directory for a non-root user on POSIX. */
const CAN_LOCK = process.platform !== 'win32' && process.getuid?.() !== 0;

const summary = (r: string) =>
  analyzeBuild(r).chunks.map(c => [c.file.split(path.sep).join('/'), c.size, c.isEntry]);

describe('analyzeBuild', () => {
  it('is empty without build output, stamped with the current time', () => {
    vi.useFakeTimers({ now: 1234 });
    expect(analyzeBuild(root())).toEqual({ chunks: [], totalSize: 0, timestamp: 1234 });
  });

  it('is empty for empty output directories', () => {
    const r = root();
    fs.mkdirSync(path.join(r, '.svelte-kit/output'), { recursive: true });
    fs.mkdirSync(path.join(r, 'build/client'), { recursive: true });
    expect(analyzeBuild(r).chunks).toEqual([]);
  });

  it('lists .js/.css/.html from every output dir (nested), largest first', () => {
    const r = root({
      '.svelte-kit/output/client/_app/immutable/entry/start.abc.js': 'x'.repeat(30),
      '.svelte-kit/output/client/_app/immutable/assets/app.css': 'x'.repeat(20),
      '.svelte-kit/output/server/index.js': 'x'.repeat(40),
      '.svelte-kit/output/prerendered/pages/about.HTML': 'x'.repeat(10),
      '.svelte-kit/output/client/data.json': '{}',
      '.svelte-kit/output/client/a.js.map': '{}',
      '.svelte-kit/output/client/img.png': 'p',
      'build/chunk.js': 'x'.repeat(5),
    });
    expect(summary(r)).toEqual([
      ['.svelte-kit/output/server/index.js', 40, false],
      ['.svelte-kit/output/client/_app/immutable/entry/start.abc.js', 30, false],
      ['.svelte-kit/output/client/_app/immutable/assets/app.css', 20, false],
      ['.svelte-kit/output/prerendered/pages/about.HTML', 10, false],
      ['build/chunk.js', 5, false],
    ]);
    expect(analyzeBuild(r).totalSize).toBe(105);
  });

  it('lists a file under build/client once, from the scan of build', () => {
    const r = root({ 'build/client/app.js': '123456', 'build/index.js': '12' });
    const readdir = vi.spyOn(fs, 'readdirSync');
    try {
      expect(summary(r)).toEqual([
        ['build/client/app.js', 6, false],
        ['build/index.js', 2, false],
      ]);
      const read = readdir.mock.calls.map(([dir]) => String(dir));
      expect(read.filter(d => d === path.join(r, 'build/client'))).toHaveLength(1);
    } finally {
      readdir.mockRestore();
    }
    expect(analyzeBuild(r).totalSize).toBe(8);
  });

  it("marks the entries of Vite's build manifests, adapter copies included", () => {
    const r = root({
      '.svelte-kit/output/client/.vite/manifest.json': JSON.stringify({
        start: { file: '_app/immutable/entry/start.X.js', isEntry: true },
        app: { file: '_app/immutable/entry/app.X.js', isEntry: true },
        shared: { file: '_app/immutable/chunks/index-ab.js' },
      }),
      '.svelte-kit/output/server/.vite/manifest.json': JSON.stringify({
        index: { file: 'index.js', isEntry: true },
        shared: { file: 'chunks/index-server.js' },
      }),
      '.svelte-kit/output/client/_app/immutable/entry/start.X.js': '1',
      '.svelte-kit/output/client/_app/immutable/entry/app.X.js': '12',
      '.svelte-kit/output/client/_app/immutable/chunks/index-ab.js': '123',
      '.svelte-kit/output/server/index.js': '1234',
      '.svelte-kit/output/server/chunks/index-server.js': '12345',
      '.svelte-kit/output/prerendered/pages/index.html': '123456',
      '.svelte-kit/output/prerendered/pages/getting-started.html': '1234567',
      'build/_app/immutable/entry/start.X.js': '12345678',
      'build/client/_app/immutable/entry/app.X.js': '123456789',
      // adapter-node with `paths.base: '/docs'`
      'build/client/docs/_app/immutable/entry/start.X.js': '1234567890',
      'build/client/docs/_app/immutable/chunks/index-ab.js': '12345678901',
    });
    expect(
      summary(r)
        .filter(([, , entry]) => entry)
        .map(([file]) => file),
    ).toEqual([
      'build/client/docs/_app/immutable/entry/start.X.js',
      'build/client/_app/immutable/entry/app.X.js',
      'build/_app/immutable/entry/start.X.js',
      '.svelte-kit/output/server/index.js',
      '.svelte-kit/output/client/_app/immutable/entry/app.X.js',
      '.svelte-kit/output/client/_app/immutable/entry/start.X.js',
    ]);
  });

  it.each([
    ['malformed', '{'],
    ['not an object', 'null'],
    [
      'odd records',
      '{"a": null, "b": {"file": 1, "isEntry": true}, "c": {"file": "a.js", "isEntry": "yes"}}',
    ],
  ])('a %s manifest marks nothing', (_label, json) => {
    const r = root({
      '.svelte-kit/output/client/.vite/manifest.json': json,
      '.svelte-kit/output/client/a.js': '1',
    });
    expect(summary(r)).toEqual([['.svelte-kit/output/client/a.js', 1, false]]);
  });

  it('chunk entries carry name, relative file, size and entry flag', () => {
    const r = root({ '.svelte-kit/output/app.js': 'abc' });
    expect(analyzeBuild(r).chunks).toEqual([
      {
        name: 'app.js',
        file: path.join('.svelte-kit', 'output', 'app.js'),
        size: 3,
        isEntry: false,
      },
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'symlinks: a file link counts once with its target; dangling links and directory links are skipped',
    () => {
      const r = root({ 'build/real.js': '1234', 'elsewhere/deep.js': '12345678' });
      fs.symlinkSync(path.join(r, 'build/real.js'), path.join(r, 'build/alias.js'));
      fs.symlinkSync(path.join(r, 'build/nope.js'), path.join(r, 'build/dangling.js'));
      fs.symlinkSync(path.join(r, 'elsewhere'), path.join(r, 'build/linked-dir'));
      fs.symlinkSync(path.join(r, 'build'), path.join(r, 'build/loop.js'));
      const chunks = analyzeBuild(r).chunks;
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.size).toBe(4);
    },
  );

  it.skipIf(!CAN_LOCK)('an unreadable directory is skipped, the rest is still listed', () => {
    const r = root({ 'build/locked/a.js': '1', 'build/b.js': '22' });
    fs.chmodSync(path.join(r, 'build/locked'), 0o000);
    try {
      expect(summary(r)).toEqual([['build/b.js', 2, false]]);
    } finally {
      fs.chmodSync(path.join(r, 'build/locked'), 0o755);
    }
  });
});
