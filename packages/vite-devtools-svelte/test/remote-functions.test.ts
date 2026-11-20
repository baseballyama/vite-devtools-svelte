import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeRemoteFunctions,
  findRemoteFiles,
  remoteConfigOf,
} from '../src/analyzers/remote-functions.js';

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

// What SvelteKit's `init_remote_functions` leaves on a remote export in dev.
const remote = (name: string, type: string, line: number) =>
  `export const ${name} = Object.assign(() => {}, { __: { type: '${type}', id: 'h/${name}', name: '${name}', dev_loc: { file: 'x', line: ${line}, column: 13 } } });\n`;

describe('remoteConfigOf', () => {
  it('is null unless experimental.remoteFunctions is on', () => {
    expect(remoteConfigOf({})).toBeNull();
    expect(remoteConfigOf({ files: { src: '/app/src' } })).toBeNull();
    expect(
      remoteConfigOf({ experimental: { remoteFunctions: false }, files: { src: '/app/src' } }),
    ).toBeNull();
  });

  it("reads files.src and moduleExtensions, defaulting to SvelteKit's", () => {
    const on = { experimental: { remoteFunctions: true }, files: { src: '/app/src' } };
    expect(remoteConfigOf(on)).toEqual({ srcDir: '/app/src', moduleExtensions: ['.js', '.ts'] });
    expect(remoteConfigOf({ ...on, moduleExtensions: ['.mts'] })?.moduleExtensions).toEqual([
      '.mts',
    ]);
  });
});

describe('findRemoteFiles', () => {
  it('finds remote.ts and *.remote.ts with the configured extensions, outside node_modules', () => {
    const root = project({
      'src/lib/todos.remote.ts': '',
      'src/lib/remote.js': '',
      'src/routes/a/data.remote.ts': '',
      'src/lib/types.remote.d.ts': '',
      'src/lib/remote.svelte': '',
      'src/lib/not-remote.ts': '',
      'src/lib/other.remote.mts': '',
      'src/node_modules/pkg/x.remote.ts': '',
    });
    const found = findRemoteFiles(path.join(root, 'src'), ['.js', '.ts']);
    expect(found.map(f => path.relative(root, f).split(path.sep).join('/'))).toEqual([
      'src/lib/remote.js',
      'src/lib/todos.remote.ts',
      'src/routes/a/data.remote.ts',
    ]);
  });

  it('is empty for a missing directory', () => {
    expect(findRemoteFiles('/nonexistent/src', ['.ts'])).toEqual([]);
  });
});

describe('analyzeRemoteFunctions', () => {
  it('is disabled without a remote config', async () => {
    expect(await analyzeRemoteFunctions('/app', null, null)).toEqual({
      enabled: false,
      functions: [],
      errors: [],
    });
  });

  it('reports every remote file as an error when modules cannot run', async () => {
    const root = project({ 'src/a.remote.ts': '' });
    const config = { srcDir: path.join(root, 'src'), moduleExtensions: ['.ts'] };
    const result = await analyzeRemoteFunctions(root, config, null);
    expect(result.enabled).toBe(true);
    expect(result.errors).toEqual([{ file: 'src/a.remote.ts', message: expect.any(String) }]);
  });

  it("lists the exports SvelteKit marked, through the dev server's SSR runner", async () => {
    const root = project({
      'src/lib/todos.remote.ts':
        remote('getTodos', 'query', 3) +
        remote('getUser', 'query_batch', 7) +
        remote('addTodo', 'form', 11) +
        // Not a remote function: no metadata, so it is skipped.
        'export const helper = 1;\n',
      'src/broken.remote.ts': "throw new Error('db down');\n",
    });
    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      const ssr = server.environments.ssr as unknown as {
        runner: { import: (f: string) => Promise<Record<string, unknown>> };
      };
      const config = { srcDir: path.join(root, 'src'), moduleExtensions: ['.ts'] };
      const result = await analyzeRemoteFunctions(root, config, f => ssr.runner.import(f));
      expect(result).toEqual({
        enabled: true,
        functions: [
          {
            name: 'getTodos',
            type: 'query',
            id: 'h/getTodos',
            file: 'src/lib/todos.remote.ts',
            line: 3,
          },
          {
            name: 'getUser',
            type: 'query_batch',
            id: 'h/getUser',
            file: 'src/lib/todos.remote.ts',
            line: 7,
          },
          {
            name: 'addTodo',
            type: 'form',
            id: 'h/addTodo',
            file: 'src/lib/todos.remote.ts',
            line: 11,
          },
        ],
        errors: [{ file: 'src/broken.remote.ts', message: 'db down' }],
      });
    } finally {
      await server.close();
    }
  });
});
