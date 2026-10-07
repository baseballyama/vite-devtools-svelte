#!/usr/bin/env node
// Real MCP request / response examples for the MCP guide on the site, recorded
// in CI (Linux, headless) against the synthetic example app
// `examples/sample-app` (SvelteKit 2, `vite.standalone.config.ts`, the
// workspace plugin build, real runtime).
//
//   node scripts/screenshots/mcp-examples.mjs --out=<dir>
//
// Prerequisites (same as the compat job): `pnpm install --frozen-lockfile`,
// `pnpm build`, `pnpm exec playwright-core install --with-deps chromium`.
//
// What it does: starts the dev server, opens the app page in headless
// Chromium (the runtime lives in the page; the DevTools UI is not opened, so
// no browser sign-in happens), drives a few real interactions and calls the
// MCP endpoint the way an agent would. Every call is written as
// <dir>/NN-<tool>.json = { tool, arguments, response }.
//
// Safety: isolated HOME, free port on 127.0.0.1. The MCP token is read from
// the dev server's stdout in memory and never printed or written. Outputs are
// redacted (the app root → "<project>", the repo root → "<repo>") and then
// scanned for machine paths, the token and HOME; a file with a hit is NOT
// written and the run fails. Hard cap 180 s; the dev server (process group),
// the browser and the HOME are always cleaned up.
//
// Output: <dir>/NN-*.json + <dir>/manifest.json (no machine paths).
// Exit 0 only when every step wrote a clean file.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const outArg = process.argv.find(a => a.startsWith('--out='))
if (!outArg) {
  console.error('usage: node scripts/screenshots/mcp-examples.mjs --out=<dir>')
  process.exit(64)
}
const outDir = path.resolve(outArg.slice('--out='.length))
const appDir = path.join(repoRoot, 'examples/sample-app')
const CAP_MS = 180_000
const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms)
  })
const ANSI = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'g')

const secrets = new Set()
const home = mkdtempSync(path.join(os.tmpdir(), 'sdt-mcp-home-'))
/** Replace the roots by placeholders, longest first, in any string. */
function redact(text) {
  return String(text).split(appDir).join('<project>').split(repoRoot).join('<repo>')
}
function mask(text) {
  let t = redact(text)
  for (const s of secrets) if (s) t = t.split(s).join('<secret>')
  return t.replaceAll(/x-svelte-devtools-token:\s*\S+/gi, 'x-svelte-devtools-token:<secret>')
}

/** @type {Array<() => unknown>} cleanup steps, run newest first by finish() */
const cleanup = [() => rmSync(home, { recursive: true, force: true })]
let finished = false
async function finish(code) {
  if (finished) return
  finished = true
  for (const fn of cleanup.toReversed())
    await Promise.resolve()
      .then(fn)
      .catch(() => {})
  process.exit(code)
}
setTimeout(() => {
  console.log(`CAP: ${CAP_MS / 1000} s reached — stopping (counts as failure)`)
  void finish(2)
}, CAP_MS).unref()
process.on('SIGINT', () => void finish(130))
process.on('SIGTERM', () => void finish(143))
process.on('unhandledRejection', e => {
  console.log(`FAILED: ${mask(e?.message ?? e)}`)
  void finish(1)
})

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// ---------------------------------------------------------------- dev server
const port = await freePort()
const viteBin = path.join(
  path.dirname(createRequire(path.join(appDir, 'package.json')).resolve('vite/package.json')),
  'bin/vite.js',
)
const child = spawn(
  process.execPath,
  [
    viteBin,
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
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      BROWSER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  },
)
let log = ''
child.stdout.on('data', d => {
  log += d
})
child.stderr.on('data', d => {
  log += d
})
cleanup.push(async () => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const kill = sig => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig)
      else child.kill(sig)
    } catch {
      /* already gone */
    }
  }
  kill('SIGTERM')
  for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++)
    await sleep(100)
  if (child.exitCode === null && child.signalCode === null) kill('SIGKILL')
})
const base = `http://127.0.0.1:${port}`
let token = null
for (let i = 0; ; i++) {
  if (child.exitCode !== null) throw new Error(`dev server exited: ${mask(log).slice(-600)}`)
  if (i > 300) throw new Error('dev server not ready in 60 s')
  token ??= log.match(/x-svelte-devtools-token:([0-9a-f-]{36})/)?.[1] ?? null
  if (token) secrets.add(token)
  try {
    const r = await fetch(base + '/', { signal: AbortSignal.timeout(5000) })
    if (r.status < 500 && token) break
  } catch {
    /* not yet */
  }
  await sleep(200)
}

// --------------------------------------------------------------------- MCP
let rpcId = 0
async function rpc(method, params, { auth = true } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  }
  if (auth) headers['x-svelte-devtools-token'] = token
  const r = await fetch(`${base}/__svelte-devtools/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params ?? {} }),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await r.text()
  if (r.status !== 200) return { status: r.status }
  const raw = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find(l => l.startsWith('data:'))
        ?.slice(5)
  const msg = JSON.parse(raw)
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`)
  return { status: 200, result: msg.result }
}

const homes = [os.homedir(), home].filter(Boolean)
const SENSITIVE = [
  /\/Users\//,
  /\/home\//,
  /\/private\//,
  /[A-Z]:\\Users\\/,
  /devframe_otp/i,
  /x-svelte-devtools-token:[0-9a-f-]{8}/i,
]
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
const manifest = {
  app: 'examples/sample-app (SvelteKit 2, vite.standalone.config.ts) — synthetic demo app, real runtime',
  commit: git('rev-parse', 'HEAD'),
  serverTree: git('rev-parse', 'HEAD:packages/vite-devtools-svelte/src/mcp'),
  runner: `${process.platform} ${process.arch}, Node ${process.version}`,
  redaction: 'absolute app root → "<project>", repo root → "<repo>"; nothing else changed',
  calls: [],
}
let failed = 0
let seq = 0
function write(name, record) {
  const file = `${String(++seq).padStart(2, '0')}-${name}.json`
  const json = redact(JSON.stringify(record, null, 2))
  const hits =
    SENSITIVE.filter(re => re.test(json)).length +
    homes.filter(h => json.includes(h)).length +
    [...secrets].filter(s => json.includes(s)).length
  if (hits) {
    failed++
    manifest.calls.push({ file: null, name, result: `NOT SAVED: ${hits} sensitive pattern hit(s)` })
    console.log(`${name}: NOT SAVED (sensitive text)`)
    return
  }
  writeFileSync(path.join(outDir, file), json + '\n')
  manifest.calls.push({ file, name, result: 'saved' })
  console.log(`${name}: saved ${file}`)
}
/** Call a tool, record { tool, arguments, response } and return the parsed response. */
async function call(tool, args = {}) {
  const { status, result } = await rpc('tools/call', { name: tool, arguments: args })
  if (status !== 200) throw new Error(`${tool}: HTTP ${status}`)
  const text = result.content?.find(c => c.type === 'text')?.text ?? 'null'
  let response
  try {
    response = JSON.parse(text)
  } catch {
    response = text
  }
  write(tool, { tool, arguments: args, isError: result.isError === true, response })
  return response
}

// ------------------------------------------------------------------ browser
const pwMod = await import(
  pathToFileURL(createRequire(path.join(repoRoot, 'package.json')).resolve('playwright-core')).href
)
const pw = pwMod.chromium ? pwMod : pwMod.default
const browser = await pw.chromium.launch({ headless: true })
cleanup.push(() => browser.close())
const app = await (await browser.newContext()).newPage()
await app.goto(base + '/', { waitUntil: 'load', timeout: 30_000 })

try {
  mkdirSync(outDir, { recursive: true })

  // The registration line the dev server prints, with the secrets replaced.
  const printed = log
    .replace(ANSI, '')
    .split('\n')
    .find(l => l.includes('claude mcp add'))
  manifest.printedRegisterCommand = printed
    ? mask(printed.trim()).replace(`:${port}/`, ':<port>/')
    : null

  // No or a wrong token: rejected before MCP.
  manifest.withoutToken = (await rpc('tools/list', {}, { auth: false })).status

  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'docs-examples', version: '1' },
  })
  const list = await rpc('tools/list')
  manifest.tools = list.result.tools.map(t => t.name)

  // Real activity: toggle FpsCanvas `running` three times, then add an item
  // and open /cart by client-side navigation (ReactivePriceChart renders only
  // for a non-empty cart).
  for (let i = 0; i < 3; i++) {
    await app.getByRole('button', { name: /^(一時停止|再開)$/ }).click({ timeout: 15_000 })
    await sleep(1000)
  }
  await app.getByRole('link', { name: 'Products', exact: true }).click({ timeout: 15_000 })
  await app.waitForURL(/\/products$/, { timeout: 15_000 })
  await app
    .getByRole('button', { name: 'カートに追加', exact: true })
    .and(app.locator(':enabled'))
    .first()
    .click({ timeout: 15_000 })
  await app.getByRole('link', { name: /^Cart/ }).click({ timeout: 15_000 })
  await app.waitForURL(/\/cart$/, { timeout: 15_000 })
  await app.locator('table tbody tr').first().waitFor({ timeout: 15_000 })
  await sleep(1500)

  // 1 — where is the activity?
  await call('get_reactive_summary', { topK: 5, windowMs: 30_000 })
  // 2 — instance ids with the page load they belong to.
  const live = await call('get_live_components', { includeMeta: true, limit: 50 })
  const chart = live?.components?.find(c => c.name === 'ReactivePriceChart')
  if (!chart) throw new Error('ReactivePriceChart not in get_live_components')
  // 3 — one instance, its signals and what can affect what.
  const scopeArgs = { componentId: chart.id, epoch: live.epoch }
  await call('get_reactive_scope', scopeArgs)
  // 4 — what changed: read the cursor, change taxRate, read again.
  const first = await call('get_state_timeline', { limit: 5 })
  await app.getByLabel('税率').fill('0.08')
  await sleep(1200)
  await call('get_state_timeline', { since: first.cursor, limit: 5 })
  // 5 — how complete is all this?
  await call('get_capture_info')
  // 6 — ranked issues, and the measurement-session flow.
  await call('list_performance_issues')
  const a = await call('start_session', { label: 'before' })
  await sleep(1500)
  await call('end_session', { keep: 'memory' })
  const b = await call('start_session', { label: 'after' })
  await app.getByLabel('税率').fill('0.1')
  await sleep(1500)
  await call('end_session', { keep: 'memory' })
  await call('compare_sessions', { a: a.id, b: b.id })
  // 7 — after a reload the old id is refused instead of matched to another instance.
  await app.reload({ waitUntil: 'load' })
  await sleep(1500)
  const stale = await call('get_reactive_scope', scopeArgs)
  if (stale?.staleReason !== 'epoch-changed')
    throw new Error(`expected staleReason epoch-changed, got ${stale?.staleReason}`)
  // A componentId without its epoch is an input error.
  await call('get_reactive_scope', { componentId: chart.id })
} catch (e) {
  failed++
  manifest.error = mask(e?.message ?? e).slice(0, 400)
  console.log(`FAILED: ${manifest.error}`)
} finally {
  // The manifest gets the same scan as the example files.
  let json = redact(JSON.stringify(manifest, null, 2))
  const hits =
    SENSITIVE.filter(re => re.test(json)).length +
    homes.filter(h => json.includes(h)).length +
    [...secrets].filter(s => json.includes(s)).length
  if (hits) {
    failed++
    json = JSON.stringify(
      { result: `manifest NOT SAVED: ${hits} sensitive pattern hit(s)` },
      null,
      2,
    )
    console.log('manifest: NOT SAVED (sensitive text)')
  }
  writeFileSync(path.join(outDir, 'manifest.json'), json + '\n')
}
await finish(failed ? 1 : 0)
