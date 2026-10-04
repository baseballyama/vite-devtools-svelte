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

export function gateOk(env, gate) {
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
export async function startServer({ appDir, port, withDevtools, home }) {
  const viteBin = path.join(appDir, '../../node_modules/vite/bin/vite.js')
  fs.mkdirSync(home, { recursive: true })
  const t0 = performance.now()
  const child = spawn(process.execPath, [viteBin, 'dev', '--port', String(port), '--strictPort'], {
    cwd: appDir,
    env: {
      ...process.env,
      HOME: home,
      PERF_DEVTOOLS: withDevtools ? '1' : '0',
      PERF_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => (log += d))
  child.stderr.on('data', d => (log += d))
  const base = `http://localhost:${port}`
  for (let i = 0; i < 1800; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited early:\n${log.replace(ANSI, '')}`)
    try {
      const res = await fetch(`${base}/bench`)
      if (res.ok) {
        await res.text()
        return {
          child,
          pid: child.pid,
          base,
          coldMs: performance.now() - t0,
          log: () => log.replace(ANSI, ''),
        }
      }
    } catch {
      /* not listening yet */
    }
    await sleep(100)
  }
  await stopServer({ child })
  throw new Error(`vite did not become ready:\n${log.replace(ANSI, '')}`)
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

export const INIT_SCRIPT = `
(() => {
  window.__perf = { longTasks: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
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
