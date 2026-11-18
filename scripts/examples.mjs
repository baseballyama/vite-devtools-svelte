#!/usr/bin/env node
// Start every app in examples/ at once, each on its own fixed port, so the
// DevTools can be checked against all of them in one sitting.
//
//   pnpm examples                      # all apps, standalone /.svelte-devtools/
//   pnpm examples --dock               # all apps inside the Vite DevTools dock
//   pnpm examples kit-spa kit-ssg      # only these apps
//   pnpm examples --auth               # keep the one-time code (off by default here)
//   pnpm examples --list               # print the apps and exit
//
// `devtoolsExample.dock: true` marks an app that always loads @vitejs/devtools.
// An app is any examples/<dir>/package.json with a `devtoolsExample.port`;
// `devtoolsExample.server` names a custom Node server (started with PORT set)
// instead of `vite dev`. Ctrl+C stops exactly the processes started here.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const examplesDir = path.join(repoRoot, 'examples');

// (`pnpm examples -- --list` passes the `--` through.)
const args = process.argv.slice(2).filter(a => a !== '--');
const flags = new Set(args.filter(a => a.startsWith('--')));
const only = args.filter(a => !a.startsWith('--'));
const known = new Set(['--dock', '--auth', '--list', '--help']);
for (const f of flags) {
  if (!known.has(f)) {
    console.error(`unknown option ${f} (known: ${[...known].join(', ')})`);
    process.exit(2);
  }
}

/** @typedef {{ name: string, dir: string, port: number, server?: string, description: string, base: string, alwaysDock: boolean }} App */

/** @returns {App[]} */
function discoverApps() {
  const apps = [];
  for (const entry of fs.readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(examplesDir, entry.name);
    const pkgFile = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const meta = pkg.devtoolsExample;
    if (!meta || typeof meta.port !== 'number') continue;
    apps.push({
      name: entry.name,
      dir,
      port: meta.port,
      server: meta.server,
      description: pkg.description ?? '',
      base: meta.base ?? '/',
      alwaysDock: meta.dock === true,
    });
  }
  apps.sort((a, b) => a.port - b.port);
  const ports = new Map();
  for (const app of apps) {
    if (ports.has(app.port)) {
      throw new Error(`port ${app.port} is used by both ${ports.get(app.port)} and ${app.name}`);
    }
    ports.set(app.port, app.name);
  }
  return apps;
}

const all = discoverApps();

if (flags.has('--help')) {
  console.log(fs.readFileSync(import.meta.filename, 'utf8').split('\nimport ')[0]);
  process.exit(0);
}

if (flags.has('--list')) {
  for (const app of all) console.log(`${app.name.padEnd(18)} :${app.port}  ${app.description}`);
  process.exit(0);
}

const unknown = only.filter(n => !all.some(a => a.name === n));
if (unknown.length > 0) {
  console.error(
    `unknown app(s): ${unknown.join(', ')}\navailable: ${all.map(a => a.name).join(', ')}`,
  );
  process.exit(2);
}
const apps = only.length > 0 ? all.filter(a => only.includes(a.name)) : all;

// The apps load the plugin and its UI from the built package.
const pluginDist = path.join(repoRoot, 'packages/vite-devtools-svelte/dist');
for (const required of ['index.mjs', 'client/index.html']) {
  if (!fs.existsSync(path.join(pluginDist, required))) {
    console.error(
      `packages/vite-devtools-svelte/dist/${required} is missing: run \`pnpm build\` first.`,
    );
    process.exit(1);
  }
}
const notInstalled = apps.filter(
  app => !app.server && !fs.existsSync(path.join(app.dir, 'node_modules/vite/bin/vite.js')),
);
if (notInstalled.length > 0) {
  console.error(
    `${notInstalled.map(a => a.name).join(', ')}: dependencies missing, run \`pnpm install\` first.`,
  );
  process.exit(1);
}

const dock = flags.has('--dock');
const env = {
  ...process.env,
  SVELTE_DEVTOOLS_DOCK: dock ? '1' : '0',
  SVELTE_DEVTOOLS_CLIENT_AUTH: flags.has('--auth') ? '1' : '0',
  FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
};

const COLORS = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96];
const width = Math.max(...apps.map(a => a.name.length));
/** @type {Map<string, import('node:child_process').ChildProcess>} */
const children = new Map();
let stopping = false;
/** Apps that exited before Ctrl+C (e.g. port taken): left out of the banner, exit code 1. */
const failed = new Set();

function prefixLines(app, color, stream, target) {
  let buffered = '';
  const tag = `\u001B[${color}m${app.name.padEnd(width)}\u001B[0m │ `;
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) target.write(tag + line + '\n');
  });
  stream.on('end', () => {
    if (buffered) target.write(tag + buffered + '\n');
  });
}

apps.forEach((app, i) => {
  const color = COLORS[i % COLORS.length];
  const command = app.server
    ? [process.execPath, [path.join(app.dir, app.server)]]
    : [
        process.execPath,
        [
          path.join(app.dir, 'node_modules/vite/bin/vite.js'),
          'dev',
          '--port',
          String(app.port),
          '--strictPort',
        ],
      ];
  const child = spawn(command[0], command[1], {
    cwd: app.dir,
    env: { ...env, PORT: String(app.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(app.name, child);
  prefixLines(app, color, child.stdout, process.stdout);
  prefixLines(app, color, child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    children.delete(app.name);
    if (!stopping) {
      failed.add(app.name);
      console.error(`\u001B[${color}m${app.name}\u001B[0m exited (${signal ?? code})`);
    }
    if (children.size === 0) process.exit(failed.size > 0 ? 1 : 0);
  });
});

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill('SIGTERM');
  // Anything still alive after 5 s gets SIGKILL (only the children started here).
  setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
    process.exit(failed.size > 0 ? 1 : 0);
  }, 5000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const mode = dock ? 'dock (Vite DevTools)' : 'standalone';
setTimeout(() => {
  // `dock: true` apps always load @vitejs/devtools: no standalone page there.
  const rows = apps
    .filter(app => !failed.has(app.name))
    .map(app => {
      const origin = `http://localhost:${app.port}`;
      const appUrl = origin + app.base;
      const devtools =
        dock || app.alwaysDock ? `${appUrl} → dock → Svelte` : `${origin}/.svelte-devtools/`;
      return `  ${app.name.padEnd(width)}  ${appUrl.padEnd(34)}  ${devtools}`;
    });
  console.log(
    [
      '',
      `Examples (${mode}, one-time code ${flags.has('--auth') ? 'on' : 'off'}):`,
      ...rows,
      '',
      'What to check in each app: examples/README.md. Ctrl+C stops them all.',
      '',
    ].join('\n'),
  );
}, 4000).unref();
