#!/usr/bin/env node
// Proves the plugin is a no-op for production: builds a small generated
// SvelteKit app with the plugin enabled and asserts that no devtools runtime,
// wrapper, client inject or load-profiling code reaches the build output.
// Positive control: the same markers must be present when the dev server
// serves the app, otherwise the check would pass vacuously.
//
// Usage: node perf/check-prod-noop.mjs [--repo=<checkout>]

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePlaygroundSync, generate } from './generate-large-app.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoArg = process.argv.find(a => a.startsWith('--repo='))
const repo = repoArg ? path.resolve(repoArg.slice(7)) : repoRoot
const appDir = path.join(repo, 'playground/.temp/noop-app')
const viteBin = path.join(repo, 'playground/node_modules/vite/bin/vite.js')

// Strings that only exist in code emitted by vite-devtools-svelte.
const MARKERS = [
  '__SVELTE_DEVTOOLS__',
  'svelte-devtools:',
  'virtual:svelte-devtools',
  '__svelte_devtools_record_load',
  '@vitejs/devtools/client/inject',
  // hub inject used by the SvelteKit template injector since fp 63
  '/__devtools/embedded.js',
  '__devtools',
]

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, ...args], {
      cwd: appDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout.on('data', d => (log += d))
    child.stderr.on('data', d => (log += d))
    child.on('exit', code =>
      code === 0 ? resolve(log) : reject(new Error(`vite ${args[0]} exited ${code}\n${log}`)),
    )
  })
}

function scan(dir) {
  const hits = []
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(m?js|html|css|json)$/.test(ent.name)) {
        const text = fs.readFileSync(p, 'utf8')
        for (const m of MARKERS)
          if (text.includes(m)) hits.push({ file: path.relative(appDir, p), marker: m })
      }
    }
  }
  walk(dir)
  return hits
}

async function devMarkers() {
  const port = 5395
  const child = spawn(process.execPath, [viteBin, 'dev', '--port', String(port), '--strictPort'], {
    cwd: appDir,
    stdio: 'ignore',
  })
  try {
    const base = `http://localhost:${port}`
    let html = ''
    for (let i = 0; i < 600 && !html; i++) {
      try {
        const res = await fetch(`${base}/`)
        if (res.ok) html = await res.text()
      } catch {
        await new Promise(r => setTimeout(r, 100))
      }
    }
    // The wrapper/runtime are pulled in by compiled components on the client.
    const comp = await fetch(`${base}/src/lib/components/gen/C0000.svelte`).then(r => r.text())
    const found = MARKERS.filter(m => html.includes(m) || comp.includes(m))
    return found
  } finally {
    child.kill('SIGTERM')
  }
}

// Fixture hygiene: any marker in the *generated sources* would make a prod
// hit ambiguous (fixture vs. plugin leak). Fail separately (exit 3) so the
// production scan below can only be explained by plugin-emitted code.
// Known trap: concatenations like '__SVELTE_' + 'DEVTOOLS__' are folded back
// into the marker by the minifier — this check covers literals, the fixture
// code avoids foldable forms (see generate-large-app.mjs).
function fixtureHits() {
  const hits = []
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(svelte|[cm]?[jt]s|html)$/.test(ent.name)) {
        const text = fs.readFileSync(p, 'utf8')
        for (const m of MARKERS)
          if (text.includes(m)) hits.push({ file: path.relative(appDir, p), marker: m })
        if (/['"`]__SVELTE_['"`]\s*\+/.test(text))
          hits.push({ file: path.relative(appDir, p), marker: 'foldable concat' })
      }
    }
  }
  walk(path.join(appDir, 'src'))
  return hits
}

async function main() {
  ensurePlaygroundSync(repo)
  generate({ components: 20, routes: 20, assets: 10, out: appDir })
  const dirty = fixtureHits()
  if (dirty.length > 0) {
    console.error(
      'FAIL: fixture sources contain devtools markers (fixture bug, not a plugin leak):',
    )
    console.error(JSON.stringify(dirty, null, 2))
    process.exit(3)
  }
  const t0 = performance.now()
  await run(['build', '--logLevel', 'warn'])
  const buildMs = Math.round(performance.now() - t0)
  const outDirs = ['.svelte-kit/output']
    .map(d => path.join(appDir, d))
    .filter(d => fs.existsSync(d))
  if (outDirs.length === 0) throw new Error('no build output found')
  const hits = outDirs.flatMap(scan)
  const control = await devMarkers()
  const result = {
    buildMs,
    outDirs: outDirs.map(d => path.relative(appDir, d)),
    prodHits: hits,
    devControlMarkers: control,
  }
  console.log(JSON.stringify(result, null, 2))
  if (control.length === 0) {
    console.error('FAIL: positive control found no markers in dev — check is vacuous')
    process.exit(2)
  }
  if (hits.length > 0) {
    console.error(`FAIL: ${hits.length} devtools marker(s) in production output`)
    process.exit(1)
  }
  console.log('PASS: production build contains no devtools code')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
