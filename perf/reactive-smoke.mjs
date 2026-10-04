#!/usr/bin/env node
// Reduced reactive-STATE smoke (a separate axis from the component-count
// fixture): perf/generate-reactive-app.mjs at a reduced depth, one checkout,
// OFF / CLOSED / OPEN, n = 1. Harness check only — no effect conclusions.
//
// Per state it records the fixture ground truth (expected tracked nodes by
// type, cells, groups, written sequence numbers per noise stream) next to what
// the runtime reports, the idle cost under timer-driven write streams, the
// click -> paint latency of the four "why did it change?" scenarios, flush
// time of scripted writes, WS bytes and heap after GC.
//
// Usage: node perf/reactive-smoke.mjs [--repo=.] [--treeDepth=3] [--label=reactive-smoke]
//          [--noise=10:50:primitive,1:20:deep] [--noiseMs=6000] [--reps=5]
//          [--gate=4:50] [--linux-gate=2048:10] [--gate-wait=180] [--max-min=8]

import fs from 'node:fs'
import path from 'node:path'
import { ensurePlaygroundSync } from './generate-large-app.mjs'
import { DEFAULTS as REACTIVE_DEFAULTS, generate, expected } from './generate-reactive-app.mjs'
import {
  INIT_SCRIPT,
  checkoutMeta,
  envSnapshot,
  heapAfterGc,
  idleWindow,
  importRootDep,
  inputToPaint,
  openDevtoolsTab,
  r1,
  repoRoot,
  runtimeBreakdown,
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

const opts = {
  repo: repoRoot,
  treeDepth: 3,
  label: 'reactive-smoke',
  noise: '10:50:primitive,1:20:deep',
  noiseMs: 6000,
  reps: 5,
  gate: '4:50',
  linuxGate: '2048:10',
  gateWait: 180,
  maxMin: 8,
  port: 5391,
  devtoolsPath: '/.svelte-devtools/',
}
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg)
  const key = m?.[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  if (!m || !(key in opts)) throw new Error(`Unknown option ${arg}`)
  opts[key] = typeof opts[key] === 'number' ? Number(m[2]) : m[2]
}
const [load1Max, idleMin] = opts.gate.split(':').map(Number)
const [memMinMB, psiMemMax] = opts.linuxGate.split(':').map(Number)
const gateSpec = { load1Max, idleMin, memMinMB, psiMemMax, oomBase: envSnapshot().oom ?? null }
const noise = opts.noise.split(',').map(s => {
  const [hz, k, kind] = s.split(':')
  return { hz: Number(hz), k: Number(k), kind }
})
const log = (...a) => console.log(`[reactive ${new Date().toISOString().slice(11, 19)}]`, ...a)

const repo = path.resolve(opts.repo)
const outDir = path.join(repo, 'playground/.temp/perf-results', opts.label)
const appDir = path.join(repo, 'playground/.temp/reactive-app')
const homeRoot = path.join(repo, 'playground/.temp/perf-home', opts.label)

async function measureState(browser, state) {
  const withDevtools = state !== 'off'
  const srv = await startServer({ appDir, port: opts.port, withDevtools, home: homeRoot })
  const side = {
    uiCtx: await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    appCtx: await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    authCount: 0,
    notes: [],
  }
  await side.appCtx.addInitScript(INIT_SCRIPT)
  try {
    const tab = state === 'open' ? await openDevtoolsTab(side, srv, opts) : null
    const page = await side.appCtx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    const cdp = await side.appCtx.newCDPSession(page)
    await cdp.send('Performance.enable')
    const ws = await wsAccounting(cdp)
    await page.goto(`${srv.base}/reactive`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__reactive?.ready === true, null, { timeout: 120_000 })
    await sleep(2000)
    const res = { state, serverColdMs: r1(srv.coldMs) }
    res.groundTruth = {
      expected: await page.evaluate(() => window.__reactive.expected()),
      countsAtStart: await page.evaluate(() => window.__reactive.counts()),
    }
    res.heapStartMB = r1((await heapAfterGc(cdp)) / 1048576)
    // idle under write streams (rates are scenario inputs, not targets)
    const wsB = ws.snapshot()
    await page.evaluate(list => window.__reactive.startNoise(list), noise)
    res.noiseWindow = await idleWindow(page, cdp, opts.noiseMs, ws)
    res.groundTruth.noise = await page.evaluate(() => window.__reactive.stopNoise())
    res.noiseWs = wsDelta(wsB, ws.snapshot())
    await sleep(500)
    res.quietWindow = await idleWindow(page, cdp, 3000, ws)
    // scripted writes: ms from the write to the DOM being updated
    res.flushMs = {}
    for (const [name, arg] of [
      ['writePrimitives', 200],
      ['cascade', 15],
      ['mutateDeep', 50],
      ['writeObjects', 50],
    ])
      res.flushMs[`${name}(${arg})`] = r1(
        await page.evaluate(([f, a]) => window.__reactive.flushTime(f, a), [name, arg]),
      )
    // "why did it change?" scenarios: real clicks, click -> next frame / Event Timing
    res.scenarios = {}
    for (const sc of await page.evaluate(() => window.__reactive.scenarios())) {
      res.scenarios[sc.id] = await inputToPaint(page, sc.trigger.click, opts.reps)
    }
    res.groundTruth.countsAtEnd = await page.evaluate(() => window.__reactive.counts())
    res.heapEndMB = r1((await heapAfterGc(cdp)) / 1048576)
    res.runtime = await runtimeState(page)
    // Count contract (review M6): expected() vs runtime by kind, per file and
    // per name, 0 tolerance. A mismatch is recorded (not retried) and the node
    // axis stays unusable for this run.
    res.runtimeBreakdown = await runtimeBreakdown(page)
    if (res.runtimeBreakdown) {
      const exp = res.groundTruth.expected
      const rt = res.runtimeBreakdown
      const rows = res.groundTruth.countsAtEnd.rows
      const mismatch = []
      const check = (where, e, r) => {
        if (e !== r) mismatch.push(`${where}: expected ${e}, runtime ${r}`)
      }
      res.kindCompare = {
        state: { expected: exp.nodes.state, runtime: rt.nodesByType.state ?? 0 },
        derived: { expected: exp.nodes.derived, runtime: rt.nodesByType.derived ?? 0 },
        effect: { expected: exp.nodes.effect, runtime: rt.nodesByType.effect ?? 0 },
        proxies: { expected: exp.proxies, runtime: rt.proxies ?? 0 },
      }
      for (const [k, v] of Object.entries(res.kindCompare)) check(k, v.expected, v.runtime)
      const runtimeFiles = new Set([
        ...Object.keys(rt.nodesByFile).map(k => k.slice(0, k.lastIndexOf(' '))),
        ...Object.keys(rt.instancesByFile),
      ])
      res.fileCompare = {}
      let expectedInstances = 0
      for (const file of new Set([...Object.keys(exp.byFile), ...runtimeFiles])) {
        const e = exp.byFile[file]
        if (!e) mismatch.push(`unexpected file ${file}`)
        const instances = e && (e.instances ?? rows)
        expectedInstances += instances ?? 0
        const names = {}
        for (const [k, n] of Object.entries(rt.nodesByFileName))
          if (k.startsWith(`${file} `)) names[k.slice(file.length + 1)] = n
        const c = (res.fileCompare[file] = {
          instances: { expected: instances ?? 0, runtime: rt.instancesByFile[file] ?? 0 },
          state: { expected: e?.state ?? 0, runtime: rt.nodesByFile[`${file} state`] ?? 0 },
          derived: { expected: e?.derived ?? 0, runtime: rt.nodesByFile[`${file} derived`] ?? 0 },
          effect: { expected: e?.effect ?? 0, runtime: rt.nodesByFile[`${file} effect`] ?? 0 },
          proxies: { expected: e?.proxies ?? 0, runtime: rt.proxiesByFile[file] ?? 0 },
        })
        for (const [k, v] of Object.entries(c)) check(`${file} ${k}`, v.expected, v.runtime)
        c.names = {}
        for (const name of new Set([...Object.keys(e?.names ?? {}), ...Object.keys(names)])) {
          c.names[name] = { expected: e?.names[name] ?? 0, runtime: names[name] ?? 0 }
          check(`${file} ${name}`, c.names[name].expected, c.names[name].runtime)
        }
      }
      check('total instances', expectedInstances, res.runtime?.instances)
      for (const b of rt.ambiguousBasenames) mismatch.push(`ambiguous basename ${b}`)
      res.contractMismatch = mismatch
      res.contractOk = mismatch.length === 0
    }
    res.wsSentByEvent = ws.sentByEvent()
    res.errors = errors
    res.notes = side.notes
    if (tab) await tab.page.close()
    await page.close()
    return res
  } finally {
    await side.uiCtx.close()
    await side.appCtx.close()
    await stopServer(srv)
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error(`[reactive] --max-min=${opts.maxMin} exceeded — exiting`)
    process.exit(4)
  }, opts.maxMin * 60_000)
  watchdog.unref()
  fs.mkdirSync(outDir, { recursive: true })
  ensurePlaygroundSync(repo)
  generate({ treeDepth: opts.treeDepth, out: appDir })
  const fixture = {
    generator: sha256File(path.join(repoRoot, 'perf/generate-reactive-app.mjs')),
    src: sha256Tree(path.join(appDir, 'src')),
    treeDepth: opts.treeDepth,
    expected: expected({ ...REACTIVE_DEFAULTS, treeDepth: opts.treeDepth }),
  }
  const { name: pwName, mod: pw } = await importRootDep('playwright-core', 'playwright')
  const browser = await pw.chromium.launch({ headless: true })
  const header = {
    label: opts.label,
    mode: 'latency',
    note: 'reduced reactive fixture smoke, n = 1: harness check, no effect conclusions',
    startedAt: new Date().toISOString(),
    browser: `${pwName} chromium ${browser.version()}`,
    node: process.version,
    meta: checkoutMeta(repo, 'F'),
    fixture,
    noise,
    noiseMs: opts.noiseMs,
    reps: opts.reps,
  }
  const items = []
  try {
    for (const state of ['off', 'closed', 'open']) {
      const gate = await waitForGate(gateSpec, opts.gateWait, log)
      if (!gate.ok) {
        items.push({ state, skipped: `gate failed: ${gate.reasons.join('; ')}`, gate })
        log(`${state} skipped — gate failed`)
        continue
      }
      let r
      try {
        r = await measureState(browser, state)
      } catch (e) {
        r = { state, error: String(e?.stack ?? e).slice(0, 2000) }
      }
      r.gate = gate
      r.envAfter = envSnapshot()
      items.push(r)
      // written after every state, so a later failure keeps earlier ones (M4)
      fs.writeFileSync(
        path.join(outDir, 'reactive.json'),
        JSON.stringify({ ...header, items, complete: false }, null, 2) + '\n',
      )
      if (r.error) throw new Error(`reactive ${state} failed (recorded)`)
      const contract = !r.contractMismatch
        ? 'contract n/a'
        : r.contractOk
          ? 'contract ok'
          : `contract MISMATCH (${r.contractMismatch.length})`
      log(
        `${state}: noise task ${r.noiseWindow.taskMs} ms / ${opts.noiseMs} ms, runtime nodes ${r.runtime?.reactiveNodes ?? 'n/a'} of ${r.groundTruth.expected.total} expected, ${contract}`,
      )
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(
    path.join(outDir, 'reactive.json'),
    JSON.stringify({ ...header, items, complete: true }, null, 2) + '\n',
  )
  log(`done → ${path.join(outDir, 'reactive.json')}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
