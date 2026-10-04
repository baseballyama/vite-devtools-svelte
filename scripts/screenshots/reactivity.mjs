#!/usr/bin/env node
// Real-runtime screenshots of the Reactivity UI for the README / PR, taken in
// CI (Linux, headless) on the synthetic example app `examples/sample-app`
// (SvelteKit 2, `vite.standalone.config.ts`, the workspace plugin build).
//
//   node scripts/screenshots/reactivity.mjs --out=<dir>
//
// Prerequisites (same as the compat job): `pnpm install --frozen-lockfile`,
// `pnpm build`, `pnpm exec playwright-core install --with-deps chromium`.
//
// Cases (docs/ui-status.md "Capture plan"):
//   1 Overview → Components   21-reactivity-overview.png
//   2 Component local graph    22-reactivity-component.png
//   3 Overview → States        23-reactivity-states.png
//   4 Page reload (epoch)      24-reactivity-epoch.png
//
// Safety: isolated HOME, free port on 127.0.0.1, the one-time code is read
// from the dev server's stdout in memory and never printed or written; the
// auth gate itself is never captured. Before every screenshot the page text
// is scanned for machine paths, the code, tokens and URL secrets — on a hit
// NO image is written and the case fails. Hard cap 180 s; the dev server
// (process group), the browser and the HOME are always cleaned up.
//
// Output: <dir>/*.png + <dir>/manifest.json (no machine paths).
// Exit 0 only when all four cases produced a clean image.
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outArg = process.argv.find(a => a.startsWith('--out='))
if (!outArg) {
  console.error('usage: node scripts/screenshots/reactivity.mjs --out=<dir>')
  process.exit(64)
}
const outDir = path.resolve(outArg.slice('--out='.length))
const appDir = path.join(repoRoot, 'examples/sample-app')
const CAP_MS = 180_000
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

const secrets = new Set()
function mask(text) {
  let t = String(text)
  for (const s of secrets) if (s) t = t.split(s).join('<secret>')
  return t
    .replace(/x-svelte-devtools-token:\s*\S+/gi, 'x-svelte-devtools-token:<secret>')
    .replace(/devframe_otp=\d+/g, 'devframe_otp=<code>')
    .replace(/(auth code\s+)\d{6}/g, '$1<code>')
    .split(repoRoot)
    .join('<repo>')
}

const cleanup = []
let finished = false
async function finish(code) {
  if (finished) return
  finished = true
  for (const fn of cleanup.reverse())
    await Promise.resolve()
      .then(fn)
      .catch(() => {})
  process.exit(code)
}
const cap = setTimeout(() => {
  console.log(`CAP: ${CAP_MS / 1000} s reached — stopping (counts as failure)`)
  void finish(2)
}, CAP_MS)
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
const home = mkdtempSync(path.join(os.tmpdir(), 'sdt-shots-home-'))
cleanup.push(() => rmSync(home, { recursive: true, force: true }))
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
child.stdout.on('data', d => (log += d))
child.stderr.on('data', d => (log += d))
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
for (let i = 0; ; i++) {
  if (child.exitCode !== null) throw new Error(`dev server exited: ${mask(log).slice(-600)}`)
  if (i > 300) throw new Error('dev server not ready in 60 s')
  const token = log.match(/x-svelte-devtools-token:([0-9a-f-]{36})/)?.[1]
  if (token) secrets.add(token)
  try {
    const r = await fetch(base + '/', { signal: AbortSignal.timeout(5000) })
    if (r.status < 500) break
  } catch {
    /* not yet */
  }
  await sleep(200)
}

// ------------------------------------------------------------------ browser
// playwright-core is CJS: some Node versions expose only default.chromium.
const pwMod = await import(
  pathToFileURL(createRequire(path.join(repoRoot, 'package.json')).resolve('playwright-core')).href
)
const pw = pwMod.chromium ? pwMod : pwMod.default
const browser = await pw.chromium.launch({ headless: true })
cleanup.push(() => browser.close())
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
})
const errors = []
const app = await ctx.newPage()
app.on('pageerror', e => errors.push(`app: ${mask(e.message).slice(0, 200)}`))
await app.goto(base + '/', { waitUntil: 'load', timeout: 30_000 })

const ui = await ctx.newPage()
ui.on('pageerror', e => errors.push(`ui: ${mask(e.message).slice(0, 200)}`))
ui.on(
  'console',
  m => m.type() === 'error' && errors.push(`ui console: ${mask(m.text()).slice(0, 200)}`),
)
const from = log.length
await ui.goto(base + '/.svelte-devtools/', { waitUntil: 'load', timeout: 30_000 })
const dialog = ui.getByRole('dialog', { name: 'Authorize this browser' })
await dialog.waitFor({ timeout: 20_000 })
let code = null
for (let i = 0; i < 100 && !code; i++) {
  const t = log.slice(from).replace(ANSI, '')
  code =
    [...t.matchAll(/auth code\s+(\d{6})/g)].at(-1)?.[1] ??
    [...t.matchAll(/devframe_otp=(\d{6})/g)].at(-1)?.[1] ??
    null
  if (!code) await sleep(100)
}
if (!code) throw new Error('no one-time code printed')
secrets.add(code)
await dialog.getByLabel('One-time code').fill(code)
await dialog.locator('button[type=submit]').click()
await dialog.waitFor({ state: 'detached', timeout: 15_000 })
if (/devframe_otp|token=/.test(ui.url())) throw new Error('code or token left in the URL')

// ------------------------------------------------------------------ helpers
mkdirSync(outDir, { recursive: true })
const git = (...a) =>
  execFileSync('git', ['-C', repoRoot, ...a])
    .toString()
    .trim()
const homes = [os.homedir(), home]
  .filter(Boolean)
  .map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const SENSITIVE = [
  /\/Users\//,
  /\/home\//,
  /\/private\//,
  /[A-Z]:\\Users\\/,
  /devframe_otp/i,
  /\btoken\b/i,
  ...homes.map(h => new RegExp(h)),
]
const manifest = {
  app: 'examples/sample-app (SvelteKit 2, vite.standalone.config.ts) — synthetic demo app, real runtime',
  commit: git('rev-parse', 'HEAD'),
  // Tree hash of the client UI sources the images show.
  clientTree: git('rev-parse', 'HEAD:packages/vite-devtools-svelte/client/src'),
  runner: `${process.platform} ${process.arch}, Node ${process.version}`,
  viewport: '1440x900 @2x',
  theme: 'dark',
  shots: [],
}
let failed = 0

const host = '.host:not([hidden])'
async function shot(file, kase, caption) {
  await ui.waitForTimeout(700)
  const text = await ui.evaluate(() => document.body.innerText)
  const hits =
    SENSITIVE.filter(re => re.test(text)).length + [...secrets].filter(s => text.includes(s)).length
  if (hits) {
    failed++
    manifest.shots.push({
      case: kase,
      file: null,
      caption,
      result: `NOT SAVED: ${hits} sensitive pattern hit(s) in the page text`,
    })
    console.log(`case ${kase}: NOT SAVED (sensitive text)`)
    return
  }
  await ui.screenshot({ path: path.join(outDir, file) })
  manifest.shots.push({ case: kase, file, caption, result: 'saved' })
  console.log(`case ${kase}: saved ${file}`)
}
function notShown(kase, why) {
  failed++
  manifest.shots.push({ case: kase, file: null, result: `NOT SHOWN: ${why}` })
  console.log(`case ${kase}: NOT SHOWN — ${why}`)
}
const go = async id => {
  await ui.evaluate(id => (location.hash = `#/${id}`), id)
  await ui.waitForSelector(`${host} section.panel`, { timeout: 30_000 })
}
// Segmented controls are radiogroups; match the group and the radio's exact
// name inside the visible panel ('Graph' must never hit the 'Full graph' tab).
const radio = (group, name) =>
  ui
    .locator(host)
    .getByRole('radiogroup', { name: group, exact: true })
    .getByRole('radio', { name, exact: true })
async function choose(group, name) {
  const r = radio(group, name)
  await r.click({ timeout: 15_000 })
  await r.waitFor({ state: 'visible' })
  if ((await r.getAttribute('aria-checked')) !== 'true')
    throw new Error(`${group} → ${name} not selected`)
}
/** Short, masked text of what the visible panel shows (for a failed case). */
async function panelDump() {
  const t = await ui.evaluate(sel => {
    const h = document.querySelector(sel)
    const q = s => h?.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null
    const checked = [...(h?.querySelectorAll('[role=radiogroup]') ?? [])].map(
      g =>
        `${g.getAttribute('aria-label')}=${g.querySelector('[aria-checked=true]')?.textContent?.trim() ?? '?'}`,
    )
    return {
      radios: checked,
      empty: q('.empty .title'),
      scope: q('.scope-bar'),
      legend: q('.legend'),
      hidden: document.hidden,
    }
  }, host)
  return mask(JSON.stringify(t)).slice(0, 600)
}
const step = async (kase, fn) => {
  try {
    await fn()
  } catch (e) {
    notShown(kase, mask(e?.message ?? e).slice(0, 200))
  }
}

try {
  // 1 — Overview (Components) after one 10 s window with real activity:
  // FpsCanvas `running` ($state) toggled three times on the app page.
  await step(1, async () => {
    await go('reactive')
    await choose('Reactivity view', 'Overview')
    await choose('Overview of', 'Components')
    await ui.waitForSelector(`${host} .record`, { timeout: 30_000 })
    await sleep(10_000)
    for (let i = 0; i < 3; i++) {
      await app.getByRole('button', { name: /^(一時停止|再開)$/ }).click()
      await sleep(1000)
    }
    await sleep(3000)
    await shot(
      '21-reactivity-overview.png',
      1,
      'Reactivity → Overview (default, no graph fetched): what the counts cover (window, 200 ms sampling, coverage, active of registered, features not available yet) and the most active components with sampled changes and renders.',
    )
  })

  // 3 — Overview (States): the timeline buffer grouped by signal.
  await step(3, async () => {
    await choose('Overview of', 'States')
    await ui
      .locator(`${host} [role=option]`, { hasText: 'running' })
      .first()
      .waitFor({ timeout: 15_000 })
    await shot(
      '23-reactivity-states.png',
      3,
      'Reactivity → Overview → States: $state signals by sampled changes in the timeline buffer, with last value and time; the footer states the buffer age and that counts are not totals or rates.',
    )
  })

  // 2 — Components → FpsCanvas → Show reactivity → local graph, `running` selected.
  await step(2, async () => {
    await go('components')
    await ui
      .locator(`${host} [role=treeitem]`, { hasText: 'FpsCanvas' })
      .first()
      .click({ timeout: 20_000 })
    const show = ui.getByRole('button', { name: 'Show reactivity', exact: true })
    await show.waitFor({ timeout: 15_000 })
    await show.click()
    await ui.waitForSelector(`${host} .scope-bar`, { timeout: 15_000 })
    await choose('Layout', 'List')
    await ui
      .locator(`${host} [role=option]`, { hasText: 'running' })
      .first()
      .click({ timeout: 15_000 })
    await choose('Layout', 'Graph')
    // The shot must show the component view, not the Full graph tab.
    const tab = radio('Reactivity view', '<FpsCanvas>')
    if ((await tab.getAttribute('aria-checked')) !== 'true')
      throw new Error(`component tab not selected: ${await panelDump()}`)
    await shot(
      '22-reactivity-component.png',
      2,
      'Reactivity → one component (FpsCanvas) and the signals it is directly linked to. Edges mean "can affect" (current dependencies, not a recorded cause); the inspector shows the current value and "Cause: Not recorded".',
    )
  })

  // 4 — the app page reloads while that component is selected.
  await step(4, async () => {
    await app.reload({ waitUntil: 'load' })
    const notice = ui.getByText('The app page reloaded')
    for (let i = 0; i < 30; i++) {
      await ui
        .locator(host)
        .getByRole('button', { name: /^Refresh/ })
        .first()
        .click({ timeout: 2000 })
        .catch(() => {})
      if (await notice.isVisible().catch(() => false)) break
      await sleep(1000)
    }
    if (!(await notice.isVisible().catch(() => false)))
      throw new Error(`"The app page reloaded" not shown within 30 s: ${await panelDump()}`)
    await shot(
      '24-reactivity-epoch.png',
      4,
      'After the app page reloads, a selected component id may belong to another instance: Reactivity says so instead of showing data from the wrong instance.',
    )
  })
} finally {
  manifest.errors = errors
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  clearTimeout(cap)
  console.log(
    `${manifest.shots.filter(s => s.file).length}/4 saved; page errors: ${errors.length}; manifest written`,
  )
}
await finish(failed || manifest.shots.filter(s => s.file).length !== 4 ? 1 : 0)
