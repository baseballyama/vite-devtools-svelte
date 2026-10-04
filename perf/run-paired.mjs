#!/usr/bin/env node
// Paired baseline (B) vs final (F) browser measurement, bounded and ordered.
// Plan + rationale: docs/performance-status.md "Bounded paired measurement plan".
//
// Part A (decisive app comparison, ~17 min): order B F F B; per item one dev
// server (plugin on) and, in that session, every scale x scenario:
//   closed — no DevTools tab (F runtime must be inactive, §6.3)
//   open   — one DevTools tab holding the activity lease (F runtime active)
// Part B (~14 min): plugin-off reference (B, F) and the DevTools UI itself at
// the largest scale (B, F).
//
// Usage (only inside a granted slot):
//   node perf/run-paired.mjs --baseline=<pristine checkout> [--final=<worktree>]
//     [--label=paired] [--parts=A] [--order=BFFB]
//     [--scales=5000:none,6094:5x5] [--scenarios=closed,open]
//     [--gate=10:50] [--gate-wait=180] [--gate-policy=skip|record]
//     [--smoke=1]            # 500 rows, F only, both scenarios + UI, ~3 min
//     [--dry-run=1]          # metadata + plan only: no fixture, server or browser
//     [--linux-gate=2048:10] # Linux runner: MemAvailable MB min : PSI memory some avg10 max
//     [--cpu-profile=1]      # part A, open only: CDP CPU profile of the app page and the
//                            # DevTools tab + `node --cpu-prof` of the dev server.
//                            # Profiled items are for attribution, never compared.
//
// Parts: A (plugin on: closed/open), OFF (plugin-off reference), UI (DevTools
// UI at the largest scale incl. select/search/expand latency); B = OFF + UI.
//
// Output (gitignored): <final>/playground/.temp/perf-results/<label>/
//   items/<n>-<B|F>.json, summary.json, summary.md, screenshots.
// Dependencies: workspace-root `playwright-core` + `axe-core` only.

import fs from 'node:fs'
import path from 'node:path'
import { ensurePlaygroundSync, generate, DEFAULTS as FIXTURE } from './generate-large-app.mjs'
import {
  INIT_SCRIPT,
  checkoutMeta,
  connectInspector,
  envSnapshot,
  frameStats,
  heapAfterGc,
  idleWindow,
  importRootDep,
  inputToPaint,
  median,
  openDevtoolsTab,
  r1,
  repoRoot,
  rootDepFile,
  runtimeState,
  sha256File,
  sha256Tree,
  sleep,
  startServer,
  stopServer,
  waitForGate,
  wsAccounting,
  wsDelta,
} from './lib/harness.mjs'
import { summarizeProfile } from './lib/profile.mjs'
import { summarize } from './lib/summary.mjs'

function parseArgs(argv) {
  const opts = {
    baseline: '',
    final: repoRoot,
    label: 'paired',
    parts: 'A',
    order: 'BFFB',
    scales: '5000:none,6094:5x5',
    scenarios: 'closed,open',
    port: 5390,
    devtoolsPath: '/.svelte-devtools/',
    mountReps: 5,
    idleMs: 3000,
    idleReps: 2,
    churnMs: 3000,
    cycles: 8,
    gate: '10:50',
    linuxGate: '2048:10',
    cpuProfile: 0,
    gateWait: 180,
    gatePolicy: 'skip',
    smoke: 0,
    dryRun: 0,
    inputReps: 10,
    maxMin: 25,
    headed: 0,
  }
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (!m) throw new Error(`Unexpected argument ${arg}`)
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (!(key in opts)) throw new Error(`Unknown option --${m[1]}`)
    opts[key] = typeof opts[key] === 'number' ? Number(m[2]) : m[2]
  }
  if (!opts.baseline && !opts.smoke && opts.order.includes('B'))
    throw new Error('--baseline=<pristine checkout> is required (or --order=F)')
  opts.final = path.resolve(opts.final)
  if (opts.baseline) opts.baseline = path.resolve(opts.baseline)
  const [load1Max, idleMin] = opts.gate.split(':').map(Number)
  const [memMinMB, psiMemMax] = opts.linuxGate.split(':').map(Number)
  opts.gateSpec = { load1Max, idleMin, memMinMB, psiMemMax }
  opts.scaleList = opts.scales.split(',').map(s => {
    const [rows, tree] = s.split(':')
    const t = tree === 'none' ? null : tree.split('x').map(Number)
    return { rows: Number(rows), tree: t, label: `${rows}${t ? `+tree${tree}` : ''}` }
  })
  if (opts.smoke) {
    opts.order = 'F'
    opts.scaleList = [{ rows: 500, tree: [2, 3], label: '500+tree2x3' }]
    opts.mountReps = 1
    opts.idleReps = 1
    opts.cycles = 2
    opts.parts = 'A,UI'
  }
  return opts
}

const treeNodes = t => (t ? (t[1] ** (t[0] + 1) - 1) / (t[1] - 1) : 0)
const log = (...a) => console.log(`[paired ${new Date().toISOString().slice(11, 19)}]`, ...a)

// ---------------------------------------------------------------- fixture

function prepareFixture(repo) {
  ensurePlaygroundSync(repo)
  const appDir = path.join(repo, 'playground/.temp/large-app')
  // Always regenerate (deterministic, wipes the dir incl. .svelte-kit and
  // Vite caches): an older fixture left in either checkout must not differ.
  generate({ ...FIXTURE, out: appDir })
  return {
    appDir,
    src: sha256Tree(path.join(appDir, 'src')),
    config: sha256File(path.join(appDir, 'vite.config.js')),
  }
}

// ---------------------------------------------------------------- DevTools tab

/** Wait until the app runtime reports the expected subscription state. */
async function waitForActive(appPage, expected, timeoutMs = 25_000) {
  const t0 = Date.now()
  for (;;) {
    const st = await runtimeState(appPage)
    if (!st || typeof st.active !== 'boolean') return { active: st?.active ?? null, waitedMs: 0 }
    if (st.active === expected) return { active: st.active, waitedMs: Date.now() - t0 }
    if (Date.now() - t0 > timeoutMs)
      return { active: st.active, waitedMs: Date.now() - t0, timeout: true }
    await sleep(250)
  }
}

// ---------------------------------------------------------------- app scenario

async function appScenario(appCtx, srv) {
  const page = await appCtx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  const cdp = await appCtx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const ws = await wsAccounting(cdp)
  await page.goto(`${srv.base}/bench`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__bench?.ready === true, null, { timeout: 120_000 })
  return { page, cdp, ws, errors }
}

async function measureApp(app, scale, opts) {
  const { page, cdp, ws } = app
  const wsStart = ws.snapshot()
  // warm-up so JIT and module graph are settled
  await page.evaluate(() => window.__bench.mountRows(200))
  await page.evaluate(() => window.__bench.clearRows())
  await sleep(300)
  const heap0 = await heapAfterGc(cdp)

  const res = { scale: scale.label, instances: scale.rows + treeNodes(scale.tree) + 2 }
  const mounts = []
  const unmounts = []
  const wsMount = ws.snapshot()
  for (let i = 0; i < opts.mountReps; i++) {
    mounts.push(await page.evaluate(n => window.__bench.mountRows(n), scale.rows))
    await sleep(200)
    unmounts.push(await page.evaluate(() => window.__bench.clearRows()))
    await sleep(200)
  }
  // Rep 1 is a warm-up (first mount of this size on a fresh page: cold JIT /
  // caches) and is reported separately; the steady value is the median of
  // reps >= 2 (review M3).
  const steady = xs => (xs.length > 1 ? xs.slice(1) : xs)
  res.rows = {
    mountMs: r1(median(steady(mounts))),
    unmountMs: r1(median(steady(unmounts))),
    warmupMountMs: r1(mounts[0]),
    warmupUnmountMs: r1(unmounts[0]),
    runs: [mounts.map(r1), unmounts.map(r1)],
  }
  res.rows.ws = wsDelta(wsMount, ws.snapshot())
  if (scale.tree) {
    const [d, b] = scale.tree
    const tm = await page.evaluate(([dd, bb]) => window.__bench.mountTree(dd, bb), [d, b])
    await sleep(200)
    const tu = await page.evaluate(() => window.__bench.clearTree())
    res.tree = { nodes: treeNodes(scale.tree), mountMs: r1(tm), unmountMs: r1(tu) }
  }

  // steady state, everything mounted
  await page.evaluate(n => window.__bench.mountRows(n), scale.rows)
  if (scale.tree) await page.evaluate(([dd, bb]) => window.__bench.mountTree(dd, bb), scale.tree)
  await sleep(1500) // let throttled pushes settle
  res.idle = []
  for (let i = 0; i < opts.idleReps; i++)
    res.idle.push(await idleWindow(page, cdp, opts.idleMs, ws))
  const churn = await page.evaluate(ms => window.__bench.churn(50, ms), opts.churnMs)
  res.churn = frameStats(churn)
  res.heapMountedMB = r1((await heapAfterGc(cdp)) / 1048576)
  res.dom = await page.evaluate(() => document.getElementsByTagName('*').length)
  res.runtime = await runtimeState(page)
  res.input = await inputToPaint(page, '[data-bench="input"]', opts.inputReps)
  // Ground truth of the workload, next to what the runtime reports it saw
  // (`res.runtime.instances`; null without the plugin).
  res.groundTruth = {
    instancesMounted: res.instances,
    rows: scale.rows,
    treeNodes: treeNodes(scale.tree),
    statePerRow: { state: 2, derived: 1, effect: 1 },
    churn: { statesPerFrame: 50, ms: opts.churnMs, framesObserved: res.churn.frames + 1 },
    input: { clicks: opts.inputReps, statesPerClick: scale.rows + 1 },
  }

  // heap growth over mount/unmount cycles
  if (scale.tree) await page.evaluate(() => window.__bench.clearTree())
  for (let i = 0; i < opts.cycles; i++) {
    await page.evaluate(() => window.__bench.mountRows(2000))
    await page.evaluate(() => window.__bench.clearRows())
  }
  await sleep(1500)
  const heap1 = await heapAfterGc(cdp)
  res.leak = { cycles: opts.cycles, growthMB: r1((heap1 - heap0) / 1048576) }
  res.runtimeAfterUnmount = await runtimeState(page)
  res.wsTotal = wsDelta(wsStart, ws.snapshot())
  res.wsSentByEvent = ws.sentByEvent()
  res.errors = app.errors
  return res
}

// ---------------------------------------------------------------- UI scenario (part B)

/**
 * DevTools interaction latency on the Components live tree, measured inside
 * the DevTools page from the action to the second animation frame after the
 * expected DOM state (so it includes the RPC round trip when one is needed):
 * select a row -> inspector shown; search -> hit count / rows settled;
 * expand a collapsed row -> aria-expanded=true.
 */
async function uiInteractions(page, query) {
  return page.evaluate(async q => {
    const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const until = async (pred, ms = 20_000) => {
      const end = performance.now() + ms
      while (!pred()) {
        if (performance.now() > end) return false
        await new Promise(r => requestAnimationFrame(r))
      }
      return true
    }
    // Visited panels stay mounted (hidden): scope every query to the visible
    // Components panel, or a hidden panel's search field / tree is used.
    const panel = [...document.querySelectorAll('section.panel')].find(
      el => el.offsetParent !== null && el.querySelector('[role="tree"]'),
    )
    if (!panel) return { error: 'no visible panel with a tree' }
    const rows = () => [...panel.querySelectorAll('[role="tree"] [role="treeitem"]')]
    const hits = () => panel.querySelector('.search .hits')?.textContent?.trim() ?? null
    const out = { treeRows: rows().length }
    // select
    const target = rows()[Math.min(3, rows().length - 1)]
    if (target) {
      const t0 = performance.now()
      target.click()
      const ok = await until(() => !!panel.querySelector('aside.inspector'))
      await twoFrames()
      out.selectMs = ok ? Math.round((performance.now() - t0) * 10) / 10 : null
    }
    // expand: first collapsed row with a twisty. The default expansion can
    // leave no collapsed row in the viewport; then "Collapse all" first (not
    // timed) and expand the first root row.
    let collapsed = rows().find(r => r.getAttribute('aria-expanded') === 'false')
    if (!collapsed) {
      const btn = [...panel.querySelectorAll('button')].find(
        b => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === 'Collapse all',
      )
      if (btn) {
        btn.click()
        await until(() => rows().some(r => r.getAttribute('aria-expanded') === 'false'), 5000)
        await twoFrames()
        collapsed = rows().find(r => r.getAttribute('aria-expanded') === 'false')
        out.expandAfterCollapseAll = true
      }
    }
    if (collapsed) {
      const id = collapsed.id
      const t0 = performance.now()
      collapsed.querySelector('.twisty')?.click()
      const ok = await until(
        () => document.getElementById(id)?.getAttribute('aria-expanded') === 'true',
      )
      await twoFrames()
      out.expandMs = ok ? Math.round((performance.now() - t0) * 10) / 10 : null
    } else out.expandMs = 'no collapsed row'
    // search: done when the hit count is shown and the filtered rows render
    // their highlighted match (or the count is 0)
    const input = panel.querySelector('input[data-panel-search]')
    if (input) {
      const t0 = performance.now()
      input.value = q
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const ok = await until(
        () => hits() !== null && (hits() === '0' || !!panel.querySelector('[role="tree"] mark')),
      )
      await twoFrames()
      out.searchMs = ok ? Math.round((performance.now() - t0) * 10) / 10 : null
      out.searchRows = rows().length
      out.searchHits = hits()
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return out
  }, query)
}

async function measureUi(side, srv, scale, opts, outDir, tag, server = null) {
  const app = await appScenario(side.appCtx, srv)
  await app.page.evaluate(n => window.__bench.mountRows(n), scale.rows)
  if (scale.tree) await app.page.evaluate(([d, b]) => window.__bench.mountTree(d, b), scale.tree)
  const tab = await openDevtoolsTab(side, srv, opts)
  await sleep(3000)
  const res = { scale: scale.label, panels: {} }
  // Profiled mode: one window over the operated UI (panel switches + Components
  // select/search/expand) for the DevTools tab and the dev server; heap/axe and
  // the idle window are outside it.
  const targets = opts.cpuProfile ? { ui: tab.cdp, ...(server ? { server } : {}) } : null
  if (targets) await startProfilers(targets)
  const nav = name =>
    tab.page
      .getByRole('link', { name })
      .or(tab.page.getByRole('tab', { name }))
      .or(tab.page.getByRole('button', { name }))
  // Accessible names differ between the baseline UI and the new one
  // ("Reactive" vs "Reactivity", "Timeline" vs "State timeline").
  const PANELS = {
    Overview: /^\s*Overview\b/i,
    Components: /^\s*Components\b/i,
    Routes: /^\s*Routes\b/i,
    Render: /^\s*Render\b/i,
    Reactive: /^\s*Reactiv(e|ity)\b/i,
    Timeline: /^\s*(State\s+)?timeline\b/i,
  }
  for (const [label, re] of Object.entries(PANELS)) {
    const ctl = nav(re).first()
    if ((await ctl.count()) === 0) {
      res.panels[label] = { found: false }
      continue
    }
    const wsB = tab.ws.snapshot()
    const t0 = performance.now()
    await ctl.click()
    await tab.page
      .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {
        timeout: 60_000,
      })
      .catch(() => {})
    await tab.page.evaluate(
      () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    res.panels[label] = {
      found: true,
      switchMs: r1(performance.now() - t0),
      dom: await tab.page.evaluate(() => document.getElementsByTagName('*').length),
      ws: wsDelta(wsB, tab.ws.snapshot()),
    }
    await tab.page.screenshot({ path: path.join(outDir, `${tag}-ui-${label.toLowerCase()}.png`) })
  }
  // Components: is the route root present with > 5 000 instances (H2)?
  const comp = nav(/^\s*Components\b/i).first()
  if ((await comp.count()) > 0) {
    await comp.click()
    await sleep(3000)
    res.componentsRootPresent = (await tab.page.getByText(/\+(page|layout)\b/).count()) > 0
    res.interactions = await uiInteractions(tab.page, 'Row')
  }
  if (targets) {
    res.profiled = true
    res.cpuProfiles = {
      'ui-ops': await stopProfilers(targets, path.join(outDir, 'profiles'), `${tag}-ui-ops`),
    }
  }
  if ((await comp.count()) > 0) {
    res.componentsIdle = await idleWindow(tab.page, tab.cdp, opts.idleMs, tab.ws)
  }
  res.heapMB = r1((await heapAfterGc(tab.cdp)) / 1048576)
  const axePath = rootDepFile('axe-core', 'axe.min.js')
  if (axePath) {
    await tab.page.addScriptTag({ path: axePath })
    res.axe = await tab.page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] })
      return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
    })
  }
  await tab.page.close()
  await app.page.close()
  return res
}

// ---------------------------------------------------------------- CPU profiles

async function startProfilers(targets) {
  for (const t of Object.values(targets)) {
    await t.send('Profiler.enable')
    await t.send('Profiler.setSamplingInterval', { interval: 500 })
    await t.send('Profiler.start')
  }
}

/** Stop, write `<tag>-<name>.cpuprofile`, return the self-time summary per target. */
async function stopProfilers(targets, dir, tag) {
  fs.mkdirSync(dir, { recursive: true })
  const out = {}
  for (const [name, t] of Object.entries(targets)) {
    const { profile } = await t.send('Profiler.stop')
    fs.writeFileSync(path.join(dir, `${tag}-${name}.cpuprofile`), JSON.stringify(profile))
    out[name] = summarizeProfile(profile)
  }
  return out
}

/**
 * Profiled mode (review M2): one profile per window and target, with the
 * workload of that window only — steady idle, input clicks, churn. No forced
 * GC, no mount/unmount cycles inside a window. Same windows for CLOSED (the
 * reference) and OPEN. Timings here carry profiler overhead: never compared.
 */
async function profileApp(app, scale, opts, targets, dir, tag) {
  const { page } = app
  await page.evaluate(n => window.__bench.mountRows(n), scale.rows)
  if (scale.tree) await page.evaluate(([d, b]) => window.__bench.mountTree(d, b), scale.tree)
  await sleep(1500)
  const windows = {
    idle: () => sleep(opts.idleMs),
    input: () => inputToPaint(page, '[data-bench="input"]', opts.inputReps),
    churn: () => page.evaluate(ms => window.__bench.churn(50, ms), opts.churnMs),
  }
  const out = {}
  for (const [name, run] of Object.entries(windows)) {
    await startProfilers(targets)
    const t0 = performance.now()
    await run()
    const ms = r1(performance.now() - t0)
    out[name] = { ms, ...(await stopProfilers(targets, dir, `${tag}-${name}`)) }
  }
  return out
}

// ---------------------------------------------------------------- validity

/**
 * Per-run validity with reasons. Invalid runs stay in the item JSON but are
 * excluded from the summary. `n/a (always on)` is the baseline runtime that has
 * no subscription (§6.3): its CLOSED is still active — recorded as a note.
 */
function validateRun(r, scenario) {
  const reasons = []
  const notes = []
  if (r.errors?.length) reasons.push(`page errors (${r.errors.length})`)
  const rt = r.runtime
  if (scenario === 'plugin-off') {
    if (rt) reasons.push('runtime present with the plugin off')
  } else if (!rt) reasons.push('runtime missing with the plugin on')
  else {
    const want = scenario === 'open'
    if (rt.active === 'n/a (always on)') {
      if (!want) notes.push('baseline runtime has no subscription: CLOSED is still active')
    } else {
      if (rt.active !== want) reasons.push(`runtime active ${rt.active}, expected ${want}`)
      if (rt.sampling !== 'n/a' && rt.sampling !== want)
        reasons.push(`sampling ${rt.sampling}, expected ${want}`)
    }
    if (r.lease?.timeout) reasons.push('lease state not reached in time')
    // runtime counts the app root as one extra instance
    if (want && rt.instances !== r.groundTruth.instancesMounted + 1)
      reasons.push(
        `runtime instances ${rt.instances} != ground truth ${r.groundTruth.instancesMounted} + 1`,
      )
  }
  for (const [k, v] of [
    ['input clicks', r.input?.clickToFrameMs?.n],
    ['mount', r.rows?.mountMs],
  ])
    if (v === null || v === undefined || Number.isNaN(v)) reasons.push(`${k} missing`)
  if (r.input && r.input.clickToFrameMs.n !== r.groundTruth.input.clicks)
    reasons.push(`input frames ${r.input.clickToFrameMs.n} of ${r.groundTruth.input.clicks} clicks`)
  return { valid: reasons.length === 0, reasons, notes }
}

function validateUi(ui) {
  const reasons = []
  const notes = []
  const i = ui.interactions
  if (!i) reasons.push('interactions not run')
  else if (i.error) reasons.push(`interactions: ${i.error}`)
  else {
    if (typeof i.selectMs !== 'number') reasons.push('select not completed')
    if (typeof i.searchMs !== 'number') reasons.push('search not completed')
    // the query "Row" matches every mounted bench row
    if (i.searchHits === '0' || i.searchHits === null)
      reasons.push(`search hits ${i.searchHits} for a known match`)
    if (i.expandMs === 'no collapsed row') notes.push('expand not measured (no collapsed row)')
    else if (typeof i.expandMs !== 'number') reasons.push('expand not completed')
  }
  if (!ui.componentsRootPresent) reasons.push('route root not in the Components tree')
  return { valid: reasons.length === 0, reasons, notes }
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  // Hard wall-clock cap for the whole invocation: on expiry only this
  // process's own dev server and browser are closed (see `cleanup`).
  const cleanup = []
  const watchdog = setTimeout(async () => {
    console.error(`[paired] --max-min=${opts.maxMin} exceeded — closing own children and exiting`)
    for (const fn of cleanup.reverse()) await fn().catch(() => {})
    process.exit(4)
  }, opts.maxMin * 60_000)
  watchdog.unref()
  const outDir = path.join(opts.final, 'playground/.temp/perf-results', opts.label)
  const homeRoot = path.join(opts.final, 'playground/.temp/perf-home', opts.label)
  const checkouts = { F: opts.final, ...(opts.baseline ? { B: opts.baseline } : {}) }
  const meta = Object.fromEntries(
    Object.entries(checkouts).map(([k, r]) => [k, checkoutMeta(r, k)]),
  )
  const plan = {
    order: [...opts.order],
    parts: opts.parts.split(','),
    scales: opts.scaleList,
    scenarios: opts.scenarios.split(','),
    samples: {
      mountReps: opts.mountReps,
      idle: `${opts.idleReps} x ${opts.idleMs} ms`,
      churnMs: opts.churnMs,
      cycles: opts.cycles,
    },
    gate: { ...opts.gateSpec, waitS: opts.gateWait, policy: opts.gatePolicy },
  }
  if (opts.dryRun) {
    console.log(JSON.stringify({ plan, meta, env: envSnapshot(), outDir, homeRoot }, null, 2))
    return
  }

  // Linux gate: no OOM kill may happen after this point.
  opts.gateSpec.oomBase = envSnapshot().oom ?? null
  fs.mkdirSync(path.join(outDir, 'items'), { recursive: true })
  const fixtures = Object.fromEntries(
    Object.entries(checkouts).map(([k, r]) => [k, prepareFixture(r)]),
  )
  if (fixtures.B && fixtures.B.config !== fixtures.F.config) {
    throw new Error(
      `fixture vite.config differs between B and F: ${fixtures.B.config} vs ${fixtures.F.config}`,
    )
  }
  if (fixtures.B && fixtures.B.src.sha256 !== fixtures.F.src.sha256) {
    throw new Error(
      `fixture sources differ between B and F: ${fixtures.B.src.sha256} vs ${fixtures.F.src.sha256}`,
    )
  }

  const { name: pwName, mod: pw } = await importRootDep('playwright-core', 'playwright')
  const browser = await pw.chromium.launch({ headless: !opts.headed })
  cleanup.push(() => browser.close())
  const ownServer = async args => {
    const srv = await startServer(args)
    cleanup.push(() => stopServer(srv))
    return srv
  }
  const sides = {}
  for (const k of Object.keys(checkouts)) {
    sides[k] = {
      // one persistent context per checkout for the DevTools tab (auth once),
      // a separate one for the app pages
      uiCtx: await browser.newContext({ viewport: { width: 1440, height: 900 } }),
      appCtx: await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      authCount: 0,
      notes: [],
    }
    await sides[k].uiCtx.addInitScript(INIT_SCRIPT)
    await sides[k].appCtx.addInitScript(INIT_SCRIPT)
  }
  const header = {
    label: opts.label,
    startedAt: new Date().toISOString(),
    browser: `${pwName} chromium ${browser.version()}`,
    node: process.version,
    plan,
    meta,
    fixture: fixtures.F.src,
    // 'latency': plain measurement. 'profiled': CDP Profiler on the app page
    // and the DevTools tab + node --cpu-prof on the dev server were running,
    // so its timings carry profiler overhead and are never compared with
    // 'latency' runs.
    mode: opts.cpuProfile ? 'profiled' : 'latency',
  }
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(header, null, 2) + '\n')
  log(
    `browser ${header.browser}; fixture src ${fixtures.F.src.sha256}; order ${opts.order}; out ${outDir}`,
  )

  const items = []
  const runItem = async (side, n, fn) => {
    const gate = await waitForGate(opts.gateSpec, opts.gateWait, log)
    const item = { n, side, gate, notes: [] }
    if (!gate.ok && opts.gatePolicy === 'skip') {
      item.skipped = `gate failed: ${gate.reasons.join('; ')}`
      log(`item ${n} ${side} skipped — ${item.skipped}`)
    } else {
      try {
        await fn(item)
      } catch (e) {
        // keep what was measured (review M4); the run stops after writing it
        item.error = String(e?.stack ?? e).slice(0, 2000)
      }
      item.envAfter = envSnapshot()
    }
    item.notes.push(...sides[side].notes.splice(0))
    for (const r of item.app ?? []) Object.assign(r, { validity: validateRun(r, r.scenario) })
    if (item.ui) item.ui.validity = validateUi(item.ui)
    const runs = [...(item.app ?? []).map(r => r.validity), item.ui?.validity].filter(Boolean)
    item.valid = !item.skipped && !item.error && runs.length > 0 && runs.every(v => v.valid)
    item.invalidReasons = [
      ...(item.skipped ? [item.skipped] : []),
      ...(item.error ? ['item error'] : []),
      ...(item.app ?? []).flatMap(r =>
        r.validity.reasons.map(x => `${r.scale} ${r.scenario}: ${x}`),
      ),
      ...(item.ui?.validity.reasons.map(x => `ui: ${x}`) ?? []),
    ]
    items.push(item)
    fs.writeFileSync(
      path.join(
        outDir,
        'items',
        `${String(n).padStart(2, '0')}-${side}${item.part ? '-' + item.part : ''}.json`,
      ),
      JSON.stringify(item, null, 2) + '\n',
    )
    if (item.error)
      throw new Error(`item ${n} ${side} failed (recorded): ${item.error.split('\n')[0]}`)
  }

  try {
    let n = 0
    if (plan.parts.includes('A')) {
      for (const side of plan.order) {
        await runItem(side, ++n, async item => {
          item.part = 'A'
          const fx = fixtures[side]
          const srv = await ownServer({
            appDir: fx.appDir,
            port: opts.port,
            withDevtools: true,
            home: path.join(homeRoot, side),
            inspect: !!opts.cpuProfile,
          })
          item.server = { pid: srv.pid, coldMs: r1(srv.coldMs) }
          item.mode = opts.cpuProfile ? 'profiled' : 'latency'
          log(
            `item ${n} ${side}: server pid ${srv.pid} ready in ${Math.round(srv.coldMs)} ms (cold, not compared)`,
          )
          const server = opts.cpuProfile ? await connectInspector(srv) : null
          const profDir = path.join(outDir, 'profiles')
          try {
            // One discarded page load per server (review M3): client module
            // transforms and the browser HTTP cache are warm before any state.
            // In profiled mode this is the server's "cold load" window.
            if (server) await startProfilers({ server })
            const t0 = performance.now()
            const warm = await appScenario(sides[side].appCtx, srv)
            await warm.page.evaluate(() => window.__bench.mountRows(200))
            await warm.page.evaluate(() => window.__bench.clearRows())
            await warm.page.close()
            item.warmupLoadMs = r1(performance.now() - t0)
            if (server)
              item.serverColdLoad = await stopProfilers(
                { server },
                profDir,
                `${n}-${side}-coldload`,
              )
            // State order alternates per item (n odd: as given, n even:
            // reversed), so with BFFB each side runs each order once.
            const scenarios = n % 2 ? plan.scenarios : [...plan.scenarios].reverse()
            item.scenarioOrder = scenarios
            item.app = []
            for (const scale of opts.scaleList) {
              for (const scenario of scenarios) {
                const tab =
                  scenario === 'open' ? await openDevtoolsTab(sides[side], srv, opts) : null
                const app = await appScenario(sides[side].appCtx, srv)
                const lease = await waitForActive(app.page, scenario === 'open')
                let r
                if (opts.cpuProfile) {
                  const targets = { app: app.cdp, ...(tab ? { ui: tab.cdp } : {}), server }
                  r = {
                    scale: scale.label,
                    profiled: true,
                    windows: await profileApp(
                      app,
                      scale,
                      opts,
                      targets,
                      profDir,
                      `${n}-${side}-${scale.label}-${scenario}`,
                    ),
                    instances: scale.rows + treeNodes(scale.tree) + 2,
                    runtime: await runtimeState(app.page),
                    errors: app.errors,
                  }
                  r.groundTruth = {
                    instancesMounted: r.instances,
                    input: { clicks: opts.inputReps, statesPerClick: scale.rows + 1 },
                  }
                } else r = await measureApp(app, scale, opts)
                r.scenario = scenario
                r.lease = lease
                if (tab) {
                  r.uiTabWs = tab.ws.snapshot()
                  await tab.page.close()
                }
                await app.page.close()
                item.app.push(r)
                log(
                  `  ${side} ${scale.label} ${scenario}: ${r.idle ? `idle ${r.idle.map(i => i.taskMs).join('/')} ms` : 'profiled'}, lease ${JSON.stringify(lease)}`,
                )
              }
            }
          } finally {
            server?.close()
            await stopServer(srv)
          }
        })
      }
    }
    const offPart = plan.parts.includes('B') || plan.parts.includes('OFF')
    const uiPart = plan.parts.includes('B') || plan.parts.includes('UI')
    if (offPart || uiPart) {
      const largest = opts.scaleList.at(-1)
      for (const side of opts.smoke || !opts.baseline ? ['F'] : ['B', 'F']) {
        if (offPart) {
          await runItem(side, ++n, async item => {
            item.part = 'off'
            const srv = await ownServer({
              appDir: fixtures[side].appDir,
              port: opts.port,
              withDevtools: false,
              home: path.join(homeRoot, side),
            })
            try {
              item.app = []
              for (const scale of opts.scaleList) {
                const app = await appScenario(sides[side].appCtx, srv)
                const r = await measureApp(app, scale, opts)
                r.scenario = 'plugin-off'
                await app.page.close()
                item.app.push(r)
              }
            } finally {
              await stopServer(srv)
            }
          })
        }
        if (uiPart)
          await runItem(side, ++n, async item => {
            item.part = 'ui'
            item.mode = opts.cpuProfile ? 'profiled' : 'latency'
            const srv = await ownServer({
              appDir: fixtures[side].appDir,
              port: opts.port,
              withDevtools: true,
              home: path.join(homeRoot, side),
              inspect: !!opts.cpuProfile,
            })
            const server = opts.cpuProfile ? await connectInspector(srv) : null
            try {
              item.ui = await measureUi(
                sides[side],
                srv,
                largest,
                opts,
                outDir,
                `${n}-${side}`,
                server,
              )
            } finally {
              server?.close()
              await stopServer(srv)
            }
          })
      }
    }
  } finally {
    await browser.close()
  }

  const summary = summarize(items)
  const authCounts = Object.fromEntries(Object.entries(sides).map(([k, s]) => [k, s.authCount]))
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(
      {
        ...header,
        authCounts,
        items: items.map(i => ({
          n: i.n,
          side: i.side,
          part: i.part,
          gate: {
            ok: i.gate.ok,
            reasons: i.gate.reasons,
            load: i.gate.env.load,
            cpu: i.gate.env.cpu,
          },
          skipped: i.skipped,
          notes: i.notes,
        })),
        summary: summary.table,
      },
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(outDir, 'summary.md'),
    `# Paired measurement ${opts.label}\n\nBrowser ${header.browser}, Node ${header.node}, fixture src ${fixtures.F.src.sha256}, order ${opts.order}, auth codes consumed ${JSON.stringify(authCounts)}.\nVerdict rule: a difference is claimed only if the B and F ranges do not overlap (≥ 2 samples each).\n\n${summary.markdown}\n`,
  )
  log(`done → ${path.join(outDir, 'summary.md')}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
