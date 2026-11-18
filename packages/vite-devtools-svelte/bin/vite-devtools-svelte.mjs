#!/usr/bin/env node
// Runs the CLI of the copy installed in the project of the current directory,
// so the MCP tools match the plugin its dev server runs (as npx would); this
// copy otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let cli = new URL('../dist/cli.mjs', import.meta.url).href;
let outdatedLocal;
try {
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const pkg = require.resolve('@sveltejs/vite-devtools-svelte/package.json');
  const local = path.join(path.dirname(pkg), 'dist', 'cli.mjs');
  if (existsSync(local)) cli = pathToFileURL(local).href;
  else outdatedLocal = JSON.parse(readFileSync(pkg, 'utf8')).version;
} catch {
  // Not installed in this project.
}

const { run } = await import(cli);
const code = await run(process.argv.slice(2), { outdatedLocal });
if (code !== null) process.exitCode = code;
