import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sveltekit } from '@sveltejs/kit/vite';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { svelteDevtools } from '../src/plugin.js';
import type { RemoteFunctionsResult } from '../src/types.js';

// Against the real SvelteKit, so a change to the metadata it attaches to
// remote exports (internal API) fails here. Not inside node_modules: SvelteKit
// treats such files as a package's. Linked to this package's node_modules so
// its generated code resolves `@sveltejs/kit`.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-kit-remote-')));
const ownModules = path.join(import.meta.dirname, '../node_modules');
for (const name of fs.readdirSync(ownModules)) {
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.join(ownModules, name), path.join(root, 'node_modules', name));
}
const files: Record<string, string> = {
  'package.json': JSON.stringify({ type: 'module', dependencies: { 'kit-lib': '1.0.0' } }),
  // A library shipping remote functions: SvelteKit only treats a package's
  // remote files as remote with a peer dependency on it.
  'node_modules/kit-lib/package.json': JSON.stringify({
    name: 'kit-lib',
    type: 'module',
    exports: { './auth.remote.js': './auth.remote.js' },
    peerDependencies: { '@sveltejs/kit': '^3', svelte: '^5' },
  }),
  'node_modules/kit-lib/auth.remote.js': [
    "import { command } from '$app/server';",
    'export const logout = command(() => {});',
  ].join('\n'),
  'src/app.html': '<html><head>%sveltekit.head%</head><body>%sveltekit.body%</body></html>',
  'src/routes/+page.svelte': [
    '<script>',
    "  import { getCount } from '../lib/data.remote';",
    "  import { logout } from 'kit-lib/auth.remote.js';",
    '</script>',
    '<p>{typeof getCount}{typeof logout}</p>',
  ].join('\n'),
  'src/lib/data.remote.ts': [
    "import { form, query } from '$app/server';",
    '',
    'export const getCount = query(() => 1);',
    "export const save = form('unchecked', () => {});",
  ].join('\n'),
  // Imported by nothing: must be listed without being run.
  'src/lib/unused.remote.ts': [
    "import { command } from '$app/server';",
    '(globalThis as Record<string, unknown>).__sdtUnusedRemoteRan = true;',
    'export const wipe = command(() => {});',
  ].join('\n'),
};
for (const [file, code] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), code);
}

let server: ViteDevServer;
let origin: string;
const cwd = process.cwd();

beforeAll(async () => {
  // SvelteKit resolves its own paths against the cwd, not the Vite root.
  process.chdir(root);
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    server: { port: 0, host: 'localhost' },
    // Only the server render matters here; the client prebundle would pick
    // up kit-lib's remote file as an entry, which SvelteKit externalizes.
    optimizeDeps: { noDiscovery: true },
    // A cold SSR prebundle is redone during the first request ("new version
    // of the pre-bundle"), which fails that render in CI.
    ssr: { optimizeDeps: { noDiscovery: true } },
    plugins: [
      svelteDevtools({ componentTracking: false }),
      sveltekit({ experimental: { remoteFunctions: true } }),
    ],
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
}, 30_000);

afterAll(async () => {
  await server?.close();
  process.chdir(cwd);
  fs.rmSync(root, { recursive: true, force: true });
});

async function listRemoteFunctions(): Promise<RemoteFunctionsResult> {
  const plugin = server.config.plugins.find(p => p.name === 'vite-devtools-svelte')!;
  const token = (plugin.api as { getDevtoolsToken: () => string }).getDevtoolsToken();
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/__svelte-devtools/mcp`), {
      requestInit: { headers: { 'x-svelte-devtools-token': token } },
    }),
  );
  try {
    const result = await client.callTool({ name: 'get_remote_functions', arguments: {} });
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  } finally {
    await client.close();
  }
}

it('lists remote functions from the source first, then with the id SvelteKit gives them', async () => {
  const before = await listRemoteFunctions();
  expect(before).toEqual({
    enabled: true,
    functions: [
      {
        name: 'logout',
        type: 'command',
        file: 'node_modules/kit-lib/auth.remote.js',
        line: 2,
        loaded: false,
        package: 'kit-lib',
      },
      { name: 'getCount', type: 'query', file: 'src/lib/data.remote.ts', line: 3, loaded: false },
      { name: 'save', type: 'form', file: 'src/lib/data.remote.ts', line: 4, loaded: false },
      { name: 'wipe', type: 'command', file: 'src/lib/unused.remote.ts', line: 3, loaded: false },
    ],
    errors: [],
  });

  // Server-rendering the page makes SvelteKit load the module it imports.
  expect((await fetch(`${origin}/`)).status).toBe(200);
  const after = await listRemoteFunctions();
  expect(after.functions).toMatchObject([
    { ...before.functions[0], loaded: true },
    { ...before.functions[1], loaded: true },
    { ...before.functions[2], loaded: true },
    before.functions[3],
  ]);
  // `<hash of the file>/<export>`, as the request URL has it.
  const ids = after.functions.map(f => f.id?.split('/'));
  expect(ids.map(id => id?.[1])).toEqual(['logout', 'getCount', 'save', undefined]);
  expect(ids[1]![0]).toBe(ids[2]![0]);
  expect(ids[0]![0]).not.toBe(ids[1]![0]);
  expect(ids[0]![0]!.length).toBeGreaterThan(0);
  expect((globalThis as Record<string, unknown>).__sdtUnusedRemoteRan).toBeUndefined();
}, 30_000);
