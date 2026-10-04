#!/usr/bin/env node
// Which console warnings/errors does the app page emit (and Vite forwards as
// `vite:forward-console`) — plugin on vs off, same fixture, one Chromium,
// sequential dev servers. Read-only diagnostic for review P-HMR.
//
//   node perf/diag-console.mjs [--rows=500] [--max-min=4] [--label=diag-console]
//
// Output: playground/.temp/perf-results/<label>/result.json — per mode the
// console messages grouped by class (type + masked, truncated text), counts,
// one masked representative each, and the forward-console frame count.

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULTS as FIXTURE, ensurePlaygroundSync, generate } from './generate-large-app.mjs'
import {
  INIT_SCRIPT,
  checkoutMeta,
  envSnapshot,
  importRootDep,
  repoRoot,
  sha256Tree,
  sleep,
  startServer,
  stopServer,
  wsAccounting,
} from './lib/harness.mjs'

const arg = (name, d) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d
const rows = Number(arg('rows', '500'))
const maxMin = Number(arg('max-min', '4'))
const label = arg('label', 'diag-console')
const outDir = path.join(repoRoot, 'playground/.temp/perf-results', label)
const home = path.join(repoRoot, 'playground/.temp/perf-home', label)

// Mask anything instance- or machine-specific so classes group and nothing
// private (paths, ids, codes) is written out.
const mask = text =>
  String(text)
    .replaceAll(repoRoot, '<repo>')
    .replace(/\/Users\/[^/\s]+/g, '<home>')
    .replace(/[0-9a-f]{12,}/gi, '<hex>')
    .replace(/\d+/g, '#')
    .slice(0, 240)

const cleanup = []
const watchdog = setTimeout(async () => {
  console.error(`[diag-console] --max-min=${maxMin} exceeded — closing own children`)
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  process.exit(4)
}, maxMin * 60_000)
watchdog.unref()

async function measure(browser, appDir, withDevtools, port) {
  const srv = await startServer({ appDir, port, withDevtools, home })
  cleanup.push(() => stopServer(srv))
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(INIT_SCRIPT)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const ws = await wsAccounting(cdp)
  const classes = new Map()
  page.on('console', m => {
    const type = m.type()
    if (type !== 'warning' && type !== 'error') return
    const text = mask(m.text())
    const key = `${type} ${text.slice(0, 120)}`
    const c = classes.get(key) ?? { type, count: 0, example: text, location: null }
    c.count++
    if (!c.location) {
      const loc = m.location()
      c.location = loc?.url ? `${mask(loc.url.replace(srv.base, ''))}:${loc.lineNumber}` : null
    }
    classes.set(key, c)
  })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(mask(e.message)))
  await page.goto(`${srv.base}/bench`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__bench?.ready === true, null, { timeout: 60_000 })
  const phase = async name => {
    const before = [...classes.values()].reduce((s, c) => s + c.count, 0)
    if (name === 'mount') await page.evaluate(n => window.__bench.mountRows(n), rows)
    else await page.evaluate(() => window.__bench.clearRows())
    await sleep(1500)
    return {
      phase: name,
      messages: [...classes.values()].reduce((s, c) => s + c.count, 0) - before,
    }
  }
  const phases = [await phase('mount'), await phase('unmount')]
  const forward = Object.entries(ws.sentByEvent())
    .filter(([k]) => k.endsWith(' vite:forward-console'))
    .reduce((s, [, v]) => ({ frames: s.frames + v.frames, bytes: s.bytes + v.bytes }), {
      frames: 0,
      bytes: 0,
    })
  const res = {
    plugin: withDevtools ? 'on' : 'off',
    serverPid: srv.pid,
    pageLoad: classes.size ? 'see classes' : 'no warnings/errors',
    phases,
    forwardConsole: forward,
    classes: [...classes.values()].sort((a, b) => b.count - a.count),
    pageErrors,
  }
  await ctx.close()
  await stopServer(srv)
  return res
}

async function main() {
  ensurePlaygroundSync(repoRoot)
  const appDir = path.join(repoRoot, 'playground/.temp/large-app')
  generate({ ...FIXTURE, out: appDir })
  fs.mkdirSync(outDir, { recursive: true })
  const { name, mod: pw } = await importRootDep('playwright-core')
  const browser = await pw.chromium.launch({ headless: true })
  cleanup.push(() => browser.close())
  const result = {
    at: new Date().toISOString(),
    rows,
    browser: `${name} chromium ${browser.version()}`,
    node: process.version,
    viewport: '1280x900',
    fixtureSrc: sha256Tree(path.join(appDir, 'src')),
    checkout: checkoutMeta(repoRoot, 'F'),
    envBefore: envSnapshot(),
    modes: [],
  }
  try {
    for (const on of [true, false]) result.modes.push(await measure(browser, appDir, on, 5391))
  } finally {
    await browser.close()
  }
  result.envAfter = envSnapshot()
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  fs.rmSync(home, { recursive: true, force: true })
  for (const m of result.modes) {
    console.log(
      `plugin ${m.plugin}: forward-console ${m.forwardConsole.frames} frames / ${m.forwardConsole.bytes} B; phases ${JSON.stringify(m.phases)}; page errors ${m.pageErrors.length}`,
    )
    for (const c of m.classes.slice(0, 5))
      console.log(`  ${c.count} × [${c.type}] ${c.example.slice(0, 160)} @ ${c.location}`)
  }
  console.log(`→ ${path.join(outDir, 'result.json')}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
