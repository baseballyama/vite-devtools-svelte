#!/usr/bin/env node
// Browser-level cases for the prompt toolbar, on the example app (SvelteKit,
// server-rendered and hydrated) with the toolbar switched on through the
// environment.
//
//   node e2e/prompt-toolbar.mjs
//
// Cases:
//   1 A pick is swallowed: while picking, clicking a link neither navigates nor
//     reaches the app's own listeners; Escape stops picking and the same click
//     navigates again.
//   2 Locations and owners on hydrated pages: every element the app renders
//     reports the line and column where its tag is written (checked against
//     the file on disk) and the component that rendered it.
//   3 The copied prompt: root-relative locations, the component chain and the
//     MCP handle for the picked instance, no machine path.
//   4 Base path: with `paths.base: '/app'` the toolbar loads under the base
//     and picks work there.
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
    const marker = log.indexOf('x-svelte-devtools-token:')
    if (marker !== -1) secrets.add(log.slice(marker + 24, marker + 60))
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
let failed = 0

function check(name, ok, detail) {
  if (!ok) failed++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + mask(String(detail)).slice(0, 300) : ''}`,
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
  page.on('response', r => r.status() >= 400 && errors.push(`${r.status()} ${mask(r.url())}`))
  return { page, errors }
}

/** The toolbar is mounted and the app hydrated (instances registered). */
async function ready(page) {
  await page.waitForFunction(
    selector => Boolean(document.querySelector(selector)?.shadowRoot?.querySelector('.inspect')),
    TOOLBAR,
    { timeout: 30_000 },
  )
  await page.waitForFunction(
    () => (window.__SVELTE_DEVTOOLS__?.getTree?.().length ?? 0) > 0,
    undefined,
    {
      timeout: 30_000,
    },
  )
}

const toolbar = page => page.locator(TOOLBAR)
const picked = page => toolbar(page).locator('li')
const picking = async page =>
  (await toolbar(page).locator('button.inspect').getAttribute('aria-pressed')) === 'true'

/** Text of a line (1-based) of an app file; Svelte names files relative to the root. */
function sourceLine(file, line) {
  try {
    return readFileSync(path.resolve(appDir, file), 'utf8').split('\n')[line - 1] ?? ''
  } catch {
    return ''
  }
}

// -------------------------------------------------------------------- case 1
{
  const app = await startApp('vite.standalone.config.ts')
  const { page, errors } = await newPage(app.base)
  await page.goto(app.base + '/', { waitUntil: 'load', timeout: 30_000 })
  await ready(page)
  // What the app would see of a pick.
  await page.evaluate(() => {
    window.__seen = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      document.addEventListener(type, event => {
        if (!event.composedPath().some(node => node.id === '__svelte-devtools-prompt'))
          window.__seen.push(type)
      })
  })

  await toolbar(page).locator('button.inspect').click()
  check('picking starts', await picking(page))
  await page.locator('.hero a.cta').click()
  await page.waitForTimeout(500)
  check('a pick does not navigate', new URL(page.url()).pathname === '/', page.url())
  check(
    'a pick does not reach the app',
    (await page.evaluate(() => window.__seen)).length === 0,
    JSON.stringify(await page.evaluate(() => window.__seen)),
  )
  check('the pick is listed', (await picked(page).count()) === 1)
  check('picking continues for further picks', await picking(page))
  await page.locator('.hero h1').click()
  check('a second pick is listed', (await picked(page).count()) === 2)
  await page.locator('.hero h1').click()
  check('picking an element again removes it', (await picked(page).count()) === 1)

  await page.keyboard.press('Escape')
  check('Escape stops picking', !(await picking(page)))
  await page.locator('.hero a.cta').click()
  await page.waitForURL('**/products', { timeout: 15_000 })
  check('the same click navigates once picking stops', new URL(page.url()).pathname === '/products')
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

// -------------------------------------------------------------------- case 2
{
  const app = await startApp('vite.standalone.config.ts')
  const { page, errors } = await newPage(app.base)
  for (const route of ['/', '/products', '/products/p-001', '/cart', '/dashboard']) {
    // A full load each time: the page is server-rendered, then hydrated.
    await page.goto(app.base + route, { waitUntil: 'load', timeout: 30_000 })
    await ready(page)
    await page.waitForTimeout(300)
    const rows = await page.evaluate(() => {
      const out = []
      // The app's own markup: everything under SvelteKit's root element.
      // (SvelteKit's own `<script>` that starts the app sits there too.)
      for (const element of document.body.firstElementChild.querySelectorAll('*:not(script)')) {
        const payload = window.__SVELTE_DEVTOOLS__.inspectElement(element)
        out.push({
          tag: element.localName,
          source: payload.source,
          owner: payload.components[0]?.name ?? null,
        })
      }
      return out
    })
    const bad = []
    for (const row of rows) {
      const { source } = row
      if (!source || source.enclosing || !row.owner) {
        bad.push(`${row.tag}: ${JSON.stringify(source)} owner=${row.owner}`)
        continue
      }
      const file = source.file
      const text = sourceLine(file, source.line).slice(source.column)
      if (!text.startsWith('<' + row.tag))
        bad.push(`${row.tag} at ${file}:${source.line}:${source.column}`)
    }
    check(
      `${route}: all ${rows.length} elements located at their own tag, with an owner`,
      rows.length > 10 && bad.length === 0,
      bad.slice(0, 4).join(' | '),
    )
  }
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

// -------------------------------------------------------------------- case 3
{
  const app = await startApp('vite.standalone.config.ts')
  const { page, errors } = await newPage(app.base)
  await page.goto(app.base + '/', { waitUntil: 'load', timeout: 30_000 })
  await ready(page)
  await toolbar(page).locator('button.inspect').click()
  await page.locator('canvas').click()
  await page.keyboard.press('Escape')
  await toolbar(page).locator('textarea').fill('Make the particles slower.')
  await toolbar(page).locator('button.primary').click()
  await page.waitForTimeout(300)
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  const expected = await page.evaluate(() => {
    const payload = window.__SVELTE_DEVTOOLS__.inspectElement(document.querySelector('canvas'))
    return { id: payload.components[0].id, epoch: payload.epoch, line: payload.source.line }
  })
  check('the request is in the prompt', prompt.includes('## Request\n\nMake the particles slower.'))
  check(
    'the location is root-relative',
    prompt.includes('- location: `src/lib/components/FpsCanvas.svelte:' + expected.line + ':'),
    prompt,
  )
  check(
    'the component chain is named',
    prompt.includes('`FpsCanvas` (`src/lib/components/FpsCanvas.svelte`) › `+page`'),
  )
  check(
    'the live-state handle names the picked instance',
    prompt.includes(JSON.stringify({ componentId: expected.id, epoch: expected.epoch })),
  )
  check('no machine path', !prompt.includes(repoRoot))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

// -------------------------------------------------------------------- case 4
{
  const app = await startApp('vite.base-path.config.ts')
  const origin = new URL(app.base).origin
  const { page, errors } = await newPage(origin)
  await page.goto(app.base + '/app/', { waitUntil: 'load', timeout: 30_000 })
  await ready(page)
  check('the toolbar loads under the base', true)
  await toolbar(page).locator('button.inspect').click()
  await page.locator('.hero a.cta').click()
  await page.waitForTimeout(300)
  check('a pick works under the base', (await picked(page).count()) === 1)
  check(
    'it does not navigate',
    new URL(page.url()).pathname === '/app/' || new URL(page.url()).pathname === '/app',
  )
  const where = await picked(page).first().locator('.where').textContent()
  check(
    'the location is root-relative',
    where?.startsWith('src/routes/+page.svelte:') === true,
    where,
  )
  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.stop()
}

clearTimeout(cap)
console.log(failed === 0 ? 'OK' : `FAILED (${failed})`)
await finish(failed === 0 ? 0 : 1)
