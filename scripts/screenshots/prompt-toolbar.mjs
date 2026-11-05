#!/usr/bin/env node
// Real screenshots of the prompt toolbar for the README / PR, taken in CI
// (Linux, headless) on the synthetic example app `examples/sample-app`
// (SvelteKit 2, `vite.standalone.config.ts`, the workspace plugin build) with
// `promptToolbar: true` switched on through the environment.
//
//   node scripts/screenshots/prompt-toolbar.mjs --out=<dir>
//
// Prerequisites (same as the compat job): `pnpm install --frozen-lockfile`,
// `pnpm build`, `pnpm exec playwright-core install --with-deps chromium`.
//
// Cases: the toolbar with two picked elements and the panel open, in dark and
// in light (`prefers-color-scheme`):
//   prompt-toolbar-dark.png
//   prompt-toolbar-light.png
//
// Safety: isolated HOME, free port on 127.0.0.1, no devtools auth gate is
// touched (this captures the app, not the panels). Before every screenshot the
// visible page text — shadow tree included — is scanned for machine paths and
// tokens; on a hit NO image is written and the case fails. Hard cap 180 s; the
// dev server (process group), the browser and the HOME are always cleaned up.
//
// Output: <dir>/*.png + <dir>/prompt-toolbar-manifest.json (no machine paths).
// Exit 0 only when every case produced a clean image.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const outArg = process.argv.find(arg => arg.startsWith('--out='))
if (!outArg) {
  console.error('usage: node scripts/screenshots/prompt-toolbar.mjs --out=<dir>')
  process.exit(64)
}
const outDir = path.resolve(outArg.slice('--out='.length))
const appDir = path.join(repoRoot, 'examples/sample-app')
const CAP_MS = 180_000
const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms)
  })

// The app page in the screenshot: two elements in its hero, so the marks, the
// chips and the prompt all have something to show.
const PICKS = ['.hero h1', '.hero a.cta']
const INSTRUCTIONS = 'Make the call to action more prominent and keep the title as is.'

const secrets = new Set()
function mask(text) {
  let out = String(text)
  for (const secret of secrets) if (secret) out = out.split(secret).join('<secret>')
  return out.split(repoRoot).join('<repo>')
}

const cleanup = []
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
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// ---------------------------------------------------------------- dev server
const home = mkdtempSync(path.join(os.tmpdir(), 'sdt-toolbar-shots-home-'))
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
      SVELTE_DEVTOOLS_PROMPT_TOOLBAR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  },
)
let log = ''
child.stdout.on('data', data => {
  log += data
})
child.stderr.on('data', data => {
  log += data
})
cleanup.push(async () => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const kill = signal => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal)
      else child.kill(signal)
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
    const response = await fetch(base + '/', { signal: AbortSignal.timeout(5000) })
    if (response.status < 500) break
  } catch {
    /* not yet */
  }
  await sleep(200)
}

// ------------------------------------------------------------------ browser
// playwright-core is CJS: some Node versions expose only default.chromium.
const pwModule = await import(
  pathToFileURL(createRequire(path.join(repoRoot, 'package.json')).resolve('playwright-core')).href
)
const pw = pwModule.chromium ? pwModule : pwModule.default
const browser = await pw.chromium.launch({ headless: true })
cleanup.push(() => browser.close())
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
})
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(mask(e.message).slice(0, 200)))
page.on('console', m => m.type() === 'error' && errors.push(mask(m.text()).slice(0, 200)))

await page.goto(base + '/', { waitUntil: 'load', timeout: 30_000 })
await page.waitForFunction(
  () => {
    const host = document.querySelector('#__svelte-devtools-prompt')
    return Boolean(host && host.shadowRoot?.querySelector('.fab'))
  },
  undefined,
  { timeout: 30_000 },
)

// ---------------------------------------------------------------- helpers
const TOOLBAR = '#__svelte-devtools-prompt'

/** Centre of a toolbar control (it lives in a shadow root). */
const toolbarBox = toolSelector =>
  page.evaluate(
    ({ hostSelector, selector }) => {
      const root = document.querySelector(hostSelector)?.shadowRoot
      const element = root?.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    },
    { hostSelector: TOOLBAR, selector: toolSelector },
  )

/** Centre of an element of the app page. */
const pageBox = appSelector =>
  page.evaluate(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, appSelector)

const toolbarState = () =>
  page.evaluate(hostSelector => {
    const host = document.querySelector(hostSelector)
    const root = host?.shadowRoot
    return {
      picking: host?.dataset.picking === 'true',
      panelOpen: root ? !root.querySelector('.panel').hidden : false,
      chips: root ? root.querySelectorAll('.chip').length : 0,
      marks: root ? root.querySelectorAll('.mark').length : 0,
    }
  }, TOOLBAR)

const clickAt = async point => {
  if (!point) throw new Error('target not found')
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(250)
}

/** The whole visible text, shadow trees included (for the privacy scan). */
const visibleText = () =>
  page.evaluate(() => {
    const parts = [document.body.innerText]
    for (const host of document.querySelectorAll('*')) {
      const root = host.shadowRoot
      if (root) parts.push(root.textContent ?? '')
    }
    return parts.join('\n')
  })

const homes = [os.homedir(), home]
  .filter(Boolean)
  .map(homePath => homePath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const SENSITIVE = [
  /\/Users\//,
  /\/home\//,
  /\/private\//,
  /[A-Z]:\\Users\\/,
  /\btoken\b/i,
  ...homes.map(homePath => new RegExp(homePath)),
]

mkdirSync(outDir, { recursive: true })
const git = (...args) =>
  execFileSync('git', ['-C', repoRoot, ...args])
    .toString()
    .trim()
const manifest = {
  app: 'examples/sample-app (SvelteKit 2, vite.standalone.config.ts, promptToolbar: true) — synthetic demo app, real runtime',
  commit: git('rev-parse', 'HEAD'),
  runner: `${process.platform} ${process.arch}, Node ${process.version}`,
  viewport: '1440x900 @2x',
  picks: PICKS,
  shots: [],
}
let failed = 0

async function shot(file, theme, caption) {
  await page.waitForTimeout(400)
  const text = await visibleText()
  const hits = SENSITIVE.filter(pattern => pattern.test(text)).length
  if (hits > 0) {
    failed++
    manifest.shots.push({
      file: null,
      theme,
      caption,
      result: `NOT SAVED: ${hits} sensitive pattern hit(s) in the page text`,
    })
    console.log(`${theme}: NOT SAVED (sensitive text)`)
    return
  }
  await page.screenshot({ path: path.join(outDir, file) })
  manifest.shots.push({ file, theme, caption, result: 'saved' })
  console.log(`${theme}: saved ${file}`)
}

// ---------------------------------------------------------------- the cases
// Pick two elements, write a request, and leave the toolbar showing them.
await clickAt(await toolbarBox('.fab'))
for (const selector of PICKS) await clickAt(await pageBox(selector))
await page.evaluate(
  ({ hostSelector, instructions }) => {
    const root = document.querySelector(hostSelector)?.shadowRoot
    const area = root?.querySelector('textarea')
    if (!area) return
    area.value = instructions
    area.dispatchEvent(new Event('input', { bubbles: true }))
  },
  { hostSelector: TOOLBAR, instructions: INSTRUCTIONS },
)
// Stop picking (the button keeps the panel open) so no hover box is captured.
const state = await toolbarState()
if (!state.picking || !state.panelOpen || state.marks !== PICKS.length) {
  throw new Error(`unexpected toolbar state: ${JSON.stringify(state)}`)
}
await clickAt(await toolbarBox('.fab'))
await page.mouse.move(4, 4)
await page.waitForTimeout(300)
if ((await toolbarState()).picking) throw new Error('still picking after the second click')

await shot(
  'prompt-toolbar-dark.png',
  'dark',
  'The prompt toolbar in dark mode: two picked elements keep their numbered outlines, the panel lists them with their source location and holds the request that goes into the prompt.',
)

await page.emulateMedia({ colorScheme: 'light' })
await page.waitForTimeout(500)
await shot(
  'prompt-toolbar-light.png',
  'light',
  'The same toolbar in light mode (`prefers-color-scheme: light`): same outlines, same panel, light palette.',
)

if (errors.length > 0) {
  failed++
  console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`)
}

writeFileSync(
  path.join(outDir, 'prompt-toolbar-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
clearTimeout(cap)
console.log(failed === 0 ? 'OK' : `FAILED (${failed})`)
await finish(failed === 0 ? 0 : 1)
