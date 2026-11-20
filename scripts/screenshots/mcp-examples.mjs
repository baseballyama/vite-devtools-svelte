#!/usr/bin/env node
// Real MCP request / response examples for the MCP guide on the site, recorded
// in CI (Linux, headless) against the synthetic example app
// `examples/kit-shop` (SvelteKit 3, `vite.standalone.config.ts`, the
// workspace plugin build, real runtime).
//
//   node scripts/screenshots/mcp-examples.mjs --out=<dir>
//
// Prerequisites (as in the CI `e2e` job): `pnpm install --frozen-lockfile`,
// `pnpm build`, `pnpm exec playwright-core install chromium`.
//
// The runtime lives in the app page, so the DevTools UI is never opened and no
// browser sign-in happens.
//
// Safety: isolated HOME, free port on 127.0.0.1. The MCP token is read from
// the dev server's registry file in that HOME and never printed or written. Outputs are
// redacted (the app root → "<project>", the repo root → "<repo>") and then
// scanned for machine paths, the token and HOME; a file with a hit is NOT
// written and the run fails. Hard cap 180 s; the dev server (process group),
// the browser and the HOME are always cleaned up.
//
// Output: <dir>/NN-*.json + <dir>/manifest.json (no machine paths).
// Exit 0 only when every step wrote a clean file.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  freePort,
  isolatedEnv,
  mcpPost,
  registeredToken,
  registryDir,
  stopProcessGroup,
  viteBin,
} from '../lib/dev-server.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const outArg = process.argv.find(a => a.startsWith('--out='));
if (!outArg) {
  console.error('usage: node scripts/screenshots/mcp-examples.mjs --out=<dir>');
  process.exit(64);
}
const outDir = path.resolve(outArg.slice('--out='.length));
const appDir = path.join(repoRoot, 'examples/kit-shop');
const CAP_MS = 180_000;
const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms);
  });
const ANSI = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'g');

const secrets = new Set();
const home = mkdtempSync(path.join(os.tmpdir(), 'sdt-mcp-home-'));
// The dev server announces its MCP endpoint and token here.
const registry = registryDir(home);
/** Replace the roots by placeholders, longest first, in any string. */
function redact(text) {
  return String(text).split(appDir).join('<project>').split(repoRoot).join('<repo>');
}
function mask(text) {
  let t = redact(text);
  for (const s of secrets) if (s) t = t.split(s).join('<secret>');
  return t.replaceAll(/x-svelte-devtools-token:\s*\S+/gi, 'x-svelte-devtools-token:<secret>');
}

/** @type {Array<() => unknown>} cleanup steps, run newest first by finish() */
const cleanup = [() => rmSync(home, { recursive: true, force: true })];
let finished = false;
async function finish(code) {
  if (finished) return;
  finished = true;
  for (const fn of cleanup.toReversed())
    await Promise.resolve()
      .then(fn)
      .catch(() => {});
  process.exit(code);
}
setTimeout(() => {
  console.log(`CAP: ${CAP_MS / 1000} s reached — stopping (counts as failure)`);
  void finish(2);
}, CAP_MS).unref();
process.on('SIGINT', () => void finish(130));
process.on('SIGTERM', () => void finish(143));
process.on('unhandledRejection', e => {
  console.log(`FAILED: ${mask(e?.message ?? e)}`);
  void finish(1);
});

const port = await freePort();
const child = spawn(
  process.execPath,
  [
    viteBin(appDir),
    'dev',
    '--config',
    'vite.standalone.config.ts',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  {
    cwd: appDir,
    env: isolatedEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  },
);
let log = '';
child.stdout.on('data', d => {
  log += d;
});
child.stderr.on('data', d => {
  log += d;
});
cleanup.push(() => stopProcessGroup(child));
const base = `http://127.0.0.1:${port}`;
let token = null;
for (let i = 0; ; i++) {
  if (child.exitCode !== null) throw new Error(`dev server exited: ${mask(log).slice(-600)}`);
  if (i > 300) throw new Error('dev server not ready in 60 s');
  token ??= registeredToken(registry, port);
  if (token) secrets.add(token);
  try {
    const r = await fetch(base + '/', { signal: AbortSignal.timeout(5000) });
    if (r.status < 500 && token) break;
  } catch {
    /* not yet */
  }
  await sleep(200);
}

async function rpc(method, params, { auth = true } = {}) {
  const { status, msg } = await mcpPost(base, method, params, { token: auth ? token : undefined });
  if (status !== 200) return { status };
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return { status: 200, result: msg.result };
}

const homes = [os.homedir(), home].filter(Boolean);
const SENSITIVE = [
  /\/Users\//,
  /\/home\//,
  /\/private\//,
  /[A-Z]:\\Users\\/,
  /devframe_otp/i,
  /x-svelte-devtools-token:[0-9a-f-]{8}/i,
];
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const manifest = {
  app: 'examples/kit-shop (SvelteKit 3, vite.standalone.config.ts) — synthetic demo app, real runtime',
  commit: git('rev-parse', 'HEAD'),
  serverTree: git('rev-parse', 'HEAD:packages/vite-devtools-svelte/src/mcp'),
  runner: `${process.platform} ${process.arch}, Node ${process.version}`,
  redaction: 'absolute app root → "<project>", repo root → "<repo>"; nothing else changed',
  calls: [],
};
let failed = 0;
let seq = 0;
function write(name, record) {
  const file = `${String(++seq).padStart(2, '0')}-${name}.json`;
  const json = redact(JSON.stringify(record, null, 2));
  const hits =
    SENSITIVE.filter(re => re.test(json)).length +
    homes.filter(h => json.includes(h)).length +
    [...secrets].filter(s => json.includes(s)).length;
  if (hits) {
    failed++;
    manifest.calls.push({
      file: null,
      name,
      result: `NOT SAVED: ${hits} sensitive pattern hit(s)`,
    });
    console.log(`${name}: NOT SAVED (sensitive text)`);
    return;
  }
  writeFileSync(path.join(outDir, file), json + '\n');
  manifest.calls.push({ file, name, result: 'saved' });
  console.log(`${name}: saved ${file}`);
}
async function call(tool, args = {}) {
  const { status, result } = await rpc('tools/call', { name: tool, arguments: args });
  if (status !== 200) throw new Error(`${tool}: HTTP ${status}`);
  const text = result.content?.find(c => c.type === 'text')?.text ?? 'null';
  let response;
  try {
    response = JSON.parse(text);
  } catch {
    response = text;
  }
  write(tool, { tool, arguments: args, isError: result.isError === true, response });
  return response;
}

const pwMod = await import(
  pathToFileURL(createRequire(path.join(repoRoot, 'package.json')).resolve('playwright-core')).href
);
const pw = pwMod.chromium ? pwMod : pwMod.default;
const browser = await pw.chromium.launch({ headless: true });
cleanup.push(() => browser.close());
const app = await (await browser.newContext()).newPage();
await app.goto(base + '/', { waitUntil: 'load', timeout: 30_000 });

try {
  mkdirSync(outDir, { recursive: true });

  const printed = log
    .replaceAll(ANSI, '')
    .split('\n')
    .find(l => l.includes('claude mcp add'));
  manifest.printedRegisterCommand = printed ? mask(printed.trim()) : null;

  // No or a wrong token: rejected before MCP.
  manifest.withoutToken = (await rpc('tools/list', {}, { auth: false })).status;

  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'docs-examples', version: '1' },
  });
  const list = await rpc('tools/list');
  manifest.tools = list.result.tools.map(t => t.name);

  for (let i = 0; i < 3; i++) {
    await app.getByRole('button', { name: /^(一時停止|再開)$/ }).click({ timeout: 15_000 });
    await sleep(1000);
  }
  // ReactivePriceChart renders only for a non-empty cart.
  await app.getByRole('link', { name: 'Products', exact: true }).click({ timeout: 15_000 });
  await app.waitForURL(/\/products$/, { timeout: 15_000 });
  await app
    .getByRole('button', { name: 'カートに追加', exact: true })
    .and(app.locator(':enabled'))
    .first()
    .click({ timeout: 15_000 });
  await app.getByRole('link', { name: /^Cart/ }).click({ timeout: 15_000 });
  await app.waitForURL(/\/cart$/, { timeout: 15_000 });
  await app.locator('table tbody tr').first().waitFor({ timeout: 15_000 });
  await sleep(1500);

  await call('get_reactive_summary', { topK: 5 });
  const live = await call('get_live_components', { includeMeta: true, limit: 50 });
  const chart = live?.components?.find(c => c.name === 'ReactivePriceChart');
  if (!chart) throw new Error('ReactivePriceChart not in get_live_components');
  const scopeArgs = { componentId: chart.id, epoch: live.epoch };
  await call('get_reactive_scope', scopeArgs);
  const first = await call('get_state_timeline', { limit: 5 });
  await app.getByLabel('税率').fill('0.08');
  await sleep(1200);
  await call('get_state_timeline', { since: first.cursor, limit: 5 });
  await call('get_capture_info');
  await call('list_performance_issues');
  const a = await call('start_session', { label: 'before' });
  await sleep(1500);
  await call('end_session', { keep: 'memory' });
  const b = await call('start_session', { label: 'after' });
  await app.getByLabel('税率').fill('0.1');
  await sleep(1500);
  await call('end_session', { keep: 'memory' });
  await call('compare_sessions', { a: a.id, b: b.id });
  // After a reload the old id must be refused, not matched to another instance.
  await app.reload({ waitUntil: 'load' });
  await sleep(1500);
  const stale = await call('get_reactive_scope', scopeArgs);
  if (stale?.staleReason !== 'epoch-changed')
    throw new Error(`expected staleReason epoch-changed, got ${stale?.staleReason}`);
  // A componentId without its epoch is an input error.
  await call('get_reactive_scope', { componentId: chart.id });
} catch (e) {
  failed++;
  manifest.error = mask(e?.message ?? e).slice(0, 400);
  console.log(`FAILED: ${manifest.error}`);
} finally {
  // The manifest gets the same scan as the example files.
  let json = redact(JSON.stringify(manifest, null, 2));
  const hits =
    SENSITIVE.filter(re => re.test(json)).length +
    homes.filter(h => json.includes(h)).length +
    [...secrets].filter(s => json.includes(s)).length;
  if (hits) {
    failed++;
    json = JSON.stringify(
      { result: `manifest NOT SAVED: ${hits} sensitive pattern hit(s)` },
      null,
      2,
    );
    console.log('manifest: NOT SAVED (sensitive text)');
  }
  writeFileSync(path.join(outDir, 'manifest.json'), json + '\n');
}
await finish(failed ? 1 : 0);
