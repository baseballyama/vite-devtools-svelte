import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeRemoteFunctions,
  findRemoteFiles,
  isRemoteFile,
  packageRemoteFiles,
  scanRemoteFiles,
  remoteSrcDirOf,
  staticRemoteExports,
} from '../src/analyzers/remote-functions.js';
import type { EvaluatedModuleLike } from '../src/analyzers/remote-functions.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-remote-')));
  dirs.push(root);
  for (const [file, code] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), code);
  }
  return root;
}

const rel = (root: string, files: string[]) =>
  files.map(f => path.relative(root, f).split(path.sep).join('/'));

// What SvelteKit's `init_remote_functions` leaves on a remote export: a
// function for queries and commands, a plain object for forms, with `__`
// non-enumerable on forms.
const kitQuery = (meta: Record<string, unknown>) => Object.assign(() => {}, { __: meta });
const kitForm = (meta: Record<string, unknown>) => Object.defineProperty({}, '__', { value: meta });
const node = (file: string, exports: unknown, evaluated = true): EvaluatedModuleLike => ({
  file,
  exports,
  evaluated,
});

describe('remoteSrcDirOf', () => {
  it('is files.src only when experimental.remoteFunctions is on', () => {
    expect(remoteSrcDirOf(null)).toBeNull();
    expect(remoteSrcDirOf({ files: { src: '/app/src' } })).toBeNull();
    expect(
      remoteSrcDirOf({ experimental: { remoteFunctions: false }, files: { src: '/app/src' } }),
    ).toBeNull();
    expect(remoteSrcDirOf({ experimental: { remoteFunctions: true }, files: {} })).toBeNull();
    expect(
      remoteSrcDirOf({ experimental: { remoteFunctions: true }, files: { src: '/app/src' } }),
    ).toBe('/app/src');
  });
});

describe('isRemoteFile', () => {
  it.each([
    ['todos.remote.ts', true],
    ['todos.remote.js', true],
    ['todos.remote.mts', true],
    ['todos.remote.svelte.ts', true],
    ['remote.ts', true],
    ['/a/b/remote.js', true],
    ['remote.', false],
    ['x.remote.', false],
    ['remote.d.ts', false],
    ['todos.remote.d.ts', false],
    ['todos.remote.d.mts', false],
    ['todos.remote.d.cts', false],
    ['remotes.ts', false],
    ['not-remote.ts', false],
    ['remote', false],
  ])('%s → %s', (file, expected) => {
    expect(isRemoteFile(file)).toBe(expected);
  });
});

describe('findRemoteFiles', () => {
  it('walks the directory, skipping node_modules and dot-directories', () => {
    const root = project({
      'src/lib/todos.remote.ts': '',
      'src/lib/remote.js': '',
      'src/routes/a/data.remote.mts': '',
      'src/lib/not-remote.ts': '',
      'src/node_modules/pkg/x.remote.ts': '',
      'src/.svelte-kit/output/y.remote.js': '',
    });
    expect(rel(root, findRemoteFiles(path.join(root, 'src')))).toEqual([
      'src/lib/remote.js',
      'src/lib/todos.remote.ts',
      'src/routes/a/data.remote.mts',
    ]);
  });

  it('is empty for a missing directory', () => {
    expect(findRemoteFiles('/nonexistent/src')).toEqual([]);
  });
});

describe('packageRemoteFiles', () => {
  const kitPeer = { peerDependencies: { '@sveltejs/kit': '^3' } };

  it('lists the remote files of direct dependencies with a peer dependency on @sveltejs/kit', () => {
    const root = project({
      'package.json': JSON.stringify({
        dependencies: { 'kit-lib': '1', plain: '1', missing: '1' },
        devDependencies: { '@scope/kit-dev': '1' },
      }),
      'node_modules/kit-lib/package.json': JSON.stringify(kitPeer),
      'node_modules/kit-lib/dist/a.remote.js': '',
      'node_modules/kit-lib/dist/a.js': '',
      'node_modules/plain/package.json': JSON.stringify({ peerDependencies: { svelte: '^5' } }),
      'node_modules/plain/b.remote.js': '',
      'node_modules/@scope/kit-dev/package.json': JSON.stringify(kitPeer),
      'node_modules/@scope/kit-dev/remote.js': '',
    });
    expect(packageRemoteFiles(root)).toEqual([
      { file: path.join(root, 'node_modules/@scope/kit-dev/remote.js'), pkg: '@scope/kit-dev' },
      { file: path.join(root, 'node_modules/kit-lib/dist/a.remote.js'), pkg: 'kit-lib' },
    ]);
  });

  it('only looks at what the package publishes (`files`)', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { lib: '1' } }),
      'node_modules/lib/package.json': JSON.stringify({
        ...kitPeer,
        files: ['dist', 'auth.remote.js', 'src/**/*.remote.ts', '!dist/skip', 'gone', 7],
      }),
      'node_modules/lib/dist/a.remote.js': '',
      'node_modules/lib/auth.remote.js': '',
      'node_modules/lib/src/deep/b.remote.ts': '',
      // on disk in a linked workspace package, but not published
      'node_modules/lib/test/fixtures/c.remote.ts': '',
    });
    expect(packageRemoteFiles(root).map(f => f.file)).toEqual(
      ['auth.remote.js', 'dist/a.remote.js', 'src/deep/b.remote.ts'].map(f =>
        path.join(root, 'node_modules/lib', f),
      ),
    );
  });

  it('ignores `files` entries that leave the package', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { lib: '1' } }),
      'node_modules/lib/package.json': JSON.stringify({ ...kitPeer, files: ['../..', '/'] }),
      'node_modules/lib/x.remote.js': '',
      'elsewhere.remote.js': '',
    });
    // `/` is the package root to npm; `../..` is skipped, so `elsewhere` is not walked.
    expect(packageRemoteFiles(root)).toEqual([
      { file: path.join(root, 'node_modules/lib/x.remote.js'), pkg: 'lib' },
    ]);
  });

  it('finds a dependency hoisted above the app (workspaces)', () => {
    const repo = project({
      'node_modules/lib/package.json': JSON.stringify(kitPeer),
      'node_modules/lib/x.remote.js': '',
      'apps/web/package.json': JSON.stringify({ dependencies: { lib: '1' } }),
    });
    expect(packageRemoteFiles(path.join(repo, 'apps/web'))).toEqual([
      { file: path.join(repo, 'node_modules/lib/x.remote.js'), pkg: 'lib' },
    ]);
  });

  it('is empty without a package.json', () => {
    expect(packageRemoteFiles(project({}))).toEqual([]);
  });
});

const parse = (code: string) => staticRemoteExports(code, 'x.remote.ts');

describe('staticRemoteExports', () => {
  it('reads the kind from the $app/server import, under any local name', () => {
    expect(
      parse(
        [
          "import { query, command as cmd, form, prerender } from '$app/server';",
          'export const a = query(() => 1);',
          "export const b = query.batch('unchecked', (ids: number[]) => (id: number) => id);",
          'export const c = query.live(async function* () {});',
          'export const d = cmd(() => {});',
          "export const e = form('unchecked', () => {});",
          'export const f = prerender(() => 1);',
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'a', type: 'query', line: 2 },
      { name: 'b', type: 'query_batch', line: 3 },
      { name: 'c', type: 'query_live', line: 4 },
      { name: 'd', type: 'command', line: 5 },
      { name: 'e', type: 'form', line: 6 },
      { name: 'f', type: 'prerender', line: 7 },
    ]);
  });

  it('follows a namespace import', () => {
    expect(
      parse(
        [
          "import * as server from '$app/server';",
          'export const a = server.query(() => 1);',
          'export const b = server.query.batch(() => () => 1);',
          'export const c = server.getRequestEvent();',
          'export const d = other.query.batch(() => () => 1);',
          'export const e = server.command.batch(() => 1);',
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'a', type: 'query', line: 2 },
      { name: 'b', type: 'query_batch', line: 3 },
    ]);
  });

  it('follows export specifiers to local declarations', () => {
    expect(
      parse(
        [
          "import { query } from '$app/server';",
          'const a = query(() => 1);',
          'const helper = 1;',
          'export { a, a as alias, helper };',
          "export { b } from './other.remote.ts';",
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'a', type: 'query', line: 2 },
      { name: 'alias', type: 'query', line: 2 },
    ]);
  });

  it('ignores calls not from $app/server, type-only imports and other declarations', () => {
    expect(
      parse(
        [
          "import type { query as typed } from '$app/server';",
          "import { type command, getRequestEvent, query } from '$app/server';",
          "import { form } from './elsewhere';",
          'export const a = typed(() => 1);',
          'export const b = command(() => 1);',
          'export const c = form(() => 1);',
          'export const d = getRequestEvent();',
          'export const e = query.other(() => 1);',
          'export const f = query[`batch`](() => 1);',
          'export const { g } = query(() => 1);',
          'export const h = 1, i = (0, query)(() => 1);',
          'export function j() {}',
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(parse('export const a = query(() => 1);')).toEqual([]);
  });

  it('is null when the module cannot be parsed', () => {
    expect(parse('export const = ;')).toBeNull();
  });
});

describe('analyzeRemoteFunctions', () => {
  it('is disabled without a source directory', () => {
    expect(analyzeRemoteFunctions('/app', null, [])).toEqual({
      enabled: false,
      functions: [],
      errors: [],
    });
  });

  it('lists unloaded modules from the source, without running them', () => {
    const root = project({
      'src/lib/todos.remote.ts': [
        "import { query, form } from '$app/server';",
        "globalThis.__sdtRemoteRan = 'yes';",
        'export const getTodos = query(() => []);',
        "export const addTodo = form('unchecked', () => {});",
      ].join('\n'),
      'src/broken.remote.ts': 'export const = ;',
    });
    expect(analyzeRemoteFunctions(root, path.join(root, 'src'), [])).toEqual({
      enabled: true,
      functions: [
        {
          name: 'getTodos',
          type: 'query',
          file: 'src/lib/todos.remote.ts',
          line: 3,
          loaded: false,
        },
        { name: 'addTodo', type: 'form', file: 'src/lib/todos.remote.ts', line: 4, loaded: false },
      ],
      errors: [{ file: 'src/broken.remote.ts', message: 'could not be parsed' }],
    });
    expect((globalThis as Record<string, unknown>).__sdtRemoteRan).toBeUndefined();
  });

  it('merges what SvelteKit attached to loaded modules, which wins over the parse', () => {
    const root = project({
      'src/lib/todos.remote.ts': [
        "import { query, form } from '$app/server';",
        'export const getTodos = query(() => []);',
        "export const addTodo = form('unchecked', () => {});",
      ].join('\n'),
      // outside src: only the runtime knows it
      'shared/stats.remote.ts': '',
      'src/lib/not-loaded.remote.ts':
        "import { command } from '$app/server';\nexport const wipe = command(() => {});",
    });
    const todos = path.join(root, 'src/lib/todos.remote.ts');
    const result = analyzeRemoteFunctions(root, path.join(root, 'src'), [
      node(todos, {
        getTodos: kitQuery({ type: 'query', id: 'h1/getTodos', dev_loc: { line: 2 } }),
        // no dev_loc: the parsed line is kept
        addTodo: kitForm({ type: 'form', id: 'h1/addTodo' }),
        helper: 1,
        odd: kitQuery({ type: 'query' }),
        nested: { __: null },
      }),
      node(path.join(root, 'shared/stats.remote.ts'), {
        getStats: kitQuery({ type: 'query', id: 'h2/getStats', dev_loc: { line: 5 } }),
      }),
      // not evaluated (yet), not a remote file, no exports: skipped
      node(path.join(root, 'src/lib/not-loaded.remote.ts'), {}, false),
      node(path.join(root, 'src/lib/plain.ts'), { x: kitQuery({ type: 'query', id: 'h3/x' }) }),
      node(path.join(root, 'src/lib/empty.remote.ts'), null),
    ]);
    expect(result.functions).toEqual([
      {
        name: 'getStats',
        type: 'query',
        id: 'h2/getStats',
        file: 'shared/stats.remote.ts',
        line: 5,
        loaded: true,
      },
      {
        name: 'wipe',
        type: 'command',
        file: 'src/lib/not-loaded.remote.ts',
        line: 2,
        loaded: false,
      },
      {
        name: 'getTodos',
        type: 'query',
        id: 'h1/getTodos',
        file: 'src/lib/todos.remote.ts',
        line: 2,
        loaded: true,
      },
      {
        name: 'addTodo',
        type: 'form',
        id: 'h1/addTodo',
        file: 'src/lib/todos.remote.ts',
        line: 3,
        loaded: true,
      },
    ]);
  });

  it('gives root-relative paths when the root is reached through a symlink', () => {
    const real = project({
      'src/a.remote.ts': "import { query } from '$app/server';\nexport const a = query(() => 1);",
      'src/bad.remote.ts': 'export const = ;',
    });
    const link = path.join(project({}), 'link');
    fs.symlinkSync(real, link);
    const result = analyzeRemoteFunctions(link, path.join(link, 'src'), [
      node(path.join(real, 'src/a.remote.ts'), { a: kitQuery({ type: 'query', id: 'h/a' }) }),
    ]);
    expect(result.functions).toEqual([
      { name: 'a', type: 'query', id: 'h/a', file: 'src/a.remote.ts', line: 2, loaded: true },
    ]);
    expect(result.errors).toEqual([{ file: 'src/bad.remote.ts', message: 'could not be parsed' }]);
  });

  it('merges a pnpm-linked dependency with what its loaded module reports', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { lib: '1' } }),
      'node_modules/.pnpm/lib@1/node_modules/lib/package.json': JSON.stringify({
        name: 'lib',
        peerDependencies: { '@sveltejs/kit': '^3' },
      }),
      'node_modules/.pnpm/lib@1/node_modules/lib/a.remote.js':
        "import { command } from '$app/server';\nexport const go = command(() => {});",
    });
    const store = path.join(root, 'node_modules/.pnpm/lib@1/node_modules/lib');
    fs.symlinkSync(store, path.join(root, 'node_modules/lib'));
    const file = 'node_modules/.pnpm/lib@1/node_modules/lib/a.remote.js';
    const loaded = [
      node(path.join(store, 'a.remote.js'), { go: kitQuery({ type: 'command', id: 'h/go' }) }),
    ];
    expect(analyzeRemoteFunctions(root, path.join(root, 'src'), loaded).functions).toEqual([
      { name: 'go', type: 'command', id: 'h/go', file, line: 2, loaded: true, package: 'lib' },
    ]);
  });

  it('parses a file reached twice once', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { lib: '1', alias: '1' } }),
      'libs/lib/package.json': JSON.stringify({ peerDependencies: { '@sveltejs/kit': '^3' } }),
      'libs/lib/bad.remote.js': 'export const = ;',
      'libs/lib/a.remote.js':
        "import { query } from '$app/server';\nexport const a = query(() => 1);",
      'src/.keep': '',
    });
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.symlinkSync(path.join(root, 'libs/lib'), path.join(root, 'node_modules/lib'));
    fs.symlinkSync(path.join(root, 'libs/lib'), path.join(root, 'node_modules/alias'));
    const scan = scanRemoteFiles(root, path.join(root, 'src'));
    expect(scan.entries.map(e => e.name)).toEqual(['a']);
    expect(scan.errors).toEqual([path.join(root, 'libs/lib/bad.remote.js')]);
  });

  it('names the package of modules shipped in node_modules', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { 'kit-lib': '1' } }),
      'node_modules/kit-lib/package.json': JSON.stringify({
        name: 'kit-lib',
        peerDependencies: { '@sveltejs/kit': '^3' },
      }),
      'node_modules/kit-lib/dist/auth.remote.js': [
        "import { command } from '$app/server';",
        'export const logout = command(() => {});',
      ].join('\n'),
      // a transitive one, known only once loaded
      'node_modules/other/package.json': JSON.stringify({ name: 'other' }),
      'node_modules/other/lib/remote.js': '',
      'src/.keep': '',
    });
    const result = analyzeRemoteFunctions(root, path.join(root, 'src'), [
      node(path.join(root, 'node_modules/other/lib/remote.js'), {
        ping: kitQuery({ type: 'query', id: 'h4/ping' }),
      }),
    ]);
    expect(result.functions).toEqual([
      {
        name: 'logout',
        type: 'command',
        file: 'node_modules/kit-lib/dist/auth.remote.js',
        line: 2,
        loaded: false,
        package: 'kit-lib',
      },
      {
        name: 'ping',
        type: 'query',
        id: 'h4/ping',
        file: 'node_modules/other/lib/remote.js',
        loaded: true,
        package: 'other',
      },
    ]);
  });
});
