#!/usr/bin/env node
// Compatibility smoke test for one profile of e2e/compat/matrix.json.
// Contract: e2e/compat/README.md "What is checked".
//
//   node e2e/compat/smoke.mjs <profile> [--dock] [--tier=1|2]
//        [--max-min=10] [--json=<file>] [--keep-home]
//
// Expected values come from matrix.json and the fixture, never from plugin
// source constants. N/A (a step that does not apply to the profile) is never
// a PASS. Exit 0 only if every step is PASS or N/A; 1 on any FAIL; 3
// otherwise; 4 watchdog.
//
// Output can end up in public CI logs: the child's output is only shown as a
// masked tail and no trace/video/HAR/screenshots are written. A crash during
// the HMR edit leaves `<file>.smoke-backup`, restored by the next run.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.findIndex(a => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i === -1) return d;
  return argv[i].includes('=') ? argv[i].slice(n.length + 3) : argv[i + 1];
};
const profileId = argv.find(a => !a.startsWith('--'));
const dock = flag('dock');
const mode = dock ? 'dock' : 'standalone';
const tier = Number(opt('tier', '2'));
const maxMin = Number(opt('max-min', '10'));
const jsonOut = opt('json');

// Not imported from src; extra tools are allowed and must not break listing.
const REQUIRED_TOOLS = [
  'compare_sessions',
  'delete_session',
  'end_session',
  'get_component_hotspots',
  'get_component_relations',
  'get_fps_drops',
  'get_live_components',
  'get_load_waterfall',
  'get_project_info',
  'get_reactive_graph_problems',
  'get_render_profile',
  'get_routes',
  'list_performance_issues',
  'list_sessions',
  'load_session',
  'start_session',
  'get_reactive_summary',
  'get_reactive_scope',
  'get_state_timeline',
  'get_capture_info',
];
// Same markers as perf/check-prod-noop.mjs (kept in sync by hand).
const PROD_MARKERS = [
  '__SVELTE_DEVTOOLS__',
  'svelte-devtools:',
  'virtual:svelte-devtools',
  '__svelte_devtools_record_load',
  '@vitejs/devtools/client/inject',
  '/__devtools/embedded.js',
  '__devtools',
];
function loadProfile(id) {
  const matrix = JSON.parse(fs.readFileSync(path.join(repoRoot, 'e2e/compat/matrix.json'), 'utf8'));
  const entry = matrix.profiles.find(p => p.id === id);
  if (!entry)
    throw new Error(`unknown profile ${id} (matrix: ${matrix.profiles.map(p => p.id).join(', ')})`);
  return {
    ...entry,
    kit: entry.framework === 'kit',
    appDir: path.resolve(repoRoot, entry.dir),
    targets: entry.smoke ?? {},
  };
}

const PLAN = [
  'T1 dev server starts on loopback',
  'T1 mode is the requested one',
  'T1 MCP 403: no token / wrong token / duplicated header',
  'T1 MCP initialize + required tools present',
  'T1 MCP session id traversal rejected (C-7)',
  'T1 get_project_info versions = matrix',
  'T1 get_routes',
  'T1 get_capture_info',
  'T2 app first view (runtime present, inactive before any consumer)',
  'T2 lease: first MCP call activates the runtime; fixture components listed',
  'T2 get_reactive_summary: policy/coverage, rows + other = total',
  'T2 scripted state change appears in get_state_timeline',
  'T2 DevTools UI first view (authorized, fixture components rendered)',
  'T2 Svelte Inspector: dock toggle, hover shows the source; not mounted without the dock',
  'T2 HMR: page updates without reload, fixture components still listed',
  'T2 restart: same browser reconnects (app + UI), runtime resyncs',
  'T2 Kit SSR HTML',
  'T2 Kit load profile recorded',
  'T2 no page errors',
  'T1 production build has no DevTools code',
  'repo: pnpm-lock.yaml and the profile dir unchanged by the run',
  'privacy: no token / code in stdout or --json',
];
const ledger = new Map(PLAN.map(s => [s, { step: s, status: 'NOT RUN' }]));
const out = []; // everything this script printed (privacy check)
const t0 = Date.now();

function say(line) {
  out.push(line);
  console.log(line);
}

// A fact named like a ledger field goes under facts.<name> so it cannot
// overwrite the step's status.
const LEDGER_KEYS = new Set(['step', 'status', 'ms', 'error', 'reason']);
function set(stepName, status, detail = {}) {
  const own = {};
  const facts = {};
  for (const [k, v] of Object.entries(detail)) {
    if (!LEDGER_KEYS.has(k)) own[k] = v;
    else if ((k === 'error' && status === 'FAIL') || (k === 'reason' && status !== 'PASS'))
      own[k] = v;
    else facts[k] = v;
  }
  if (Object.keys(facts).length > 0) own.facts = facts;
  const e = { ...own, step: stepName, status, ms: Date.now() - t0 };
  ledger.set(stepName, e);
  say(`${status} ${stepName}${Object.keys(detail).length > 0 ? ' ' + JSON.stringify(detail) : ''}`);
}

const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms);
  });

async function withTimeout(label, ms, fn) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label}: timeout after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// fn returns evidence (PASS) or one of
// { unverified | notChecked | notRun | expectedFail: '<why>' }; a throw is FAIL.
let currentStep = null;
let lastStep = null;

async function step(name, ms, fn) {
  if (!ledger.has(name)) throw new Error(`step not in PLAN: ${name}`);
  currentStep = name;
  let result;
  try {
    const r = (await withTimeout(name, ms, fn)) ?? {};
    if (r.unverified) set(name, 'UNVERIFIED', { reason: r.unverified });
    else if (r.notChecked) set(name, 'NOT CHECKED', { reason: r.notChecked });
    else if (r.notRun) set(name, 'NOT RUN', { reason: r.notRun });
    else if (r.expectedFail) set(name, 'EXPECTED-FAIL', { reason: r.expectedFail });
    else set(name, 'PASS', r);
    result = r;
  } catch (e) {
    set(name, 'FAIL', { error: mask(String(e?.message ?? e)).slice(0, 2000) }); // incl. Playwright call log
  } finally {
    currentStep = null;
    lastStep = name;
  }
  return result;
}

const phase = () => currentStep ?? `between steps (after: ${lastStep ?? 'start'})`;
const urlPath = u => {
  try {
    return new URL(u).pathname;
  } catch {
    return String(u ?? '').replace(/[?#].*$/, '');
  }
};
// keeps a trailing :line:col (stack frames put it after the query)
const stripUrls = text =>
  String(text).replaceAll(/https?:\/\/[^\s)'"]+/g, m => {
    const lc = m.match(/(:\d+:\d+)$/)?.[1] ?? '';
    return urlPath(lc ? m.slice(0, -lc.length) : m) + lc;
  });
function pageErrorEntry(e) {
  return {
    message: mask(stripUrls(e?.message ?? e)).slice(0, 200),
    name: e?.name ?? null,
    step: phase(),
    ms: Date.now() - t0,
    stack: String(e?.stack ?? '')
      .split('\n')
      .slice(1, 6)
      .map(l => mask(stripUrls(l.trim())).slice(0, 200)),
  };
}
function consoleErrorEntry(m) {
  const loc = m.location?.() ?? {};
  return {
    message: mask(stripUrls(m.text())).slice(0, 200),
    url: loc.url ? mask(urlPath(loc.url)) : null,
    line: loc.lineNumber ?? null,
    step: phase(),
    ms: Date.now() - t0,
  };
}

const secrets = new Set();
function mask(text) {
  let t = String(text);
  for (const s of secrets) if (s) t = t.split(s).join('<secret>');
  return t
    .replaceAll(/claude mcp add[^\n]*/g, '<mcp add line>')
    .replaceAll(/x-svelte-devtools-token:\s*\S+/gi, 'x-svelte-devtools-token:<secret>')
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replaceAll(/(auth code\s+)\d{6}/g, '$1<code>')
    .replaceAll(/devframe_otp=\d{6}/g, 'devframe_otp=<code>')
    .replaceAll(repoRoot, '<repo>')
    .replaceAll(CI_DIRS, '<ci>')
    .replaceAll(os.tmpdir(), '<tmp>')
    .replaceAll(/\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+/g, '<home>');
}
// CI logs are public: mask the runner's workspace and temp paths.
const CI_DIRS = new RegExp(
  ['GITHUB_WORKSPACE', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE']
    .map(k => process.env[k])
    .filter(v => v && v.length > 3)
    .map(v => v.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') || '(?!)',
  'g',
);

const cleanup = [];
async function runCleanup() {
  for (const fn of cleanup.splice(0).toReversed()) {
    try {
      await fn();
    } catch {}
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function viteBin(appDir) {
  const req = createRequire(path.join(appDir, 'package.json'));
  return path.join(path.dirname(req.resolve('vite/package.json')), 'bin/vite.js');
}

/** The MCP token the dev server on `port` wrote to its registry file, once there. */
function registeredToken(home, port) {
  const registry = path.join(home, 'registry');
  try {
    const name = fs.readdirSync(registry).find(n => n.endsWith(`-${port}.json`));
    return name ? JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8')).token : null;
  } catch {
    return null;
  }
}

function childEnv(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    VITE_DEVTOOLS_SVELTE_REGISTRY: path.join(home, 'registry'),
    SVELTE_DEVTOOLS_DOCK: dock ? '1' : '0',
    BROWSER: 'none',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };
}

function configArgs(p) {
  const file = p.configs?.[mode];
  if (!file) throw new Error(`matrix.json: ${p.id} has no configs.${mode}`);
  return ['--config', file];
}

function startDev(p, { port, home }) {
  const child = spawn(
    process.execPath,
    [
      viteBin(p.appDir),
      'dev',
      ...configArgs(p),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: p.appDir,
      env: childEnv(home),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  );
  const srv = { child, port, home, base: `http://127.0.0.1:${port}`, log: '' };
  child.stdout.on('data', d => {
    srv.log += d;
  });
  child.stderr.on('data', d => {
    srv.log += d;
  });
  cleanup.push(() => stopDev(srv));
  return srv;
}

async function stopDev(srv) {
  const { child } = srv;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const kill = sig => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      /* already gone */
    }
  };
  kill('SIGTERM');
  for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++)
    await sleep(100);
  if (child.exitCode === null && child.signalCode === null) kill('SIGKILL');
}

async function waitReady(srv, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (srv.child.exitCode !== null)
      throw new Error(`dev server exited (${srv.child.exitCode}): ${mask(srv.log).slice(-600)}`);
    const token = registeredToken(srv.home, srv.port);
    // Vite's "Local:" banner and the MCP registration happen independently:
    // wait for both, or the resolved host reads as null.
    const local = srv.log.match(/Local:\s+(https?:\/\/\S+)/)?.[1];
    if (token && local) {
      secrets.add(token);
      srv.token = token;
      try {
        const r = await fetch(srv.base + '/', { signal: AbortSignal.timeout(5000) });
        if (r.status < 500) {
          srv.local = new URL(local).hostname;
          return;
        }
      } catch {
        /* not yet */
      }
    }
    await sleep(200);
  }
  throw new Error('dev server not ready');
}

function lastAuthCode(log) {
  const codes = [...log.matchAll(/auth code\s+(\d{6})/g)].map(m => m[1]);
  const links = [...log.matchAll(/devframe_otp=(\d{6})/g)].map(m => m[1]);
  const code = codes.at(-1) ?? links.at(-1) ?? null;
  if (code) secrets.add(code);
  return code;
}

let rpcId = 0;
async function mcp(
  srv,
  method,
  params,
  { token = srv.token, ms = 15_000, rawErrors = false } = {},
) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  };
  if (token) headers['x-svelte-devtools-token'] = token;
  const r = await fetch(srv.base + '/__svelte-devtools/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params ?? {} }),
    signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  if (r.status !== 200) return { status: r.status };
  const raw = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find(l => l.startsWith('data:'))
        ?.slice(5);
  const msg = JSON.parse(raw);
  if (msg.error && rawErrors) return { status: 200, error: msg.error };
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return { status: 200, result: msg.result };
}

async function tool(srv, name, args = {}) {
  const { status, result } = await mcp(srv, 'tools/call', { name, arguments: args });
  if (status !== 200) throw new Error(`${name}: HTTP ${status}`);
  // oxlint-disable-next-line unicorn/prefer-type-error -- `isError` is the MCP tool-error flag, not a type check
  if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text?.slice(0, 200)}`);
  const text = result.content?.find(c => c.type === 'text')?.text ?? 'null';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function poll(fn, ok, ms) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (ok(last)) return last;
    await sleep(500);
  }
  throw new Error(`not reached; last ${JSON.stringify(last)?.slice(0, 200)}`);
}

function scanDir(dir, hits, root = dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanDir(p, hits, root);
    else if (/\.(m?js|html|css|json)$/.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8');
      for (const m of PROD_MARKERS)
        if (text.includes(m)) hits.push({ file: path.relative(root, p), marker: m });
    }
  }
}

function prodBuild(p, home) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `compat-${p.id}-dist-`));
  cleanup.push(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const args = [viteBin(p.appDir), 'build', ...configArgs(p), '--logLevel', 'warn'];
  // Kit writes to .svelte-kit/output (gitignored); plain Vite gets a temp outDir.
  if (!p.kit) args.push('--outDir', outDir, '--emptyOutDir');
  const res = spawnSync(process.execPath, args, {
    cwd: p.appDir,
    env: childEnv(home),
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (res.status !== 0)
    throw new Error(
      `vite build exit ${res.status}: ${mask((res.stderr?.length ?? 0) > 0 ? res.stderr : res.stdout).slice(-400)}`,
    );
  const hits = [];
  scanDir(p.kit ? path.join(p.appDir, '.svelte-kit/output') : outDir, hits);
  return hits;
}

function backupPath(p) {
  return path.join(p.appDir, p.targets.hmr.file) + '.smoke-backup';
}

function recoverBackup(p) {
  if (!p.targets.hmr) return;
  const file = path.join(p.appDir, p.targets.hmr.file);
  if (fs.existsSync(backupPath(p))) {
    fs.writeFileSync(file, fs.readFileSync(backupPath(p)));
    fs.rmSync(backupPath(p));
    say(`restored ${p.targets.hmr.file} from an interrupted run`);
  }
}

function hmrEdit(p) {
  const h = p.targets.hmr;
  const file = path.join(p.appDir, h.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(h.from)) throw new Error(`HMR marker not found in ${h.file}`);
  fs.writeFileSync(backupPath(p), original);
  const restore = () => {
    if (fs.existsSync(backupPath(p))) {
      fs.writeFileSync(file, fs.readFileSync(backupPath(p)));
      fs.rmSync(backupPath(p));
    }
  };
  cleanup.push(restore);
  process.once('exit', restore);
  fs.writeFileSync(file, original.replace(h.from, h.to));
  return restore;
}

function gitStatus(paths) {
  const r = spawnSync('git', ['status', '--porcelain', '--', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean).toSorted() : null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fileBase = f =>
  String(f ?? '')
    .split(/[\\/]/)
    .pop();

// Falls back to the HMR file: it is on the first view in every profile.
function expectedComponents(p) {
  return (p.targets.components ?? [p.targets.hmr?.file]).filter(Boolean).map(fileBase);
}

function listedFiles(list) {
  if (!Array.isArray(list)) throw new TypeError('get_live_components default is not a bare array');
  return new Set(list.map(c => fileBase(c.file)));
}

async function fixtureComponentsListed(p, srv, ms) {
  const want = expectedComponents(p);
  const got = await poll(
    async () => listedFiles(await tool(srv, 'get_live_components')),
    files => want.every(f => files.has(f)),
    ms,
  ).catch(e => {
    throw new Error(`fixture components ${want.join(', ')} not all listed (${e.message})`);
  });
  return { expected: want, listed: got.size };
}

const ANSI = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'g');
const DOCK_FRAME = 'iframe[data-iframe-pane="svelte-devtools"]';

// The dock auto-minimizes (buttons get pointer-events: none) unless a
// mousemove reached it within inactiveTimeout (3 s) or a panel is open. A move
// to the same coordinates fires no event, so move across it in steps.
async function nudgeDock(page) {
  const box = await page.locator('#devframes-dock').boundingBox();
  if (!box) return false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 3, cy, { steps: 5 });
  await page.mouse.move(cx + 3, cy, { steps: 5 });
  return true;
}

const isMinimized = page =>
  page.locator('#devframes-anchor').evaluate(el => el.classList.contains('devframes-minimized'));

async function expandDock(page) {
  await page.locator('#devframes-dock').waitFor({ state: 'attached', timeout: 20_000 });
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    await nudgeDock(page);
    if (!(await isMinimized(page))) {
      await sleep(550); // delay-200 + duration-300 transition
      return;
    }
    await sleep(200);
  }
  throw new Error('dock stayed minimized after mouse moves over #devframes-dock');
}

// The expanded 'Unauthorized' button's centre lies under the dock's logo (an
// invisible wrapper that still takes pointer events), so a centre click is
// intercepted. Pick a point whose hit-test is the button. null = none found.
function unobscuredPoint(target) {
  return target
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      const root = el.getRootNode();
      const y = r.height / 2;
      const xs = [
        r.width * 0.15,
        r.width * 0.85,
        10,
        r.width - 10,
        r.width * 0.3,
        r.width * 0.7,
        r.width / 2,
      ];
      for (const x of xs) {
        const hit = root.elementFromPoint(r.left + x, r.top + y);
        if (hit && (hit === el || el.contains(hit))) return { x: Math.round(x), y: Math.round(y) };
      }
      return null;
    })
    .catch(() => null);
}

// No background keep-alive: it could race Playwright's own move/press. Each
// attempt re-nudges right before the click for a fresh 3 s window, longer than
// the 2.5 s click timeout.
async function clickInDock(page, target) {
  let last;
  for (let i = 0; i < 3; i++) {
    await expandDock(page);
    await nudgeDock(page);
    try {
      const position = await unobscuredPoint(target);
      const at = position ? { position } : {};
      // the nudge can leave the pointer on a neighbouring entry, whose tooltip then takes the press
      await target.hover({ timeout: 2_500, ...at });
      await sleep(350);
      await target.click({ timeout: 2_500, ...at });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// Goes into failure messages: never input values, codes or screenshots.
function dockDump(page) {
  return page
    .evaluate(() => {
      const host = document.querySelector('devframes-dock-embedded');
      const root = host?.shadowRoot ?? document;
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page (serialized by evaluate); it cannot reference module scope
      const vis = el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return `${Math.round(r.width)}x${Math.round(r.height)} op${cs.opacity} pe:${cs.pointerEvents}`;
      };
      const anchor = root.querySelector('#devframes-anchor');
      return {
        host: !!host,
        shadowRoot: !!host?.shadowRoot,
        anchor: anchor
          ? { class: (anchor.getAttribute('class') ?? '').slice(0, 120), box: vis(anchor) }
          : null,
        buttons: [...root.querySelectorAll('button')].slice(0, 30).map(b => ({
          name: ((b.getAttribute('aria-label') ?? '') || (b.textContent ?? '')).trim().slice(0, 40),
          expanded: b.getAttribute('aria-expanded'),
          box: vis(b),
        })),
        iframes: [...root.querySelectorAll('iframe'), ...document.querySelectorAll('iframe')].map(
          f => f.dataset.iframePane ?? null,
        ),
        inputs: root.querySelectorAll('input').length,
      };
    })
    .catch(e => ({ dumpError: String(e?.message ?? e).slice(0, 120) }));
}

async function withDockDump(page, fn) {
  try {
    return await fn();
  } catch (e) {
    throw new Error(
      `${String(e?.message ?? e).slice(0, 1200)} | dock: ${JSON.stringify(await dockDump(page))}`,
      { cause: e },
    );
  }
}

// The hub keeps its trusted token in localStorage, so reopening after a
// reload needs no new code.
async function openDockEntry(page) {
  return withDockDump(page, async () => {
    await page.locator('devframes-dock-embedded').waitFor({ state: 'attached', timeout: 20_000 });
    const iframe = page.locator(DOCK_FRAME);
    // After a reload the hub restores the selected entry with its iframe;
    // clicking the entry again would toggle it closed.
    const restored = await iframe.waitFor({ state: 'attached', timeout: 3_000 }).then(
      () => true,
      () => false,
    );
    if (!restored)
      await clickInDock(page, page.getByRole('button', { name: 'Svelte', exact: true }));
    await iframe.waitFor({ state: 'attached', timeout: 15_000 });
    // relative at first, absolute with the SPA hash route after a restart
    const src = await iframe.getAttribute('src');
    const u = src ? new URL(src, page.url()) : null;
    if (!u || u.origin !== new URL(page.url()).origin || u.pathname !== '/.svelte-devtools/')
      throw new Error(`iframe src ${src}`);
    return page.frameLocator(DOCK_FRAME);
  });
}
async function waitCode(srv, from) {
  for (let i = 0; i < 100; i++) {
    // the auth box is ANSI-coloured
    const code = lastAuthCode(srv.log.slice(from).replaceAll(ANSI, ''));
    if (code) return code;
    await sleep(100);
  }
  throw new Error('no one-time code printed');
}

async function openStandaloneUi(ctx, srv) {
  const ui = await ctx.newPage();
  const from = srv.log.length;
  await ui.goto(srv.base + '/.svelte-devtools/', { waitUntil: 'load', timeout: 30_000 });
  const dialog = ui.getByRole('dialog', { name: 'Authorize this browser' });
  await dialog.waitFor({ timeout: 20_000 });
  const code = await waitCode(srv, from);
  await dialog.getByLabel('One-time code').fill(code);
  await dialog.locator('button[type=submit]').click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  if (/devframe_otp|token=/.test(ui.url())) throw new Error('code or token left in the URL');
  return ui;
}

async function uiShowsFixture(frame, p) {
  const want = expectedComponents(p).map(f => f.replace(/\.svelte$/, ''));
  await frame
    .getByRole('link', { name: /Components/ })
    .first()
    .click({ timeout: 10_000 })
    .catch(() => {});
  for (const name of want) {
    try {
      await frame.getByText(name, { exact: false }).first().waitFor({ timeout: 20_000 });
    } catch (e) {
      throw new Error(
        `${String(e?.message ?? e).slice(0, 600)} | ui: ${JSON.stringify(await uiDump(frame))}`,
        { cause: e },
      );
    }
  }
  return want;
}

// Selectors read from @devframes/hub-ui 1.2.0 (embedded.js, open shadow root).
// In the dock, auth belongs to the hub: our own gate must not show inside.
async function dockUi(page, srv, p) {
  const submit = await withDockDump(page, async () => {
    await page.locator('devframes-dock-embedded').waitFor({ state: 'attached', timeout: 20_000 });
    const from = srv.log.length;
    await clickInDock(page, page.getByRole('button', { name: 'Unauthorized' }));
    const code = await waitCode(srv, from); // fresh code printed for this request
    // the open panel keeps the dock expanded
    // a fill error's call log would contain the digit: replace it by a value-free message
    for (let i = 0; i < 6; i++)
      await page
        .getByLabel(`Digit ${i + 1} of 6`)
        .fill(code[i], { timeout: 10_000 })
        .catch(() => {
          throw new Error(`code input 'Digit ${i + 1} of 6' not fillable`);
        });
    // The OTP field submits itself on the 6th digit; the submit button is only
    // a fallback while the form is still there and enabled.
    const unauthorized = page.getByRole('button', { name: 'Unauthorized' });
    const authorize = page.getByRole('button', { name: 'Authorize', exact: true });
    const end = Date.now() + 15_000;
    let clicked = false;
    for (;;) {
      if ((await unauthorized.count()) === 0) break;
      // One atomic read of all alerts: the panel may vanish between a count()
      // and a later read once the auto-submit succeeds.
      const text = await page
        .getByRole('alert')
        .evaluateAll(els => els.map(el => el.textContent ?? '').join(' '))
        .catch(() => '');
      if (/didn't match|went wrong/i.test(text))
        throw new Error(`hub auth: ${text.trim().slice(0, 120)}`);
      if (
        !clicked &&
        Date.now() > end - 12_000 &&
        (await authorize.count()) &&
        (await authorize.isEnabled({ timeout: 500 }).catch(() => false))
      ) {
        // the form may vanish (auth done) between the check and the click:
        // a missed click is not a failure, the loop re-checks 'Unauthorized'
        clicked = await authorize.click({ timeout: 2_500 }).then(
          () => true,
          () => false,
        );
      }
      if (Date.now() > end)
        throw new Error('hub auth: still unauthorized 15 s after the 6th digit');
      await sleep(250);
    }
    return clicked ? 'submit button (fallback)' : 'auto-submit on the 6th digit';
  });
  const frame = await openDockEntry(page);
  const gate = await frame
    .getByRole('dialog', { name: 'Authorize this browser' })
    .waitFor({ timeout: 3_000 })
    .then(
      () => true,
      () => false,
    );
  if (gate) throw new Error('own auth gate shown inside the dock (auth not delegated to the hub)');
  return {
    authorized: 'hub',
    submit,
    iframe: 'svelte-devtools',
    components: await uiShowsFixture(frame, p),
  };
}

// Goes into failure messages: no inputs, no screenshots; the caller masks it.
function uiDump(ui) {
  // Works on a Page and on a FrameLocator (dock iframe).
  return ui
    .locator('html')
    .evaluate(
      () => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page (serialized by evaluate); it cannot reference module scope
        const visible = el => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const conn = document.querySelector('span.conn[role=status]');
        const gate = [...document.querySelectorAll('[role=dialog]')].find(d =>
          (d.getAttribute('aria-label') ?? d.textContent ?? '').includes('Authorize this browser'),
        );
        return {
          hash: location.hash,
          connection: conn ? (conn.textContent ?? '').trim() : null,
          gate: gate ? (visible(gate) ? 'visible' : 'present, hidden') : 'absent',
          nav: document.querySelector('nav [aria-current=page]')?.textContent?.trim() ?? null,
          body: (document.body?.innerText ?? '').replaceAll(/\b\d{6}\b/g, '<code>').slice(0, 300),
        };
      },
      null,
      { timeout: 2_000 },
    )
    .catch(e => ({ dumpError: String(e?.message ?? e).slice(0, 120) }));
}

// Served = real content, not status alone: Vite's SPA fallback answers any
// path with index.html (200, text/html) when Accept is */*.
async function hubServed(srv) {
  const r = await fetch(srv.base + '/__devtools/embedded.js', {
    signal: AbortSignal.timeout(10_000),
  });
  const type = r.headers.get('content-type') ?? '';
  const body = (await r.text()).trimStart();
  if (r.status !== 200) return { served: false, why: `status ${r.status}` };
  if (!/javascript/i.test(type))
    return { served: false, why: `content-type ${type.split(';')[0] || 'none'}` };
  if (body.startsWith('<')) return { served: false, why: 'HTML body' };
  return { served: true };
}

async function uiServed(srv) {
  const r = await fetch(srv.base + '/.svelte-devtools/', {
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(10_000),
  });
  const html = await r.text();
  if (r.status !== 200) return { served: false, why: `status ${r.status}` };
  if (!html.includes('<title>Svelte DevTools</title>') || !html.includes('id="app"'))
    return { served: false, why: 'not the DevTools UI HTML (fallback page?)' };
  return { served: true };
}

// Two header lines with the right token: Node joins them ("t, t"), which
// must not be accepted.
function rawStatus(srv, tokens) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      srv.base + '/__svelte-devtools/mcp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-svelte-devtools-token': tokens,
        },
        timeout: 10_000,
      },
      res => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', e => reject(new Error(mask(e.message))));
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} }));
  });
}

async function main() {
  if (argv.some(a => a.startsWith('--mode')))
    throw new Error('use --dock (single interface with CI)');
  if (!profileId) throw new Error('usage: smoke.mjs <profile> [--dock] [--tier=1|2]');
  const p = loadProfile(profileId);
  if (!p.modes.includes(mode)) throw new Error(`profile ${p.id} has no ${mode} mode`);
  if (!fs.existsSync(path.join(p.appDir, 'node_modules')))
    throw new Error(`${p.dir}: node_modules missing (install first)`);
  recoverBackup(p);
  const gitBefore = gitStatus([p.dir, 'pnpm-lock.yaml']);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), `compat-${p.id}-home-`));
  if (!flag('keep-home')) cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  const port = await freePort();
  let srv = startDev(p, { port, home });
  const getSrv = () => srv;

  const ready = await step('T1 dev server starts on loopback', 90_000, async () => {
    await waitReady(srv);
    if (srv.local !== '127.0.0.1') throw new Error(`resolved host ${srv.local}`);
    return { mode, config: configArgs(p)[1], host: srv.local };
  });
  if (ready) {
    await step('T1 mode is the requested one', 15_000, async () => {
      const hub = await hubServed(srv);
      const ui = await uiServed(srv);
      const html = await (
        await fetch(srv.base + '/', { signal: AbortSignal.timeout(10_000) })
      ).text();
      const dockScript = html.includes('/__devtools/embedded.js') || html.includes('/@id/__x00__'); // inline loader
      // our UI is needed in both modes (the dock iframe loads it too)
      if (!ui.served) throw new Error(`DevTools UI not served (${ui.why})`);
      if (mode === 'standalone') {
        if (hub.served) throw new Error('standalone expected, but the hub serves embedded.js');
        return { ui: 'served', hub: `absent (${hub.why})` };
      }
      if (!hub.served) throw new Error(`hub embedded.js not served (${hub.why})`);
      // our standalone mount prints its own banner; in dock mode it must not run
      if (/Svelte DevTools(?! MCP)[^\n]*\/\.svelte-devtools\//.test(srv.log))
        throw new Error('standalone mount banner printed in dock mode');
      return { ui: 'served', hub: 'served', dockScriptInHtml: dockScript };
    });
    await step('T1 MCP 403: no token / wrong token / duplicated header', 10_000, async () => {
      const none = await mcp(srv, 'tools/list', {}, { token: null });
      const wrong = await mcp(srv, 'tools/list', {}, { token: crypto.randomUUID() });
      const dup = await rawStatus(srv, [srv.token, srv.token]);
      if (none.status !== 403 || wrong.status !== 403 || dup !== 403)
        throw new Error(`statuses ${none.status} / ${wrong.status} / ${dup}`);
      return { none: none.status, wrong: wrong.status, duplicated: dup };
    });
    // Before the first authorized MCP call, which leases (activates) the runtime.
    const app = tier >= 2 ? await openApp(getSrv) : null;
    await step('T1 MCP initialize + required tools present', 15_000, async () => {
      const init = await mcp(srv, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'compat-smoke', version: '1' },
      });
      if (init.status !== 200) throw new Error(`initialize HTTP ${init.status}`);
      const { result } = await mcp(srv, 'tools/list');
      const names = result.tools.map(t => t.name);
      const missing = REQUIRED_TOOLS.filter(n => !names.includes(n));
      if (missing.length > 0) throw new Error(`missing tools: ${missing.join(', ')}`);
      return { required: REQUIRED_TOOLS.length, listed: names.length };
    });
    await step('T1 MCP session id traversal rejected (C-7)', 20_000, async () => {
      // Judged by protocol, not message text: the SDK turns an input
      // validation error into isError: true; a JSON-RPC -32602 error is
      // accepted too. Without isError the handler ran = FAIL. Read-only probes
      // (never delete_session).
      const probes = ['../c7-smoke-probe', '/tmp/c7-smoke-probe', 'a/b', 's_c7smoke_zzzzzz', ''];
      const before = JSON.stringify(await tool(srv, 'list_sessions'));
      for (const id of probes) {
        const r = await mcp(
          srv,
          'tools/call',
          { name: 'load_session', arguments: { id } },
          { rawErrors: true },
        );
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        const rejected = r.error ? r.error.code === -32602 : r.result?.isError === true;
        if (!rejected) throw new Error(`malformed id #${probes.indexOf(id)} reached the handler`);
      }
      if (JSON.stringify(await tool(srv, 'list_sessions')) !== before)
        throw new Error('session store changed');
      return { probes: probes.length, rejected: probes.length, storeUnchanged: true };
    });
    await step('T1 get_project_info versions = matrix', 15_000, async () => {
      const info = await tool(srv, 'get_project_info');
      const got = {
        svelte: info.svelteVersion,
        '@sveltejs/kit': info.sveltekitVersion,
        vite: info.viteVersion,
      };
      const want = {
        svelte: p.versions.svelte,
        '@sveltejs/kit': p.kit ? p.versions['@sveltejs/kit'] : 'unknown',
        vite: p.versions.vite,
      };
      for (const k of Object.keys(want))
        if (got[k] !== want[k]) throw new Error(`${k} ${got[k]} ≠ matrix ${want[k]}`);
      return got;
    });
    await step('T1 get_routes', 15_000, async () => {
      const routes = await tool(srv, 'get_routes');
      const list = Array.isArray(routes) ? routes : (routes?.routes ?? []);
      if (p.kit) {
        const want = [...new Set([p.targets.ssr?.path, p.targets.load?.path].filter(Boolean))];
        const text = JSON.stringify(list);
        const missing = want.filter(r => !text.includes(`"${r}"`));
        if (missing.length > 0) throw new Error(`routes missing ${missing.join(', ')}`);
        return { routes: list.length, checked: want };
      }
      if (list.length > 0) throw new Error(`plain Svelte profile: ${list.length} routes`);
      return { routes: 0 };
    });
    await step('T1 get_capture_info', 15_000, async () => {
      const info = await tool(srv, 'get_capture_info');
      if (!info || typeof info !== 'object' || Array.isArray(info))
        throw new Error('not an object');
      return { datasets: Object.keys(info) };
    });

    if (tier >= 2) {
      await tier2(
        p,
        getSrv,
        async () => {
          await stopDev(srv);
          srv = startDev(p, { port, home });
          await waitReady(srv);
        },
        app,
      );
    }
    await stopDev(srv);
  }

  await step('T1 production build has no DevTools code', 200_000, () => {
    const hits = prodBuild(p, home);
    if (hits.length > 0) throw new Error(`markers in build: ${JSON.stringify(hits.slice(0, 5))}`);
    return { markers: 0 };
  });
  await runCleanup(); // HMR restore etc. before the git check
  await step('repo: pnpm-lock.yaml and the profile dir unchanged by the run', 10_000, () => {
    const after = gitStatus([p.dir, 'pnpm-lock.yaml']);
    if (gitBefore === null || after === null) return { unverified: 'git status unavailable' };
    const added = after.filter(l => !gitBefore.includes(l));
    if (added.length > 0) throw new Error(`new changes: ${added.slice(0, 5).join(' | ')}`);
    return { preExisting: gitBefore.length };
  });
}

const hasRuntime = () => Object.keys(window).some(k => /^__SVELTE_.*DEVTOOLS__$/.test(k));

// Runs before any authorized MCP call: those take the collector's 60 s lease
// and activate the runtime, so "inactive before any consumer" could not be
// observed.
async function openApp(getSrv) {
  const req = createRequire(path.join(repoRoot, 'package.json'));
  // playwright-core is CJS: some Node versions expose only default.chromium
  const mod = await import(pathToFileURL(req.resolve('playwright-core')).href);
  const pw = mod.chromium ? mod : mod.default;
  const browser = await pw.chromium.launch({ headless: true });
  cleanup.push(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  // uncaught exceptions of the app page and its same-process frames (dock,
  // DevTools iframe); console errors are recorded as context only
  const errors = [];
  const consoleErrors = [];
  let consoleErrorCount = 0;
  page.on('pageerror', e => {
    if (errors.length < 10) errors.push(pageErrorEntry(e));
    else errors.overflow = (errors.overflow ?? 0) + 1;
  });
  // HMR diagnostics: Vite client console lines and main-frame navigations
  const viteLog = [];
  page.on('console', m => {
    if (m.type() === 'error') {
      consoleErrorCount++;
      if (consoleErrors.length < 10) consoleErrors.push(consoleErrorEntry(m));
    }
    const t = m.text();
    if (t.startsWith('[vite]')) viteLog.push(mask(t).slice(0, 160));
  });
  let navigations = 0;
  page.on('framenavigated', f => {
    if (f === page.mainFrame()) navigations++;
  });
  const runtimeActive = () =>
    page.evaluate(
      () => window[Object.keys(window).find(k => /^__SVELTE_.*DEVTOOLS__$/.test(k))]?._active,
    );
  const app = {
    browser,
    ctx,
    page,
    errors,
    consoleErrors,
    consoleErrorCount: () => consoleErrorCount,
    viteLog,
    navigations: () => navigations,
    runtimeActive,
  };

  await step(
    'T2 app first view (runtime present, inactive before any consumer)',
    60_000,
    async () => {
      const r = await page.goto(getSrv().base + '/', { waitUntil: 'load', timeout: 45_000 });
      if (!r || r.status() >= 400) throw new Error(`status ${r?.status()}`);
      await page.waitForFunction(hasRuntime, null, { timeout: 30_000 });
      const active = await runtimeActive();
      if (active !== false) throw new Error(`runtime active before any consumer (${active})`);
      return { httpStatus: r.status(), active };
    },
  );
  return app;
}

async function tier2(p, getSrv, restart, app) {
  const { browser, ctx, page, errors, consoleErrors, runtimeActive } = app;

  await step(
    'T2 lease: first MCP call activates the runtime; fixture components listed',
    30_000,
    async () => {
      const facts = await fixtureComponentsListed(p, getSrv(), 20_000);
      if (!(await runtimeActive())) throw new Error('runtime not active after the MCP call');
      return { ...facts, active: true };
    },
  );

  let epochBefore = null;
  await step('T2 get_reactive_summary: policy/coverage, rows + other = total', 25_000, async () => {
    const s = await poll(
      () => tool(getSrv(), 'get_reactive_summary'),
      x => x && x.stale !== true && Array.isArray(x.rows),
      20_000,
    );
    if (s.policy !== 'sampled-200ms' || s.coverage !== 'component-init')
      throw new Error(`policy ${s.policy} / coverage ${s.coverage}`);
    if ((s.components?.total ?? null) === null || (s.other ?? null) === null)
      throw new Error('total or other unknown (null)');
    if (s.rows.length + s.other.components !== s.components.total)
      throw new Error('rows + other ≠ total');
    const wantFile = p.targets.summaryFile && fileBase(p.targets.summaryFile);
    if (wantFile && !s.rows.some(r => fileBase(r.file) === wantFile))
      throw new Error(`${wantFile} not among rows`);
    epochBefore = s.epoch ?? null;
    return {
      rows: s.rows.length,
      total: s.components.total,
      policy: s.policy,
      coverage: s.coverage,
    };
  });

  await step('T2 scripted state change appears in get_state_timeline', 45_000, async () => {
    const sc = p.targets.stateChange;
    // null = declared not yet available for this profile → NOT RUN (exit 3, never a pass);
    // a missing key is a matrix error.
    if (sc === null) return { notRun: 'matrix smoke.stateChange is null for this profile' };
    if (!sc) throw new Error('INCOMPLETE: matrix.json has no smoke.stateChange key');
    const file = fileBase(sc.file);
    if (sc.path && sc.path !== '/')
      await page.goto(getSrv().base + sc.path, { waitUntil: 'load', timeout: 30_000 });
    const ofState = c => c.name === sc.state && fileBase(c.componentFile) === file;
    const brief = cs =>
      JSON.stringify(
        cs
          .filter(ofState)
          .slice(-5)
          .map(c => [c.oldValue, c.newValue]),
      );
    // Readiness first: every tracked $state has its first sample
    // (seed). Seeds record nothing, so a write before that is not observable.
    await poll(
      async () => (await tool(getSrv(), 'get_capture_info'))?.stateTimeline?.baseline,
      b => b?.complete === true,
      15_000,
    ).catch(e => {
      throw new Error(`baseline not disclosed/complete (${e.message})`);
    });
    const cursor = (await tool(getSrv(), 'get_state_timeline', { limit: 1 }))?.cursor;
    // click: a CSS selector or {role, name} (exact accessible name)
    const target =
      typeof sc.click === 'string'
        ? page.locator(sc.click)
        : page.getByRole(sc.click.role, { name: sc.click.name, exact: true });
    const clickedAt = Date.now();
    await target.first().click({ timeout: 10_000 });
    await sleep(250); // at least one 200 ms sampling tick before the first read
    const hit = c => ofState(c) && same(c.oldValue, sc.from) && same(c.newValue, sc.to);
    let changes = [];
    try {
      changes = await poll(
        async () =>
          (await tool(getSrv(), 'get_state_timeline', { since: cursor, limit: 100 }))?.changes ??
          [],
        cs => cs.some(hit),
        15_000,
      );
      await sleep(500); // a second tick: no duplicate or extra entry for this state
      changes =
        (await tool(getSrv(), 'get_state_timeline', { since: cursor, limit: 100 }))?.changes ?? [];
    } catch {
      const all = (await tool(getSrv(), 'get_state_timeline', { limit: 500 }))?.changes ?? [];
      throw new Error(
        `${sc.state} ${JSON.stringify(sc.from)}->${JSON.stringify(sc.to)} not seen; ${sc.state} entries [old,new] (last 5): ${brief(all)}`,
      );
    }
    const own = changes.filter(ofState);
    if (own.length !== 1 || !hit(own[0]))
      throw new Error(
        `expected exactly 1 ${sc.state} entry ${JSON.stringify(sc.from)}->${JSON.stringify(sc.to)}; got ${brief(changes)}`,
      );
    // The collector answers a repeated summary request from its 1 s cache
    // (PULL_FRESHNESS), possibly computed before the click. Use only an answer
    // computed after the click.
    const summary = await poll(
      () => tool(getSrv(), 'get_reactive_summary'),
      x => x && x.stale !== true && (x.computedAt ?? 0) >= clickedAt,
      5_000,
    ).catch(e => {
      throw new Error(`no summary computed after the click (${e.message})`);
    });
    const row = summary?.rows?.find(r => fileBase(r.file) === file);
    if (!row)
      throw new Error(
        `${file} not among get_reactive_summary rows: ${JSON.stringify({
          stale: summary?.stale ?? false,
          staleReason: summary?.staleReason ?? null,
          epoch: summary?.epoch ?? null,
          computedAt: summary?.computedAt ?? null,
          components: summary?.components ?? null,
          rows: (summary?.rows ?? [])
            .slice(0, 10)
            .map(r => [fileBase(r.file), r.changes, r.renders]),
          baseline: summary?.baseline ?? null,
        })}`,
      );
    // scope of that instance, with the epoch its id came from
    const live = await tool(getSrv(), 'get_live_components', { includeMeta: true });
    const inst = (live?.components ?? []).find(c => fileBase(c.file) === file);
    for (const k of ['epoch', 'total', 'captured', 'truncated', 'components'])
      if (!(k in (live ?? {}))) throw new Error(`get_live_components includeMeta lacks ${k}`);
    if (!inst || (live.epoch ?? null) === null)
      throw new Error(`${file} instance or epoch missing in get_live_components`);
    const scope = await tool(getSrv(), 'get_reactive_scope', {
      componentId: inst.id,
      epoch: live.epoch,
    });
    if (scope?.stale) throw new Error(`scope stale: ${scope.staleReason ?? 'no reason'}`);
    if (scope.scope !== inst.id || scope.epoch !== live.epoch)
      throw new Error('scope answered another instance or epoch');
    if (!Array.isArray(scope.nodes) || scope.nodes.length === 0)
      throw new Error('scope has no nodes');
    if (!['scoped', 'global-head', 'server-filter'].includes(scope.policy))
      throw new Error(`policy ${scope.policy}`);
    return {
      state: sc.state,
      file,
      from: sc.from,
      to: sc.to,
      timelineMatches: changes.filter(hit).length,
      summaryRowChanges: row.changes,
      scopeNodes: scope.nodes.length,
    };
  });

  let ui = null;
  await step(
    'T2 DevTools UI first view (authorized, fixture components rendered)',
    90_000,
    async () => {
      if (mode === 'dock') return dockUi(page, getSrv(), p);
      ui = await openStandaloneUi(ctx, getSrv());
      return { authorized: 'own gate', components: await uiShowsFixture(ui, p) };
    },
  );

  // The inspector only runs in the dock, once the hub trusts the browser (it loads the eager
  // action script then). Toggled on and off from its dock button; turning it off brings back
  // the Svelte panel the next steps read. Hover only: a click would open an editor.
  await step(
    'T2 Svelte Inspector: dock toggle, hover shows the source; not mounted without the dock',
    90_000,
    async () => {
      const host = page.locator('#svelte-inspector-host');
      if (mode !== 'dock') {
        if ((await host.count()) > 0) throw new Error('inspector mounted without Vite DevTools');
        return { mounted: false };
      }
      if (!p.targets.hmr) return { notRun: 'matrix.json has no smoke.hmr (its <h1> is hovered)' };
      await host.waitFor({ state: 'attached', timeout: 15_000 });
      const enabled = () =>
        page.evaluate(() => document.body.classList.contains('svelte-inspector-enabled'));
      const button = page.getByRole('button', { name: 'Svelte Inspector', exact: true });
      await withDockDump(page, () => clickInDock(page, button));
      let text = '';
      try {
        await poll(enabled, on => on === true, 5_000);
        await page.locator('body h1').first().hover({ timeout: 5_000 });
        const overlay = page.locator('#svelte-inspector-overlay');
        await overlay.waitFor({ timeout: 5_000 });
        text = (await overlay.textContent()) ?? '';
        if (!text.includes(`${p.targets.hmr.file}:`))
          throw new Error(`overlay does not name ${p.targets.hmr.file}: ${text.slice(0, 120)}`);
      } finally {
        // off again even when a check failed: the next steps read the Svelte panel
        if (await enabled()) await withDockDump(page, () => clickInDock(page, button));
      }
      await poll(enabled, on => on === false, 5_000);
      await page.locator(DOCK_FRAME).waitFor({ state: 'attached', timeout: 10_000 });
      // the hub runs eager scripts in its own standalone page too, which has no app to inspect
      const standalone = await ctx.newPage();
      try {
        // the dock script imports the component: once it is fetched, setup() is about to run
        const loaded = standalone.waitForResponse(
          response => response.url().includes('Inspector.svelte') && response.status() < 400,
          { timeout: 20_000 },
        );
        await standalone.goto(getSrv().base + '/__devtools/', {
          waitUntil: 'load',
          timeout: 20_000,
        });
        await loaded;
        const mounted = await poll(
          () => standalone.locator('#svelte-inspector-host').count(),
          count => count > 0,
          2_000,
        ).catch(() => 0);
        if (mounted > 0) throw new Error('inspector mounted in the standalone DevTools page');
      } finally {
        await standalone.close();
      }
      return {
        mounted: true,
        overlay: text.trim().slice(0, 80),
        toggledOff: true,
        standalonePage: 'not mounted',
      };
    },
  );

  await step(
    'T2 HMR: page updates without reload, fixture components still listed',
    60_000,
    async () => {
      if (!p.targets.hmr) return { notRun: 'matrix.json has no smoke.hmr' };
      // marker set here (independent of earlier steps): a full reload loses it
      await page.evaluate(() => (window.__smokeMarker = 1));
      const logFrom = app.viteLog.length;
      const navFrom = app.navigations();
      const restore = hmrEdit(p);
      // which update arrived: Vite client lines ('[vite] hot updated: …' /
      // '[vite] page reload …') and main-frame navigations since the edit
      const how = () => ({
        vite: app.viteLog.slice(logFrom, logFrom + 5),
        navigations: app.navigations() - navFrom,
      });
      let result;
      try {
        await page.waitForFunction(t => document.body.innerText.includes(t), p.targets.hmr.text, {
          timeout: 25_000,
        });
        if (!(await page.evaluate(() => window.__smokeMarker === 1)))
          throw new Error(`full reload instead of a hot update ${JSON.stringify(how())}`);
        const facts = await fixtureComponentsListed(p, getSrv(), 15_000);
        // the open UI keeps showing the fixture without a manual reload
        if (mode === 'dock') await uiShowsFixture(page.frameLocator(DOCK_FRAME), p);
        else if (ui) await uiShowsFixture(ui, p);
        result = {
          ...facts,
          ui: mode === 'dock' || ui ? 'still shows fixture components' : 'not open',
          update: how(),
        };
      } finally {
        restore();
      }
      // The revert is a second hot update. Wait until the page shows it: the
      // next step restarts the server, and a restart while the client still
      // fetches the reverted module makes Vite's HMR apply throw a page error.
      try {
        await page.waitForFunction(t => !document.body.innerText.includes(t), p.targets.hmr.text, {
          timeout: 15_000,
        });
      } catch (e) {
        const latest = { vite: app.viteLog.slice(-5), navigations: app.navigations() - navFrom };
        throw new Error(`HMR revert not applied: ${e.message} ${JSON.stringify(latest)}`, {
          cause: e,
        });
      }
      return result;
    },
  );

  await step(
    'T2 restart: same browser reconnects (app + UI), runtime resyncs',
    120_000,
    async () => {
      const tRestart = Date.now();
      await restart();
      const restartMs = Date.now() - tRestart;
      const restartedAt = Date.now();
      // Vite's client reloads the app page once the server is back (new page load = new epoch).
      await page.waitForFunction(hasRuntime, null, { timeout: 45_000 });
      const facts = await fixtureComponentsListed(p, getSrv(), 45_000);
      const epochAfter = (await tool(getSrv(), 'get_reactive_summary'))?.epoch ?? null;
      let uiState = 'not open';
      if (ui) {
        // The reconnect backoff goes up to 10 s: first wait until the status
        // shows 'connected' or the gate asks again, then judge gate vs fixture.
        try {
          const settled = await poll(
            () =>
              ui.evaluate(() => {
                const conn = document.querySelector('span.conn[role=status]');
                const gate = [...document.querySelectorAll('[role=dialog]')].some(
                  d =>
                    d.getAttribute('aria-label') === 'Authorize this browser' ||
                    (d.textContent ?? '').includes('Authorize this browser'),
                );
                return { connected: !!conn?.classList.contains('connected'), gate };
              }),
            x => x.connected === true || x.gate === true,
            30_000,
          );
          const uiConnectedMs = Date.now() - restartedAt;
          if (settled.gate)
            throw new Error(
              `UI asks for a new code after the restart (${uiConnectedMs} ms): same-browser trust not kept`,
            );
          else {
            await uiShowsFixture(ui, p);
            uiState = `reconnected after ${uiConnectedMs} ms, fixture components shown`;
          }
        } catch (e) {
          throw new Error(
            `${String(e?.message ?? e).slice(0, 600)} | restartMs ${restartMs}, since restart ${Date.now() - restartedAt} ms | ui: ${JSON.stringify(await uiDump(ui))}`,
            { cause: e },
          );
        }
      } else if (mode === 'dock') {
        // The hub keeps its trust across the reload, so asking for a new code
        // is a FAIL. It may show 'Unauthorized' briefly while it re-validates
        // the stored trust over WS: wait for that to go away, entering no code.
        const t0Auth = Date.now();
        while ((await page.getByRole('button', { name: 'Unauthorized' }).count()) > 0) {
          if (Date.now() - t0Auth > 10_000)
            throw new Error(
              'dock asks for authorization again after the restart (still after 10 s)',
            );
          await sleep(200);
        }
        const trustRestoredMs = Date.now() - t0Auth;
        const frame = await openDockEntry(page);
        const gate = await frame
          .getByRole('dialog', { name: 'Authorize this browser' })
          .waitFor({ timeout: 3_000 })
          .then(
            () => true,
            () => false,
          );
        if (gate) throw new Error('own auth gate shown in the dock iframe after the restart');
        await uiShowsFixture(frame, p);
        uiState = `dock iframe (same trust, no new code; 'Unauthorized' gone after ${trustRestoredMs} ms) shows fixture components`;
      }
      // the restart must reach a new page load (new epoch), not only MCP
      if (!epochBefore || !epochAfter || epochBefore === epochAfter)
        throw new Error(`no new epoch after the restart (${epochBefore} -> ${epochAfter})`);
      return { ...facts, epochChanged: true, ui: uiState };
    },
  );

  if (p.kit) {
    await step('T2 Kit SSR HTML', 20_000, async () => {
      const ssr = p.targets.ssr;
      if (!ssr) return { notRun: 'matrix.json has no smoke.ssr' };
      const r = await fetch(getSrv().base + ssr.path, { signal: AbortSignal.timeout(15_000) });
      const html = await r.text();
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      if (!/__sveltekit|data-sveltekit/.test(html))
        throw new Error('no SvelteKit markers in SSR HTML');
      if (ssr.contains && !html.includes(ssr.contains))
        throw new Error(`SSR HTML lacks ${JSON.stringify(ssr.contains)}`);
      return { httpStatus: r.status, bytes: html.length };
    });
    await step('T2 Kit load profile recorded', 45_000, async () => {
      const load = p.targets.load;
      if (!load) return { notRun: 'matrix.json has no smoke.load' };
      await page.goto(getSrv().base + load.path, { waitUntil: 'load', timeout: 30_000 });
      const w = await poll(
        () => tool(getSrv(), 'get_load_waterfall'),
        x =>
          Array.isArray(x) &&
          x.some(g => g.route === load.path || String(g.route).endsWith(load.path)),
        20_000,
      );
      return { routes: w.map(g => g.route).slice(0, 5) };
    });
  } else {
    set('T2 Kit SSR HTML', 'N/A', { reason: 'plain Svelte profile' });
    set('T2 Kit load profile recorded', 'N/A', { reason: 'plain Svelte profile' });
  }
  // status unchanged: any uncaught page error is a FAIL; the detail says
  // where (stack paths) and when (step, ms) it happened
  set(
    'T2 no page errors',
    errors.length === 0 ? 'PASS' : 'FAIL',
    errors.length > 0
      ? {
          errors: errors.slice(0, 3),
          errorCount: errors.length + (errors.overflow ?? 0),
          consoleErrors: consoleErrors.slice(0, 5),
          consoleErrorCount: app.consoleErrorCount(),
        }
      : {},
  );
  await browser.close();
}

let finishing = false;
async function finish(code) {
  if (finishing) return;
  finishing = true;
  await runCleanup();
  if (tier < 2)
    for (const s of PLAN)
      if (s.startsWith('T2') && ledger.get(s).status === 'NOT RUN')
        ledger.get(s).reason = '--tier=1';
  const steps = [...ledger.values()];
  const summary = {
    profile: profileId,
    mode,
    tier,
    node: process.version,
    ms: Date.now() - t0,
    steps,
  };
  const body = JSON.stringify(summary, null, 2) + '\n';
  // privacy: nothing secret in what we printed or are about to write
  const leaked = [...secrets].filter(s => out.some(l => l.includes(s)) || body.includes(s));
  ledger.set('privacy: no token / code in stdout or --json', {
    step: 'privacy: no token / code in stdout or --json',
    status: secrets.size === 0 ? 'UNVERIFIED' : leaked.length > 0 ? 'FAIL' : 'PASS',
    ...(secrets.size === 0 && { reason: 'no secret was read' }),
    ...(leaked.length > 0 && { leaked: leaked.length }),
  });
  summary.steps = [...ledger.values()];
  if (jsonOut && leaked.length === 0)
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(summary, null, 2) + '\n');
  const st = summary.steps.map(s => s.status);
  const exit =
    code > 0 ? code : st.includes('FAIL') ? 1 : st.some(s => s !== 'PASS' && s !== 'N/A') ? 3 : 0;
  for (const s of summary.steps)
    if (s.status === 'NOT RUN' || s.step.startsWith('privacy'))
      console.log(`${s.status} ${s.step}${s.reason ? ` (${s.reason})` : ''}`);
  console.log(
    `${exit === 0 ? 'OK' : exit === 3 ? 'INCOMPLETE' : 'FAILED'} ${profileId} ${mode} tier ${tier} in ${summary.ms} ms`,
  );
  process.exit(exit);
}

const watchdog = setTimeout(() => {
  say(`watchdog: --max-min=${maxMin} exceeded`);
  void finish(4);
}, maxMin * 60_000);
watchdog.unref();
for (const sig of ['SIGINT', 'SIGTERM'])
  process.once(sig, () => {
    void finish(130);
  });

try {
  await main();
} catch (e) {
  say(`FATAL ${mask(String(e?.message ?? e)).slice(0, 300)}`);
  await finish(1);
}
await finish(0);
