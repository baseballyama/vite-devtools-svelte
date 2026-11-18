import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = new URL('../bin/vite-devtools-svelte.mjs', import.meta.url).pathname;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A project with an install of the package; `cli` is its dist/cli.mjs, if any. */
function project(cli?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vds-bin-'));
  dirs.push(dir);
  const pkg = path.join(dir, 'node_modules', '@sveltejs', 'vite-devtools-svelte');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@sveltejs/vite-devtools-svelte', version: '0.8.0', type: 'module' }),
  );
  if (cli !== undefined) fs.writeFileSync(path.join(pkg, 'dist', 'cli.mjs'), cli);
  return dir;
}

describe('bin', () => {
  it("runs the project's own CLI", () => {
    const cwd = project(
      'export async function run(argv, opts) { console.log(JSON.stringify({ argv, opts })); return 3; }',
    );
    const res = spawnSync(process.execPath, [BIN, 'mcp'], { cwd, encoding: 'utf8' });
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout)).toEqual({ argv: ['mcp'], opts: {} });
  });

  it.skipIf(!fs.existsSync(new URL('../dist/cli.mjs', import.meta.url)))(
    'falls back to its own CLI, naming an install without one',
    async () => {
      const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'vds-bin-registry-'));
      dirs.push(registry);
      const client = new Client({ name: 'test', version: '0' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [BIN, 'mcp'],
          cwd: project(),
          env: {
            ...(process.env as Record<string, string>),
            VITE_DEVTOOLS_SVELTE_REGISTRY: registry,
          },
        }),
      );
      try {
        const result = await client.callTool({ name: 'get_project_info', arguments: {} });
        expect((result.content as Array<{ text: string }>)[0]!.text).toContain(
          '@sveltejs/vite-devtools-svelte 0.8.0, which does not announce its dev server',
        );
      } finally {
        await client.close();
      }
    },
  );
});
