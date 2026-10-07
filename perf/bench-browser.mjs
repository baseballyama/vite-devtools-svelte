#!/usr/bin/env node
// Browser benchmark for vite-devtools-svelte on the generated huge app.
//
// Measures, with real Chromium (Playwright + CDP):
//   app  — instrumentation overhead in the *user's* app: cold SSR, mount /
//          unmount of a wide list and a deep tree, idle main-thread cost
//          (polling), state-churn frame times, heap growth over mount cycles.
//          Run with the plugin on and off to get the overhead ratio.
//   ui   — the DevTools client against that app: first load, every panel
//          switch, search latency, scroll smoothness, live tree, idle cost of
//          polling, heap, axe accessibility violations, screenshots.
//
// Usage:
//   node perf/bench-browser.mjs --label=baseline [--repo=<checkout>] \
//     [--rows=5000] [--tree=5x5] [--big=20000] [--modes=off,on] [--ui=1] \
//     [--devtools-path=/.svelte-devtools/] [--port=5390] [--headed=1]
//
// `--repo` lets the same harness measure another checkout (e.g. a pristine
// baseline copy); the fixture is generated into <repo>/playground/.temp.
// Playwright/axe resolve from the workspace, or from PERF_NODE_MODULES.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  generate,
  ensurePlaygroundSync,
  DEFAULTS as FIXTURE_DEFAULTS,
  fixtureShape,
  kitShape,
} from './generate-large-app.mjs'

const perfDir = import.meta.dirname
const repoRoot = path.resolve(perfDir, '..')

function parseArgs(argv) {
  const opts = {
    label: 'local',
    repo: repoRoot,
    rows: 5000,
    tree: '5x5',
    big: 20000,
    cycles: 8,
    modes: 'off,on',
    ui: 1,
    port: 5390,
    devtoolsPath: '/.svelte-devtools/',
    headed: 0,
    regen: 0,
    idleMs: 5000,
  }
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (!m) continue
    const key = m[1].replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (!(key in opts)) throw new Error(`Unknown option --${m[1]}`)
    opts[key] = typeof opts[key] === 'number' ? Number(m[2]) : m[2]
  }
  opts.repo = path.resolve(opts.repo)
  return opts
}

async function importDep(name) {
  const bases = [process.env.PERF_NODE_MODULES, repoRoot].filter(Boolean)
  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'noop.js'))
      return await import(pathToFileURL(req.resolve(name)).href)
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `Cannot resolve "${name}". Add it as a devDependency or set PERF_NODE_MODULES=<dir containing node_modules>.`,
  )
}

function resolveDepFile(name, file) {
  const bases = [process.env.PERF_NODE_MODULES, repoRoot].filter(Boolean)
  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'noop.js'))
      return path.join(path.dirname(req.resolve(`${name}/package.json`)), file)
    } catch {
      /* try next */
    }
  }
  return null
}

const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms)
  })
const median = xs => {
  const s = xs.toSorted((a, b) => a - b)
  return s.length > 0 ? s[Math.floor((s.length - 1) / 2)] : NaN
}
const pct = (xs, p) => {
  const s = xs.toSorted((a, b) => a - b)
  return s.length > 0 ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN
}
const r1 = n => Math.round(n * 10) / 10

// ---------------------------------------------------------------- server

async function startServer(appDir, port, withDevtools) {
  const viteBin = path.join(appDir, '../../node_modules/vite/bin/vite.js')
  const t0 = performance.now()
  const child = spawn(process.execPath, [viteBin, 'dev', '--port', String(port), '--strictPort'], {
    cwd: appDir,
    env: { ...process.env, PERF_DEVTOOLS: withDevtools ? '1' : '0', PERF_LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const getLog = () => log
  child.stdout.on('data', d => {
    log += d
  })
  child.stderr.on('data', d => {
    log += d
  })
  const base = `http://localhost:${port}`
  // Ready = the dev server answered the first SSR request of /bench (includes
  // the cold compile of the route + plugin transforms).
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited early:\n${log}`)
    try {
      const res = await fetch(`${base}/bench`)
      if (res.ok) {
        await res.text()
        return { child, base, coldMs: performance.now() - t0, log: getLog }
      }
    } catch {
      /* not listening yet */
    }
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error(`vite did not become ready:\n${log}`)
}

async function stopServer(srv) {
  if (srv?.child.exitCode !== null) return
  srv.child.kill('SIGTERM')
  for (let i = 0; i < 50 && srv.child.exitCode === null; i++) await sleep(100)
  if (srv.child.exitCode === null) srv.child.kill('SIGKILL')
}

// ---------------------------------------------------------------- page helpers

// Installed before any page script: long-task + layout-shift collectors.
const INIT_SCRIPT = `
(() => {
  window.__perf = { longTasks: [], cls: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
})();
`

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map(m => [m.name, m.value]))
}

async function heapAfterGc(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return usedSize
}

// Main-thread cost over a quiet window: CPU time spent in tasks/scripts plus
// long tasks. This is what the user's app pays for background polling.
async function idleWindow(page, cdp, ms) {
  const before = await cdpMetrics(cdp)
  const ltStart = await page.evaluate(() => performance.now())
  await sleep(ms)
  const after = await cdpMetrics(cdp)
  const longTasks = await page.evaluate(
    s => window.__perf.longTasks.filter(t => t.start >= s),
    ltStart,
  )
  return {
    windowMs: ms,
    taskMs: r1((after.TaskDuration - before.TaskDuration) * 1000),
    scriptMs: r1((after.ScriptDuration - before.ScriptDuration) * 1000),
    layoutMs: r1((after.LayoutDuration - before.LayoutDuration) * 1000),
    busyPct: r1(((after.TaskDuration - before.TaskDuration) * 1000 * 100) / ms),
    longTasks: longTasks.length,
    longTaskMs: r1(longTasks.reduce((s, t) => s + t.dur, 0)),
  }
}

function frameStats(durations) {
  // First sample includes the setup frame; drop it.
  const d = durations.slice(1)
  return {
    frames: d.length,
    p50: r1(pct(d, 50)),
    p95: r1(pct(d, 95)),
    max: r1(Math.max(...d)),
    over50ms: d.filter(x => x > 50).length,
  }
}

// ---------------------------------------------------------------- app scenario

async function benchApp(browser, srv, opts, withDevtools) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(INIT_SCRIPT)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')

  const tNav = performance.now()
  await page.goto(`${srv.base}/bench`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__bench?.ready === true, null, { timeout: 120_000 })
  const hydrateMs = performance.now() - tNav
  const hasRuntime = await page.evaluate(() => !!window.__SVELTE_DEVTOOLS__)

  const [depth, breadth] = opts.tree.split('x').map(Number)
  const res = { withDevtools, hasRuntime, hydrateMs: r1(hydrateMs), errors }

  // warm-up so JIT / module graph is settled before timing
  await page.evaluate(() => window.__bench.mountRows(200))
  await page.evaluate(() => window.__bench.clearRows())
  await sleep(300)

  const heap0 = await heapAfterGc(cdp)

  const mounts = []
  const unmounts = []
  for (let i = 0; i < 3; i++) {
    mounts.push(await page.evaluate(n => window.__bench.mountRows(n), opts.rows))
    await sleep(200)
    unmounts.push(await page.evaluate(() => window.__bench.clearRows()))
    await sleep(200)
  }
  res.rows = {
    n: opts.rows,
    mountMs: r1(median(mounts)),
    unmountMs: r1(median(unmounts)),
    mountRuns: mounts.map(r1),
    unmountRuns: unmounts.map(r1),
  }

  const treeMount = await page.evaluate(
    ([d, b]) => window.__bench.mountTree(d, b),
    [depth, breadth],
  )
  const treeNodes = (breadth ** (depth + 1) - 1) / (breadth - 1)
  await sleep(200)
  const treeUnmount = await page.evaluate(() => window.__bench.clearTree())
  res.tree = {
    depth,
    breadth,
    nodes: treeNodes,
    mountMs: r1(treeMount),
    unmountMs: r1(treeUnmount),
  }

  // Steady state with everything mounted: what does the app pay while idle?
  await page.evaluate(n => window.__bench.mountRows(n), opts.rows)
  await page.evaluate(([d, b]) => window.__bench.mountTree(d, b), [depth, breadth])
  await sleep(1500) // let debounced devtools flushes run first
  res.idleMounted = await idleWindow(page, cdp, opts.idleMs)

  await page.evaluate(n => window.__bench.setBig(n), opts.big)
  await sleep(1000)
  res.idleBigState = { bigItems: opts.big, ...(await idleWindow(page, cdp, opts.idleMs)) }

  const churn = await page.evaluate(() => window.__bench.churn(50, 3000))
  res.churn = { perFrame: 50, ...frameStats(churn) }

  res.heapMountedMB = r1((await heapAfterGc(cdp)) / 1048576)
  res.runtimeSizes = await page.evaluate(() => {
    const dt = window.__SVELTE_DEVTOOLS__
    if (!dt) return null
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the browser via page.evaluate; cannot reference module scope
    const size = x =>
      x && typeof x.size === 'number' ? x.size : Array.isArray(x) ? x.length : null
    return {
      instances: size(dt._instances),
      reactiveNodes: size(dt._reactiveNodes),
      profiles: size(dt._profiles),
      // observable ring (the raw array is bulk-trimmed, up to 2x between reads)
      timeline: size(dt.getStateTimeline ? dt.getStateTimeline() : dt._stateTimeline),
      fpsFrames: size(dt._fpsFrameTimes),
    }
  })

  // Leak check: repeated mount/unmount must return the heap to ~baseline.
  await page.evaluate(() => window.__bench.clearTree())
  await page.evaluate(() => window.__bench.setBig(0))
  for (let i = 0; i < opts.cycles; i++) {
    await page.evaluate(() => window.__bench.mountRows(2000))
    await page.evaluate(() => window.__bench.clearRows())
  }
  await sleep(1500)
  const heap1 = await heapAfterGc(cdp)
  res.leak = {
    cycles: opts.cycles,
    heapBeforeMB: r1(heap0 / 1048576),
    heapAfterMB: r1(heap1 / 1048576),
    growthMB: r1((heap1 - heap0) / 1048576),
  }
  res.runtimeSizesAfterUnmount = await page.evaluate(() => {
    const dt = window.__SVELTE_DEVTOOLS__
    if (!dt) return null
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the browser via page.evaluate; cannot reference module scope
    const size = x =>
      x && typeof x.size === 'number' ? x.size : Array.isArray(x) ? x.length : null
    return {
      instances: size(dt._instances),
      reactiveNodes: size(dt._reactiveNodes),
      profiles: size(dt._profiles),
      stateSnapshots: size(dt._stateSnapshots),
    }
  })
  await ctx.close()
  return res
}

// ---------------------------------------------------------------- UI scenario

const PANEL_LABELS = [
  'Overview',
  'Components',
  'Routes',
  'Assets',
  'Modules',
  'Render',
  'Reactive',
  'FPS',
  'Loads',
  'Timeline',
  'Build',
  'API',
  'Errors',
  'Inspect',
  'OG',
]

// Find the navigation control for a panel by accessible name. Tries roles the
// redesign is likely to use (tab / link / button) and falls back to text.
async function findPanelControl(page, label) {
  const name = new RegExp(`^\\s*${label}\\b`, 'i')
  for (const role of ['tab', 'link', 'button', 'menuitem']) {
    const loc = page.getByRole(role, { name })
    if ((await loc.count()) > 0) return loc.first()
  }
  return null
}

// A panel is settled when the network is idle, nothing is marked aria-busy,
// and no bare "Loading…" placeholder is visible. RPC transports may connect
// lazily (the baseline waits up to 2 s for DevTools Kit before falling back to
// HTTP), so network idle alone is not enough.
async function settle(page, timeout = 60_000) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page
    .waitForFunction(
      () => {
        if (document.querySelector('[aria-busy="true"]')) return false
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (/^\s*Loading(\.\.\.|…)?\s*$/i.test(n.textContent ?? '')) {
            const el = n.parentElement
            if (el && el.offsetParent !== null) return false
          }
        }
        return true
      },
      null,
      { timeout, polling: 50 },
    )
    .catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(
    () =>
      new Promise(r => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            r()
          })
        })
      }),
  )
}

async function benchUi(browser, srv, opts, outDir) {
  // Keep a live app page open so live components / profiles / FPS exist.
  const appCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const app = await appCtx.newPage()
  await app.goto(`${srv.base}/bench`)
  await app.waitForFunction(() => window.__bench?.ready === true, null, { timeout: 120_000 })
  const [depth, breadth] = opts.tree.split('x').map(Number)
  await app.evaluate(n => window.__bench.mountRows(n), opts.rows)
  await app.evaluate(([d, b]) => window.__bench.mountTree(d, b), [depth, breadth])
  await app.evaluate(() => window.__bench.churn(5, 1000))
  await sleep(1500)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(INIT_SCRIPT)
  const page = await ctx.newPage()
  const errors = []
  const consoleErrors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)))
  const rpcCalls = []
  page.on('request', r => {
    if (r.url().includes('__svelte-devtools') || r.url().includes('rpc')) rpcCalls.push(r.url())
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')

  const res = { errors, consoleErrors, panels: {} }
  const t0 = performance.now()
  await page.goto(`${srv.base}${opts.devtoolsPath}`, { waitUntil: 'load' })
  res.loadEventMs = r1(performance.now() - t0)
  await settle(page)
  res.firstSettledMs = r1(performance.now() - t0)
  res.paint = await page.evaluate(() =>
    Object.fromEntries(
      performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)]),
    ),
  )
  await page.screenshot({ path: path.join(outDir, `ui-initial.png`) })

  for (const label of PANEL_LABELS) {
    const ctl = await findPanelControl(page, label)
    if (!ctl) {
      res.panels[label] = { found: false }
      continue
    }
    const callsBefore = rpcCalls.length
    const ts = performance.now()
    await ctl.click()
    await settle(page)
    const ms = performance.now() - ts
    const dom = await page.evaluate(() => document.querySelectorAll('*').length)
    await page.screenshot({ path: path.join(outDir, `ui-${label.toLowerCase()}.png`) })
    res.panels[label] = {
      found: true,
      switchMs: r1(ms),
      domNodes: dom,
      httpRequests: rpcCalls.length - callsBefore,
    }
  }

  // Components: search latency + scroll smoothness + live tree.
  const comp = await findPanelControl(page, 'Components')
  if (comp) {
    await comp.click()
    await settle(page)
    const search = page
      .locator(
        'input[type="search"], input[placeholder*="earch" i], input[placeholder*="ilter" i], [role="searchbox"]',
      )
      .first()
    if ((await search.count()) > 0) {
      const lat = []
      for (const q of ['C', 'C0', 'C07', 'C07 ', 'C07', 'C0', 'C', '']) {
        lat.push(
          await search.evaluate(async (el, value) => {
            const t = performance.now()
            el.value = value
            el.dispatchEvent(new Event('input', { bubbles: true }))
            await new Promise(r => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  r()
                })
              })
            })
            return performance.now() - t
          }, q),
        )
      }
      res.componentsSearch = {
        keystrokes: lat.length,
        p50: r1(median(lat)),
        max: r1(Math.max(...lat)),
      }
    }
    res.componentsScroll = await scrollLargest(page)

    const live = page
      .getByRole('button', { name: /live/i })
      .or(page.getByRole('tab', { name: /live/i }))
    if ((await live.count()) > 0) {
      const ts = performance.now()
      await live.first().click()
      await settle(page)
      await sleep(2500) // at least one poll cycle
      res.liveTree = {
        renderMs: r1(performance.now() - ts - 2500),
        domNodes: await page.evaluate(() => document.querySelectorAll('*').length),
      }
      await page.screenshot({ path: path.join(outDir, `ui-components-live.png`) })
      // H2: with > 5 000 instances the collector must keep the roots, so the
      // live tree still shows the layout/page instead of orphaned rows.
      res.liveTree.hasRouteRoot = (await page.getByText(/^\+(page|layout)$/).count()) > 0
      res.liveTree.textMentionsTruncation = await page.evaluate(() =>
        /of\s+[\d,]+|truncat/i.test(document.body.innerText),
      )
      res.liveTree.idle = await idleWindow(page, cdp, opts.idleMs)
      res.liveTree.scroll = await scrollLargest(page)
      // Update storm: app remounts all rows while the live tree is open.
      const before = await cdpMetrics(cdp)
      await app.evaluate(() => window.__bench.clearRows())
      await app.evaluate(n => window.__bench.mountRows(n), opts.rows)
      await sleep(4000)
      const after = await cdpMetrics(cdp)
      res.liveTree.remountUpdateTaskMs = r1((after.TaskDuration - before.TaskDuration) * 1000)
    }
  }

  // Idle cost of the devtools page itself on its heaviest panel (polling).
  for (const label of ['Render', 'FPS', 'Timeline']) {
    const ctl = await findPanelControl(page, label)
    if (!ctl) continue
    await ctl.click()
    await settle(page)
    res.panels[label].idle = await idleWindow(page, cdp, 3000)
  }

  res.heapMB = r1((await heapAfterGc(cdp)) / 1048576)
  res.httpRequestsTotal = rpcCalls.length

  // Accessibility (axe-core) on the initial + components panel.
  const axePath = resolveDepFile('axe-core', 'axe.min.js')
  if (axePath) {
    res.a11y = {}
    for (const label of ['Overview', 'Components', 'Routes']) {
      const ctl = await findPanelControl(page, label)
      if (!ctl) continue
      await ctl.click()
      await settle(page)
      await page.addScriptTag({ path: axePath })
      res.a11y[label] = await page.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] })
        return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      })
    }
  }
  res.cls = await page.evaluate(() => Math.round(window.__perf.cls * 1000) / 1000)

  // Keyboard reachability: can the panel nav be reached and switched by keys?
  res.keyboard = await page.evaluate(() => {
    const focusables = [
      ...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]'),
    ].filter(el => el.getAttribute('tabindex') !== '-1' && !el.hasAttribute('disabled'))
    return { focusables: focusables.length }
  })

  await ctx.close()
  await appCtx.close()
  return res
}

// Scroll the largest scroll container 120px per frame for ~2 s and record
// frame durations (virtualization / layout cost).
function scrollLargest(page) {
  return page.evaluate(async () => {
    const els = [...document.querySelectorAll('*')].filter(el => {
      const s = getComputedStyle(el)
      return (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 50
      )
    })
    els.sort((a, b) => b.scrollHeight - a.scrollHeight)
    const el = els[0]
    if (!el) return null
    const durations = []
    let last = performance.now()
    const end = last + 2000
    while (performance.now() < end) {
      el.scrollTop += 120
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) el.scrollTop = 0
      await new Promise(r => {
        requestAnimationFrame(r)
      })
      const now = performance.now()
      durations.push(now - last)
      last = now
    }
    const d = durations.slice(1).toSorted((a, b) => a - b)
    const p = q => Math.round(d[Math.min(d.length - 1, Math.floor(q * d.length))] * 10) / 10
    return {
      scrollHeight: el.scrollHeight,
      frames: d.length,
      p50: p(0.5),
      p95: p(0.95),
      max: Math.round(d.at(-1) * 10) / 10,
      domInScroller: el.querySelectorAll('*').length,
    }
  })
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const appDir = path.join(opts.repo, 'playground/.temp/large-app')
  ensurePlaygroundSync(opts.repo)
  // Regenerate when missing or generated for another Kit major.
  if (opts.regen || fixtureShape(appDir) !== kitShape(appDir)) {
    generate({ ...FIXTURE_DEFAULTS, out: appDir })
  }
  const outDir = path.join(perfDir, 'results', opts.label)
  fs.mkdirSync(outDir, { recursive: true })

  // Workspace-root `playwright-core` (same Chromium for every checkout).
  const pw = await importDep('playwright-core').catch(() => importDep('playwright'))
  const chromium = pw.chromium ?? pw.default.chromium
  const browser = await chromium.launch({ headless: !opts.headed })
  const result = {
    label: opts.label,
    date: new Date().toISOString(),
    env: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      cpus: os.cpus().length,
      memGB: Math.round(os.totalmem() / 2 ** 30),
      chromium: browser.version(),
      repo: opts.repo,
    },
    options: opts,
    modes: {},
  }

  try {
    for (const mode of opts.modes.split(',')) {
      const withDevtools = mode === 'on'
      const srv = await startServer(appDir, opts.port, withDevtools)
      try {
        const m = {
          coldSsrMs: r1(srv.coldMs),
          app: await benchApp(browser, srv, opts, withDevtools),
        }
        if (withDevtools && opts.ui) m.ui = await benchUi(browser, srv, opts, outDir)
        result.modes[mode] = m
      } finally {
        await stopServer(srv)
      }
    }
  } finally {
    await browser.close()
  }

  if (result.modes.on && result.modes.off) {
    const on = result.modes.on.app
    const off = result.modes.off.app
    const ratio = (a, b) => r1(((a - b) / b) * 100)
    result.overheadPct = {
      rowsMount: ratio(on.rows.mountMs, off.rows.mountMs),
      rowsUnmount: ratio(on.rows.unmountMs, off.rows.unmountMs),
      treeMount: ratio(on.tree.mountMs, off.tree.mountMs),
      treeUnmount: ratio(on.tree.unmountMs, off.tree.unmountMs),
      idleTaskMsDelta: r1(on.idleMounted.taskMs - off.idleMounted.taskMs),
      idleBigTaskMsDelta: r1(on.idleBigState.taskMs - off.idleBigState.taskMs),
      churnP95Delta: r1(on.churn.p95 - off.churn.p95),
      coldSsr: ratio(result.modes.on.coldSsrMs, result.modes.off.coldSsrMs),
    }
  }

  const file = path.join(outDir, 'result.json')
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  console.log(`\nwrote ${path.relative(repoRoot, file)}`)
}

try {
  await main()
} catch (e) {
  console.error(e)
  process.exit(1)
}
