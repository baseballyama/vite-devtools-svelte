// Shared helpers for the paired baseline/final browser measurement
// (perf/run-paired.mjs). Pure helpers: nothing here starts work on import.
//
// Ground rules encoded here (docs/performance-status.md, "Bounded paired
// measurement plan"):
// - only this process's own children are ever stopped (by the handle we
//   spawned), never other processes;
// - environment is recorded read-only (uptime / top / sysctl) and gates runs;
// - fixture sources must be byte-identical between the compared checkouts.

import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const perfDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = path.resolve(perfDir, '..')

export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const r1 = n => Math.round(n * 10) / 10
// Mathematical median: the mean of the two middle values for an even count.
// (Until 2026-10-04 03:3x this returned the lower middle value; the slot A
// summary was re-aggregated from the unchanged raw items with this version.)
export const median = xs => {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN
}

// ---------------------------------------------------------------- deps

// Dependencies come from the workspace root only (root devDependencies
// `playwright-core`, `axe-core`), so both checkouts are driven by the very
// same browser automation and Chromium build.
export async function importRootDep(...names) {
  const req = createRequire(path.join(repoRoot, 'noop.js'))
  for (const name of names) {
    try {
      const mod = await import(pathToFileURL(req.resolve(name)).href)
      return { name, mod: mod.default ?? mod }
    } catch {
      /* try next */
    }
  }
  throw new Error(`Cannot resolve any of ${names.join(', ')} from the workspace root`)
}

export function rootDepFile(name, file) {
  try {
    const req = createRequire(path.join(repoRoot, 'noop.js'))
    return path.join(path.dirname(req.resolve(`${name}/package.json`)), file)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- metadata

export function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}

/** Hash of every file under `dir` (sorted relative paths + contents). */
export function sha256Tree(dir) {
  const hash = crypto.createHash('sha256')
  const files = []
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(dir)
  files.sort()
  for (const f of files) {
    hash.update(path.relative(dir, f))
    hash.update(fs.readFileSync(f))
  }
  return { sha256: hash.digest('hex').slice(0, 16), files: files.length }
}

function pkgVersion(repo, name) {
  try {
    const file = path.join(repo, 'playground/node_modules', name, 'package.json')
    return JSON.parse(fs.readFileSync(fs.realpathSync(file), 'utf8')).version
  } catch {
    return null
  }
}

/** Read-only description of a checkout: versions, dist fingerprint, git state. */
export function checkoutMeta(repo, label) {
  const pkg = path.join(repo, 'packages/vite-devtools-svelte')
  const clientAssets = path.join(pkg, 'dist/client/assets')
  const clientJs = fs.existsSync(clientAssets)
    ? fs
        .readdirSync(clientAssets)
        .filter(f => f.endsWith('.js'))
        .sort()
        .map(f => ({ file: f, sha256: sha256File(path.join(clientAssets, f)) }))
    : []
  let git = null
  try {
    const rev = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean).length
    git = { rev, dirtyEntries: dirty }
  } catch {
    git = { rev: null, note: 'not a git checkout (e.g. git archive copy)' }
  }
  return {
    label,
    repo,
    git,
    versions: Object.fromEntries(
      [
        'vite',
        'svelte',
        '@sveltejs/kit',
        '@sveltejs/vite-plugin-svelte',
        'vite-devtools-svelte',
      ].map(n => [n, pkgVersion(repo, n)]),
    ),
    dist: {
      indexMjs: sha256File(path.join(pkg, 'dist/index.mjs')),
      clientHtml: sha256File(path.join(pkg, 'dist/client/index.html')),
      clientJs,
      mtime: (() => {
        try {
          return fs.statSync(path.join(pkg, 'dist/index.mjs')).mtime.toISOString()
        } catch {
          return null
        }
      })(),
    },
  }
}

// ---------------------------------------------------------------- environment

/**
 * Read-only snapshot of machine load: `uptime`, one `top` sample, swap.
 * Never signals or alters any process.
 */
export function envSnapshot() {
  if (process.platform === 'linux') return linuxEnvSnapshot()
  const out = { at: new Date().toISOString(), load: os.loadavg().map(r1), cpus: os.cpus().length }
  try {
    // The first `top -l` sample is not an instantaneous CPU reading; take two
    // samples 1 s apart and parse only the second one.
    const raw = execFileSync('top', ['-l', '2', '-s', '1', '-n', '0'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const top = raw.slice(raw.lastIndexOf('Processes:'))
    const cpu = /CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/.exec(top)
    if (cpu) out.cpu = { user: +cpu[1], sys: +cpu[2], idle: +cpu[3] }
    const mem = /PhysMem:\s*([^\n]+)/.exec(top)
    if (mem) out.physMem = mem[1].trim()
    const unused = /([\d.]+)([MG]) unused/.exec(top)
    if (unused) out.unusedMB = +unused[1] * (unused[2] === 'G' ? 1024 : 1)
    const procs = /Processes:\s*(\d+) total,\s*(\d+) running/.exec(top)
    if (procs) out.processes = { total: +procs[1], running: +procs[2] }
  } catch {
    out.topError = true
  }
  try {
    out.swap = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' }).trim()
  } catch {
    /* optional */
  }
  try {
    // 1 = normal, 2 = warning, 4 = critical (read-only sysctl; never the
    // `memory_pressure` tool, which applies pressure)
    out.pressureLevel = Number(
      execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8' }),
    )
  } catch {
    /* recorded as unknown */
  }
  return out
}

const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Aggregate jiffies of the `cpu` line of /proc/stat: [busy, idle]. */
function procStatCpu() {
  const line = readText('/proc/stat')?.split('\n')[0]
  if (!line?.startsWith('cpu ')) return null
  const v = line.trim().split(/\s+/).slice(1).map(Number)
  const idle = v[3] + (v[4] ?? 0) // idle + iowait
  return { idle, total: v.reduce((a, b) => a + b, 0) }
}

/** `some avg10` / `full avg10` of a PSI file (Linux >= 4.20). */
function psi(kind) {
  const text = readText(`/proc/pressure/${kind}`)
  if (!text) return null
  const out = {}
  for (const m of text.matchAll(/^(some|full) avg10=([\d.]+)/gm)) out[m[1]] = Number(m[2])
  return out
}

/** cgroup v2 file of this process's own cgroup (falls back to the root). */
function cgroupFile(name) {
  const rel = /^0::(.*)$/m.exec(readText('/proc/self/cgroup') ?? '')?.[1]
  for (const dir of [rel && path.join('/sys/fs/cgroup', rel), '/sys/fs/cgroup'].filter(Boolean)) {
    const text = readText(path.join(dir, name))
    if (text !== null) return text.trim()
  }
  return null
}

/**
 * Linux runner (GitHub-hosted) equivalent of the macOS snapshot: CPU idle
 * from two /proc/stat samples 1 s apart, MemAvailable, PSI, and the cgroup's
 * OOM counters. Read-only; never signals or alters any process.
 */
function linuxEnvSnapshot() {
  const out = {
    platform: 'linux',
    at: new Date().toISOString(),
    load: os.loadavg().map(r1),
    cpus: os.cpus().length,
  }
  const a = procStatCpu()
  execFileSync('sleep', ['1'])
  const b = procStatCpu()
  if (a && b && b.total > a.total)
    out.cpu = { idle: r1(((b.idle - a.idle) * 100) / (b.total - a.total)) }
  const mem = readText('/proc/meminfo') ?? ''
  const kb = key => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(mem)?.[1] ?? NaN)
  out.memMB = {
    total: Math.round(kb('MemTotal') / 1024),
    available: Math.round(kb('MemAvailable') / 1024),
    swapFree: Math.round(kb('SwapFree') / 1024),
  }
  out.psi = { cpu: psi('cpu'), memory: psi('memory'), io: psi('io') }
  const events = cgroupFile('memory.events')
  out.oom = events
    ? Object.fromEntries(
        [...events.matchAll(/^(oom|oom_kill)\s+(\d+)/gm)].map(m => [m[1], Number(m[2])]),
      )
    : null
  return out
}

/**
 * Gate for a Linux runner (agreed separately from the macOS one, which does
 * not carry over): load1 <= load1Max, CPU idle >= idleMin, MemAvailable >=
 * memMinMB, PSI memory `some avg10` <= psiMemMax, and no OOM kill since
 * `oomBase` (the counters at the start of the run).
 */
function linuxGateOk(env, gate) {
  const reasons = []
  if (env.load[0] > gate.load1Max) reasons.push(`load1 ${env.load[0]} > ${gate.load1Max}`)
  if (!env.cpu) reasons.push('cpu idle unknown (/proc/stat)')
  else if (env.cpu.idle < gate.idleMin) reasons.push(`cpu idle ${env.cpu.idle}% < ${gate.idleMin}%`)
  if (!(env.memMB.available >= gate.memMinMB))
    reasons.push(`MemAvailable ${env.memMB.available} MB < ${gate.memMinMB} MB`)
  const memSome = env.psi.memory?.some
  if (memSome === undefined) reasons.push('PSI memory unknown')
  else if (memSome > gate.psiMemMax)
    reasons.push(`PSI memory some avg10 ${memSome} > ${gate.psiMemMax}`)
  if (env.oom && gate.oomBase && env.oom.oom_kill > gate.oomBase.oom_kill)
    reasons.push(`oom_kill ${gate.oomBase.oom_kill} -> ${env.oom.oom_kill} since run start`)
  return { ok: reasons.length === 0, reasons }
}

export function gateOk(env, gate) {
  if (env.platform === 'linux') return linuxGateOk(env, gate)
  const reasons = []
  if (env.load[0] > gate.load1Max) reasons.push(`load1 ${env.load[0]} > ${gate.load1Max}`)
  if (env.cpu && env.cpu.idle < gate.idleMin)
    reasons.push(`cpu idle ${env.cpu.idle}% < ${gate.idleMin}%`)
  if (!env.cpu) reasons.push('cpu idle unknown (top failed)')
  if (env.pressureLevel !== 1)
    reasons.push(`memory pressure level ${env.pressureLevel ?? 'unknown'} (need 1 = normal)`)
  return { ok: reasons.length === 0, reasons }
}

/** Wait (bounded) for the gate; returns the last snapshot + verdict. */
export async function waitForGate(gate, waitS, log = () => {}) {
  const deadline = Date.now() + waitS * 1000
  for (;;) {
    const env = envSnapshot()
    const verdict = gateOk(env, gate)
    if (verdict.ok || Date.now() >= deadline) return { env, ...verdict }
    log(`gate: ${verdict.reasons.join('; ')} — waiting`)
    await sleep(15_000)
  }
}

// ---------------------------------------------------------------- server

const ANSI = /\x1b\[[0-9;]*m/g // oxlint-disable-line no-control-regex -- strip terminal colors

/**
 * Start `vite dev` for the fixture of `repo`. HOME is isolated (devframe keeps
 * its trusted tokens in `$HOME/.svelte-devtools`), and constant per checkout
 * so one authorization survives server restarts within a paired run.
 */
export async function startServer({ appDir, port, withDevtools, home, inspect = false }) {
  const viteBin = path.join(appDir, '../../node_modules/vite/bin/vite.js')
  fs.mkdirSync(home, { recursive: true })
  const t0 = performance.now()
  // `inspect`: the dev server's own V8 profiler is driven per window through
  // the inspector (connectInspector), so cold load and steady-state collector
  // work are profiled separately (`--cpu-prof` could only cover the whole life).
  const nodeArgs = inspect ? ['--inspect=127.0.0.1:0'] : []
  const child = spawn(
    process.execPath,
    [...nodeArgs, viteBin, 'dev', '--port', String(port), '--strictPort'],
    {
      cwd: appDir,
      env: {
        ...process.env,
        HOME: home,
        PERF_DEVTOOLS: withDevtools ? '1' : '0',
        PERF_LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let log = ''
  child.stdout.on('data', d => (log += d))
  child.stderr.on('data', d => (log += d))
  // The inspector URL carries a per-process UUID: keep it out of any message.
  const clean = () => log.replace(ANSI, '').replace(/ws:\/\/\S+/g, 'ws://<redacted>')
  const base = `http://localhost:${port}`
  for (let i = 0; i < 1800; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited early:\n${clean()}`)
    try {
      const res = await fetch(`${base}/bench`)
      if (res.ok) {
        await res.text()
        return {
          child,
          pid: child.pid,
          base,
          coldMs: performance.now() - t0,
          log: clean,
          inspectorUrl: () => /Debugger listening on (ws:\/\/\S+)/.exec(log)?.[1] ?? null,
        }
      }
    } catch {
      /* not listening yet */
    }
    await sleep(100)
  }
  await stopServer({ child })
  throw new Error(`vite did not become ready:\n${clean()}`)
}

/**
 * Minimal client for the dev server's Node inspector (global WebSocket,
 * Node >= 22). Same `send(method, params)` shape as a CDP session, so the
 * profiler helpers drive both.
 */
export async function connectInspector(srv) {
  let url = null
  for (let i = 0; i < 100 && !url; i++) {
    url = srv.inspectorUrl()
    if (!url) await sleep(100)
  }
  if (!url) throw new Error('dev server inspector URL not found')
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('dev server inspector connection failed'))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => {
    const m = JSON.parse(String(e.data))
    const p = m.id && pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error.message))
    else p.resolve(m.result)
  }
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    close: () => ws.close(),
  }
}

/** Stops only the child we spawned (graceful, then forced). */
export async function stopServer(srv) {
  if (!srv?.child || srv.child.exitCode !== null) return
  srv.child.kill('SIGTERM')
  for (let i = 0; i < 100 && srv.child.exitCode === null; i++) await sleep(100)
  if (srv.child.exitCode === null) srv.child.kill('SIGKILL')
}

/** Newest 6-digit devframe auth code printed after `fromIndex` of the log. */
export function lastAuthCode(log, fromIndex = 0) {
  const tail = log.slice(fromIndex)
  const codes = [...tail.matchAll(/auth code\s+(\d{6})/g)].map(m => m[1])
  const links = [...tail.matchAll(/devframe_otp=(\d{6})/g)].map(m => m[1])
  return codes.at(-1) ?? links.at(-1) ?? null
}

// ---------------------------------------------------------------- page helpers

/**
 * Open (or reuse) the DevTools tab of this checkout in its own, persistent
 * context. A devframe one-time code is consumed at most once per context and
 * run: the trusted token then lives in this context's localStorage and in the
 * server's isolated HOME, so later server restarts re-trust silently.
 */
export async function openDevtoolsTab(side, srv, opts) {
  const page = await side.uiCtx.newPage()
  const cdp = await side.uiCtx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const ws = await wsAccounting(cdp)
  await page.goto(`${srv.base}${opts.devtoolsPath}`, { waitUntil: 'load' })
  const dialog = page.getByRole('dialog', { name: /authorize/i })
  const deadline = Date.now() + 60_000
  for (;;) {
    if ((await dialog.count()) > 0 && (await dialog.isVisible())) {
      if (side.authCount >= 1) {
        // The token was lost (should not happen within one run): record it,
        // but never consume codes in another context.
        side.notes.push('second authorization requested in the same context')
      }
      let code = null
      for (let i = 0; i < 300 && !code; i++) {
        // newest code in the whole log: devframe may have printed it before
        // this tab asked (it prints each code once)
        code = lastAuthCode(srv.log())
        if (!code) await sleep(100)
      }
      if (!code)
        throw new Error('devframe auth dialog shown but no code appeared in the server log')
      await page.getByLabel('One-time code').fill(code)
      await page.getByRole('button', { name: /^connect$/i }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 30_000 })
      side.authCount++
      break
    }
    // Connected without a gate (baseline UI, or already trusted).
    const ready = await page
      .evaluate(
        () => !document.querySelector('[role="dialog"]') && !!document.querySelector('nav, aside'),
      )
      .catch(() => false)
    if (ready) break
    if (Date.now() > deadline) {
      side.notes.push('DevTools tab readiness not detected within 60 s; measured anyway')
      break
    }
    await sleep(200)
  }
  return { page, cdp, ws }
}

/**
 * App input -> paint: `reps` real clicks (CDP input) on `selector`, 250 ms
 * apart. Reports Event Timing durations (only entries >= 16 ms
 * exist) and the click -> next frame proxy for every click.
 */
export async function inputToPaint(page, selector, reps) {
  await page.evaluate(() => {
    window.__perf.events.length = 0
    window.__perf.inputToFrame.length = 0
  })
  const btn = page.locator(selector)
  for (let i = 0; i < reps; i++) {
    await btn.click()
    await sleep(250)
  }
  const { events, frames } = await page.evaluate(() => ({
    events: window.__perf.events.filter(e => e.name === 'click'),
    frames: window.__perf.inputToFrame.slice(),
  }))
  return {
    clicks: reps,
    clickToFrameMs: { median: r1(median(frames)), max: r1(Math.max(...frames)), n: frames.length },
    eventTiming: {
      over16ms: events.length,
      medianMs: events.length ? r1(median(events.map(e => e.dur))) : null,
      maxMs: events.length ? r1(Math.max(...events.map(e => e.dur))) : null,
    },
  }
}

export const INIT_SCRIPT = `
(() => {
  window.__perf = { longTasks: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // Input -> paint. Event Timing reports only events >= 16 ms (duration is
  // input -> next paint, 8 ms granularity); inputToFrame is every click's
  // timeStamp -> the task after the next animation frame (an upper-bound
  // proxy for "painted", recorded for all clicks).
  window.__perf.events = [];
  window.__perf.inputToFrame = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        if (e.name === 'click' || e.name === 'pointerup' || e.name === 'input' || e.name === 'keydown')
          window.__perf.events.push({ name: e.name, start: e.startTime, dur: e.duration });
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {}
  addEventListener('click', (e) => {
    const ts = e.timeStamp;
    requestAnimationFrame(() => setTimeout(() => window.__perf.inputToFrame.push(performance.now() - ts), 0));
  }, true);
})();
`

export async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map(m => [m.name, m.value]))
}

export async function heapAfterGc(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return usedSize
}

/**
 * WebSocket frame accounting through CDP. `snapshot()` returns cumulative
 * { sent: {frames, bytes}, received: {frames, bytes} } per socket URL path.
 */
export async function wsAccounting(cdp) {
  await cdp.send('Network.enable')
  const urls = new Map()
  const totals = new Map()
  const bucket = id => {
    const key = urls.get(id) ?? 'unknown'
    if (!totals.has(key)) {
      totals.set(key, { sent: { frames: 0, bytes: 0 }, received: { frames: 0, bytes: 0 } })
    }
    return totals.get(key)
  }
  cdp.on('Network.webSocketCreated', e => {
    try {
      const u = new URL(e.url)
      urls.set(e.requestId, u.pathname + (u.search.includes('token') ? '' : u.search))
    } catch {
      urls.set(e.requestId, e.url)
    }
  })
  // Frames sent by the page, tallied by HMR custom-event name (counts only;
  // diagnostic, not a compared metric).
  const sentByEvent = new Map()
  cdp.on('Network.webSocketFrameSent', e => {
    const b = bucket(e.requestId).sent
    const data = e.response?.payloadData ?? ''
    b.frames++
    b.bytes += data.length
    const m =
      /"event":"([^"]{1,80})"/.exec(data.slice(0, 300)) ??
      /"type":"([^"]{1,40})"/.exec(data.slice(0, 100))
    const key = `${urls.get(e.requestId) ?? 'unknown'} ${m ? m[1] : '?'}`
    const t = sentByEvent.get(key) ?? { frames: 0, bytes: 0 }
    t.frames++
    t.bytes += data.length
    sentByEvent.set(key, t)
  })
  cdp.on('Network.webSocketFrameReceived', e => {
    const b = bucket(e.requestId).received
    b.frames++
    b.bytes += e.response?.payloadData?.length ?? 0
  })
  return {
    snapshot: () => structuredClone(Object.fromEntries(totals)),
    sentByEvent: () => Object.fromEntries(sentByEvent),
  }
}

/** Difference of two wsAccounting snapshots, summed over sockets. */
export function wsDelta(before, after) {
  const sum = { sent: { frames: 0, bytes: 0 }, received: { frames: 0, bytes: 0 } }
  for (const [key, a] of Object.entries(after)) {
    const b = before[key] ?? { sent: { frames: 0, bytes: 0 }, received: { frames: 0, bytes: 0 } }
    for (const dir of ['sent', 'received']) {
      sum[dir].frames += a[dir].frames - b[dir].frames
      sum[dir].bytes += a[dir].bytes - b[dir].bytes
    }
  }
  return sum
}

/** CPU/main-thread cost over a quiet window (+ WS traffic if accounted). */
export async function idleWindow(page, cdp, ms, ws) {
  const before = await cdpMetrics(cdp)
  const wsBefore = ws?.snapshot()
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
    busyPct: r1(((after.TaskDuration - before.TaskDuration) * 1000 * 100) / ms),
    longTasks: longTasks.length,
    longTaskMs: r1(longTasks.reduce((s, t) => s + t.dur, 0)),
    maxLongTaskMs: r1(longTasks.reduce((m, t) => Math.max(m, t.dur), 0)),
    ws: ws ? wsDelta(wsBefore, ws.snapshot()) : undefined,
  }
}

export function frameStats(durations) {
  const d = durations.slice(1)
  return {
    frames: d.length,
    p50: r1(pct(d, 50)),
    p95: r1(pct(d, 95)),
    max: r1(Math.max(...d)),
    over50ms: d.filter(x => x > 50).length,
  }
}

/** Runtime-internal sizes and subscription state of the app page. */
export async function runtimeState(page) {
  return page.evaluate(() => {
    const key = Object.keys(window).find(k => k.startsWith('__SVELTE_') && k.endsWith('DEVTOOLS__'))
    const dt = key ? window[key] : null
    if (!dt) return null
    const size = x =>
      x && typeof x.size === 'number' ? x.size : Array.isArray(x) ? x.length : null
    return {
      // `_active` exists only in runtimes with the §6.3 subscription
      active: typeof dt._active === 'boolean' ? dt._active : 'n/a (always on)',
      epoch: dt._epoch ?? null,
      instances: size(dt._instances),
      reactiveNodes: size(dt._reactiveNodes),
      profiles: size(dt._profiles),
      timeline: size(dt._stateTimeline),
      stateSnapshots: size(dt._stateSnapshots),
      sampling: dt._sampling ? true : dt._sampling === null ? false : 'n/a',
    }
  })
}

/**
 * Breakdown of what the runtime tracks, so a mismatch with the fixture's
 * ground truth can be explained (review M6): reactive nodes by meta.type
 * (proxies are type 'state' and also in `_reactiveProxies`), and instances /
 * nodes per component file (basename). Read-only.
 */
export async function runtimeBreakdown(page) {
  return page.evaluate(() => {
    const key = Object.keys(window).find(k => k.startsWith('__SVELTE_') && k.endsWith('DEVTOOLS__'))
    const dt = key ? window[key] : null
    if (!dt) return null
    const base = f =>
      String(f ?? '?')
        .split('/')
        .pop()
    const inc = (o, k) => (o[k] = (o[k] ?? 0) + 1)
    const nodesByType = {}
    const nodesByFile = {}
    for (const e of dt._reactiveNodes?.values?.() ?? []) {
      inc(nodesByType, e.meta?.type ?? '?')
      inc(nodesByFile, `${base(e.meta?.componentFile)} ${e.meta?.type ?? '?'}`)
    }
    const instancesByFile = {}
    for (const c of dt._instances?.values?.() ?? []) inc(instancesByFile, base(c.file))
    return {
      nodesByType,
      proxies: dt._reactiveProxies?.size ?? null,
      nodesByFile,
      instancesByFile,
    }
  })
}
