#!/usr/bin/env node
// Browser-level cases for the prompt toolbar, on the synthetic example app
// (SvelteKit 2) with the toolbar switched on through the environment.
//
//   node e2e/prompt-toolbar.mjs
//
// Cases:
//   1 A pick is swallowed: clicking a link while picking does not navigate, and
//     the same click does navigate once picking stops.
//   2 Location honesty on a hydrated page: the line reported for a picked
//     element is the element's own line (checked against the file on disk), and
//     when Svelte only recorded an ancestor the report says so (`~`) instead of
//     inventing a line.
//   3 Base path: with `paths.base: '/app'` the toolbar loads from the base and
//     its source window is read through `/app/@fs` (the copied prompt contains
//     the source), with repository-relative paths and no machine path.
//
// Prerequisites (same as the compat job): `pnpm install --frozen-lockfile`,
// `pnpm build`, `pnpm exec playwright-core install --with-deps chromium`.
//
// Safety: isolated HOME, free port on 127.0.0.1, nothing is written to the repo,
// the dev servers (process groups), the browser and the HOME are always cleaned
// up, and a failure prints masked text only. Hard cap 180 s.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..')
const appDir = path.join(repoRoot, 'examples/sample-app')
const CAP_MS = 180_000
const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms)
  })

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
process.on('unhandledRejection', error => {
  console.log(`FAILED: ${mask(error?.message ?? error)}`)
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

/** One dev server for the example app, with the prompt toolbar enabled. */
async function startApp(configFile) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'sdt-toolbar-e2e-home-'))
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
      configFile,
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
  return {
    base,
    async stop() {
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
      rmSync(home, { recursive: true, force: true })
    },
  }
}

// ------------------------------------------------------------------ browser
const pwModule = await import(
  pathToFileURL(createRequire(path.join(repoRoot, 'package.json')).resolve('playwright-core')).href
)
const pw = pwModule.chromium ? pwModule : pwModule.default
const browser = await pw.chromium.launch({ headless: true })
cleanup.push(() => browser.close())

const TOOLBAR = '#__svelte-devtools-prompt'
const results = []
let failed = 0

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + mask(String(detail)).slice(0, 200) : ''}`,
  )
}

/** A fresh page in a context that may read the clipboard. */
async function newPage(origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  cleanup.push(() => context.close())
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(mask(error.message).slice(0, 200)))
  page.on('console', m => m.type() === 'error' && errors.push(mask(m.text()).slice(0, 200)))
  return { page, errors }
}

const center = (page, selector, inShadow = false) =>
  page.evaluate(
    ({ hostSelector, selector: target, inShadow: shadow }) => {
      const host = document.querySelector(hostSelector)
      const scope = shadow ? host?.shadowRoot : document
      const element = scope?.querySelector(target)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    },
    { hostSelector: TOOLBAR, selector, inShadow },
  )

const click = async (page, selector, inShadow = false) => {
  const point = await center(page, selector, inShadow)
  if (!point) throw new Error(`not found: ${selector}`)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(300)
}

const toolbarState = page =>
  page.evaluate(hostSelector => {
    const host = document.querySelector(hostSelector)
    const root = host?.shadowRoot
    return {
      picking: host?.dataset.picking === 'true',
      fab: Boolean(root?.querySelector('.fab')),
      chips: root ? root.querySelectorAll('.chip').length : 0,
      chipLocation: root?.querySelector('.chip .where')?.textContent ?? null,
      chipName: root?.querySelector('.chip .name')?.textContent ?? null,
    }
  }, TOOLBAR)

/**
 * The toolbar script and the hydrated app: the runtime tree is only populated
 * once the client has mounted, which is also when Svelte assigns the element
 * metadata the toolbar reads.
 */
const waitForToolbar = async page => {
  await page.waitForFunction(
    hostSelector => {
      const host = document.querySelector(hostSelector)
      return Boolean(host?.shadowRoot?.querySelector('.fab'))
    },
    TOOLBAR,
    { timeout: 30_000 },
  )
  await page.waitForFunction(
    () => (window.__SVELTE_DEVTOOLS__?.getTree?.().length ?? 0) > 0,
    undefined,
    { timeout: 30_000 },
  )
}

const setInstructions = (page, instructions) =>
  page.evaluate(
    ({ hostSelector, instructions: text }) => {
      const root = document.querySelector(hostSelector)?.shadowRoot
      const area = root?.querySelector('textarea')
      if (!area) return false
      area.value = text
      area.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    { hostSelector: TOOLBAR, instructions },
  )

/** The line number a chip shows (`~src/App.svelte:13[:4]`). */
function lineOf(chipLocation) {
  const match = /:(\d+)(?::\d+)?$/.exec(chipLocation ?? '')
  return match ? Number(match[1]) : 0
}

/** The element's own line in its file, looked up on disk by a distinctive attribute. */
function lineInFile(relativePath, needle) {
  const text = readFileSync(path.join(appDir, relativePath), 'utf8')
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex(line => line.includes(needle))
  return index === -1 ? null : index + 1
}

// -------------------------------------------------------------------- case 1
// A pick must not reach the app: no navigation while picking, and the same
// click navigates once picking stops.
{
  const app = await startApp('vite.standalone.config.ts')
  const { page, errors } = await newPage(app.base)
  await page.goto(app.base + '/', { waitUntil: 'load', timeout: 30_000 })
  await waitForToolbar(page)

  await click(page, '.fab', true)
  check('picking starts', (await toolbarState(page)).picking)
  const link = await center(page, '.hero a.cta')
  await page.mouse.click(link.x, link.y)
  await page.waitForTimeout(600)
  const afterPick = await toolbarState(page)
  check('a pick does not navigate', new URL(page.url()).pathname === '/', page.url())
  check('the pick is recorded', afterPick.chips === 1, JSON.stringify(afterPick))
  check(
    'picking keeps running so a second element can be added',
    afterPick.picking,
    JSON.stringify(afterPick),
  )

  // leave picking: the next click belongs to the app again
  const fab = await center(page, '.fab', true)
  await page.mouse.click(fab.x, fab.y)
  await page.waitForTimeout(200)
  check('picking stops', !(await toolbarState(page)).picking)
  await page.mouse.click(link.x, link.y)
  await page.waitForURL('**/products', { timeout: 15_000 })
  check('the same click navigates once picking stops', new URL(page.url()).pathname === '/products')
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

// -------------------------------------------------------------------- case 2
// Location honesty: the reported line is the element's own line, verified
// against the file, whether it came from Svelte's metadata or from the matcher.
{
  const app = await startApp('vite.standalone.config.ts')
  const { page, errors } = await newPage(app.base)
  await page.goto(app.base + '/', { waitUntil: 'load', timeout: 30_000 })
  await waitForToolbar(page)
  await click(page, '.fab', true)
  const link = await center(page, '.hero a.cta')
  await page.mouse.click(link.x, link.y)
  await page.waitForTimeout(600)
  const state = await toolbarState(page)

  // What Svelte itself recorded, and what the toolbar decided to report.
  const inspected = await page.evaluate(selector => {
    const element = document.querySelector(selector)
    const payload = window.__SVELTE_DEVTOOLS__?.inspectElement(element)
    return payload ? { source: payload.source, selector: payload.element?.selector } : null
  }, '.hero a.cta')

  const expected = lineInFile('src/routes/+page.svelte', 'class="cta"')
  const reported = lineOf(state.chipLocation)
  check('the file was found on disk', expected !== null, 'class="cta"')
  check(
    'the chip reports the element\u2019s own line',
    reported === expected,
    `reported ${state.chipLocation} (expected ${expected})`,
  )
  if (inspected?.source?.enclosing) {
    check(
      'an inherited location is marked with ~',
      state.chipLocation?.startsWith('~') === true,
      state.chipLocation ?? 'no location',
    )
    check(
      'the inherited line is corrected by the matcher, not used as is',
      reported === expected,
      `reported ${reported}, compiler said ${inspected.source.line}`,
    )
  } else {
    check(
      'Svelte recorded the element itself, so no ~ is shown',
      state.chipLocation?.startsWith('~') !== true,
      state.chipLocation ?? 'no location',
    )
  }
  check('no page errors', errors.length === 0, errors.join(' | '))

  // The fallback path: drop the element's metadata (what hydration can lose),
  // then pick it again — the line must come from the file itself and be marked.
  const clear = await center(page, 'button.ghost', true)
  await page.mouse.click(clear.x, clear.y)
  await page.waitForTimeout(300)
  check('clear empties the form', (await toolbarState(page)).chips === 0)
  await page.evaluate(selector => {
    const element = document.querySelector(selector)
    if (element) delete element.__svelte_meta
  }, '.hero a.cta')
  await page.mouse.click(link.x, link.y)
  await page.waitForTimeout(600)
  const fallback = await toolbarState(page)
  const fallbackLine = lineOf(fallback.chipLocation)
  check(
    'without its own metadata the file still yields the element line',
    fallbackLine === expected,
    `${fallback.chipLocation} (expected ${expected})`,
  )
  check(
    "a line that is not the compiler's is marked with ~",
    fallback.chipLocation?.startsWith('~') === true,
    fallback.chipLocation ?? 'no location',
  )
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

// -------------------------------------------------------------------- case 3
// Base path: the toolbar is served under the base and its source window is read
// through `/app/@fs`, which a bare `/@fs` request would 404.
{
  const app = await startApp('vite.base-path.config.ts')
  const origin = new URL(app.base).origin
  const { page, errors } = await newPage(origin)
  await page.goto(app.base + '/app/', { waitUntil: 'load', timeout: 30_000 })
  await waitForToolbar(page)
  check('the toolbar loads under the base', (await toolbarState(page)).fab)

  await click(page, '.fab', true)
  const link = await center(page, '.hero a.cta')
  await page.mouse.click(link.x, link.y)
  await page.waitForTimeout(700)
  check('a pick works under the base', (await toolbarState(page)).chips === 1)

  await setInstructions(page, 'Base path check.')
  await click(page, 'button.primary', true)
  await page.waitForTimeout(900)
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  check('the prompt carries a source window', prompt.includes('Source of'), prompt.slice(0, 120))
  check(
    'paths are repository-relative',
    prompt.includes('src/routes/+page.svelte:') && !prompt.includes(appDir),
    prompt.split('\n').find(line => line.startsWith('- markup:')) ?? 'no markup line',
  )
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

clearTimeout(cap)
console.log(failed === 0 ? 'OK' : `FAILED (${failed})`)
await finish(failed === 0 ? 0 : 1)
