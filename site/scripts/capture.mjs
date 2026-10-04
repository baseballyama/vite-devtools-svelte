#!/usr/bin/env node
// Screenshots + QA of the docs site for the redesign review, run in CI with
// the one headless Chromium the other jobs already install.
//
//   node site/scripts/capture.mjs --out=<dir> [--build=site/build]
//        [--before=https://baseballyama.github.io/vite-devtools-svelte]
//        [--reference=https://vite.dev]
//
// Prerequisites: `pnpm install --frozen-lockfile`, the site built for its
// production base (`pnpm --filter site build`), and
// `pnpm exec playwright-core install --with-deps chromium`.
//
// Output in <dir>:
//   after/<page>-<width>-<theme>.png (+ -full.png)   the built site
//   before/<page>-<width>.png (+ -full.png)          the live site (optional)
//   reference/home-<width>.png (+ -full.png)          vite.dev (optional)
//   qa.json        per page / width / theme: broken internal links and
//                  anchors, horizontal overflow, low-contrast text, focus
//                  visibility for the first Tab stops, running animations
//                  with reduced motion, copy buttons, privacy hits
//   manifest.json  commit, runner, URLs, what was captured, failures
// Exit 0 only when every QA check on the built site passed. The live site and
// the reference are captured best effort (network) and never fail the run.
//
// Privacy: the built pages are static docs, but their text and image alt
// texts are still scanned for machine paths, tokens and one-time codes; a
// page with a hit gets no screenshot and fails.
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const outDir = path.resolve(
  arg('out', '') || (console.error('usage: --out=<dir>'), process.exit(64)),
)
const buildDir = path.resolve(repoRoot, arg('build', 'site/build'))
const beforeUrl = arg('before', 'https://baseballyama.github.io/vite-devtools-svelte')
const referenceUrl = arg('reference', 'https://vite.dev')
const BASE = '/vite-devtools-svelte'
const PAGES = [
  { id: 'home', path: '/' },
  { id: 'getting-started', path: '/getting-started' },
  { id: 'mcp', path: '/mcp' },
  { id: 'mcp-ja', path: '/ja/mcp' },
  { id: 'panel-reactive', path: '/panels/reactive' },
]
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
]
const CAP_MS = 300_000
setTimeout(() => {
  console.log('CAP reached — stopping (counts as failure)')
  try {
    manifest.capped = true
    failures++
    writeResults()
  } catch {
    /* results are best effort here */
  }
  process.exit(2)
}, CAP_MS).unref()

if (!existsSync(path.join(buildDir, 'index.html'))) {
  console.error(`no built site at ${path.relative(repoRoot, buildDir)} — run the site build first`)
  process.exit(1)
}

// ------------------------------------------------- static server (base path)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
}
/** The file a request maps to, as the static host (GitHub Pages) resolves it. */
function resolveFile(urlPath) {
  if (!urlPath.startsWith(BASE)) return null
  let rel = decodeURIComponent(urlPath.slice(BASE.length)) || '/'
  if (rel.includes('..')) return null
  const candidates = rel.endsWith('/')
    ? [rel + 'index.html']
    : [rel, rel + '.html', rel + '/index.html']
  for (const c of candidates) {
    const f = path.join(buildDir, c)
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}
const server = createServer((req, res) => {
  const file = resolveFile(new URL(req.url, 'http://x').pathname)
  if (!file) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ------------------------------------------------------------------ browser
const pwMod = await import(
  pathToFileURL(createRequire(path.join(repoRoot, 'package.json')).resolve('playwright-core')).href
)
const pw = pwMod.chromium ? pwMod : pwMod.default
const browser = await pw.chromium.launch({ headless: true })

const SENSITIVE = [
  /\/Users\//,
  /\/home\//,
  /\/private\//,
  /[A-Z]:\\Users\\/,
  /devframe_otp/i,
  /x-svelte-devtools-token:\s*[0-9a-f]{8}/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
]
const git = (...a) => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...a], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
const manifest = {
  commit: git('rev-parse', 'HEAD'),
  siteTree: git('rev-parse', 'HEAD:site'),
  runner: `${process.platform} ${process.arch}, Node ${process.version}`,
  after: `site build served at ${BASE}`,
  before: beforeUrl,
  reference: referenceUrl,
  shots: [],
  notes: [],
}
const qa = []
let failures = 0
/** Error text for the manifest, with machine paths and secrets replaced. */
function scrub(text) {
  let t = String(text).split(repoRoot).join('<repo>')
  for (const re of SENSITIVE)
    t = t.replace(
      new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
      '<redacted>',
    )
  return t
}
function writeResults() {
  mkdirSync(outDir, { recursive: true })
  manifest.failures = failures
  writeFileSync(path.join(outDir, 'qa.json'), JSON.stringify(qa, null, 2) + '\n')
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

async function newPage({ w, h }, theme, reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: theme ?? 'dark',
    reducedMotion,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  // The site stores an explicit theme choice; start every context from the
  // colour scheme instead.
  await ctx.addInitScript(() => {
    try {
      localStorage.removeItem('theme')
    } catch {}
  })
  return { ctx, page: await ctx.newPage() }
}

async function shoot(page, dir, name) {
  mkdirSync(path.join(outDir, dir), { recursive: true })
  await page.evaluate(() => {
    document.activeElement?.blur?.()
    document.documentElement.style.scrollBehavior = 'auto'
    window.scrollTo(0, 0)
  })
  await page.screenshot({ path: path.join(outDir, dir, `${name}.png`) })
  await page.screenshot({ path: path.join(outDir, dir, `${name}-full.png`), fullPage: true })
  manifest.shots.push(`${dir}/${name}.png`)
}

/** QA checks that run inside the page; returns plain data. */
const inPageChecks = () => {
  const parse = c => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = 1] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number)
    return { r, g, b, a }
  }
  const lum = ({ r, g, b }) => {
    const f = v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const bgOf = el => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor)
      if (c && c.a >= 0.95) return c
      if (getComputedStyle(e).backgroundImage !== 'none') return null // gradient/image: skip
    }
    return parse(getComputedStyle(document.body).backgroundColor)
  }
  const lowContrast = []
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.data.trim())
    if (!own || !el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue
    const cs = getComputedStyle(el)
    const fg = parse(cs.color)
    const bg = bgOf(el)
    if (!fg || !bg || fg.a < 0.95) continue
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a)
    const ratio = (l1 + 0.05) / (l2 + 0.05)
    const size = parseFloat(cs.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
    if (ratio < (large ? 3 : 4.5))
      lowContrast.push({
        text: el.textContent.trim().slice(0, 40),
        ratio: Math.round(ratio * 100) / 100,
        tag: el.tagName.toLowerCase(),
      })
  }
  const anchors = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
  return {
    overflowX: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    // The outermost elements that stick out past the viewport, for fixing.
    overflowing: [...document.querySelectorAll('body *')]
      .filter(e => {
        const r = e.getBoundingClientRect()
        if (r.width === 0 || r.right <= window.innerWidth + 1) return false
        const p = e.parentElement?.getBoundingClientRect()
        return !p || p.right <= window.innerWidth + 1
      })
      .slice(0, 8)
      .map(
        e =>
          `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} right=${Math.round(e.getBoundingClientRect().right)}`,
      ),
    lowContrast: lowContrast.slice(0, 20),
    lowContrastCount: lowContrast.length,
    anchors,
    ids: [...document.querySelectorAll('[id]')].map(e => e.id),
    imagesWithoutAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
    // Code that is cut off: wider than its box without a scroll container of its own.
    clipped: [...document.querySelectorAll('code, pre, kbd, input')]
      .filter(e => {
        if (!e.checkVisibility?.() || e.clientWidth === 0) return false
        if (e.scrollWidth <= e.clientWidth + 1) return false
        const ox = getComputedStyle(e).overflowX
        if (ox === 'auto' || ox === 'scroll') return false
        const pre = e.closest('pre')
        return !(pre && pre !== e && ['auto', 'scroll'].includes(getComputedStyle(pre).overflowX))
      })
      .slice(0, 8)
      .map(e => `${e.tagName.toLowerCase()}: ${e.textContent.trim().slice(0, 40)}`),
    text: document.body.innerText + '\n' + [...document.images].map(i => i.alt).join('\n'),
    h1: document.querySelectorAll('h1').length,
  }
}

async function focusCheck(page, stops = 12) {
  const out = []
  await page.keyboard.press('Tab') // from the document start
  for (let i = 0; i < stops; i++) {
    out.push(
      await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return { tag: 'body', visible: false }
        const cs = getComputedStyle(el)
        const ring =
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
          (cs.boxShadow && cs.boxShadow !== 'none')
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
          visible: !!ring,
        }
      }),
    )
    await page.keyboard.press('Tab')
  }
  return out
}

const pagesByPath = new Map()
try {
  // ------------------------------------------------------------ after (built)
  for (const p of PAGES)
    for (const size of WIDTHS)
      for (const theme of ['dark', 'light']) {
        const { ctx, page } = await newPage(size, theme)
        const url = origin + BASE + (p.path === '/' ? '/' : p.path)
        // Broken assets and errors: same-origin responses >= 400, console
        // errors and uncaught page errors.
        const badResponses = []
        const errors = []
        page.on('response', resp => {
          if (resp.url().startsWith(origin) && resp.status() >= 400)
            badResponses.push(`${resp.status()} ${resp.url().slice(origin.length)}`)
        })
        page.on('requestfailed', req => {
          if (req.url().startsWith(origin))
            badResponses.push(`failed ${req.url().slice(origin.length)}`)
        })
        page.on('console', m => m.type() === 'error' && errors.push(scrub(m.text()).slice(0, 160)))
        page.on('pageerror', e => errors.push(scrub(e.message).slice(0, 160)))
        const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
        await page.evaluate(() => document.fonts.ready)
        // Scroll through the page so lazy images load, then wait for them.
        await page.evaluate(async () => {
          document.documentElement.style.scrollBehavior = 'auto'
          for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
            window.scrollTo(0, y)
            await new Promise(r => setTimeout(r, 60))
          }
          const settled = i =>
            new Promise(r => {
              i.addEventListener('load', r, { once: true })
              i.addEventListener('error', r, { once: true })
            })
          await Promise.race([
            Promise.all([...document.images].filter(i => !i.complete).map(settled)),
            new Promise(r => setTimeout(r, 10_000)),
          ])
          window.scrollTo(0, 0)
        })
        const brokenImages = await page.evaluate(() =>
          [...document.images]
            .filter(
              i => getComputedStyle(i).display !== 'none' && i.complete && i.naturalWidth === 0,
            )
            .map(i => i.getAttribute('src')),
        )
        // Icons the head points at must exist too.
        const icons = await page.evaluate(() =>
          [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
            l => l.href,
          ),
        )
        for (const href of icons) {
          const u = new URL(href)
          if (u.origin === origin && !resolveFile(u.pathname))
            badResponses.push(`missing icon ${u.pathname}`)
        }
        const r = { page: p.id, width: size.w, theme, status: res?.status() ?? null, problems: [] }
        if (badResponses.length)
          r.problems.push(`broken assets: ${[...new Set(badResponses)].join(', ')}`)
        if (brokenImages.length)
          r.problems.push(`images that did not load: ${brokenImages.join(', ')}`)
        const c = await page.evaluate(inPageChecks)
        pagesByPath.set(p.path, c.ids)
        const privacy = SENSITIVE.filter(re => re.test(c.text)).map(String)
        if (privacy.length) r.problems.push(`privacy: ${privacy.length} pattern hit(s)`)
        if (r.status !== 200) r.problems.push(`HTTP ${r.status}`)
        if (c.overflowX) r.problems.push('horizontal overflow')
        if (c.lowContrastCount)
          r.problems.push(`${c.lowContrastCount} low-contrast text element(s)`)
        if (c.imagesWithoutAlt) r.problems.push(`${c.imagesWithoutAlt} image(s) without alt`)
        if (c.clipped.length) r.problems.push(`clipped code: ${c.clipped.join(' | ')}`)
        if (c.h1 !== 1) r.problems.push(`${c.h1} h1 element(s)`)
        r.lowContrast = c.lowContrast
        r.overflowing = c.overflowing
        r.anchors = c.anchors
        // Screenshots first, before Tab / copy move focus or scroll the page.
        if (!privacy.length) await shoot(page, 'after', `${p.id}-${size.w}-${theme}`)
        if (size.w === 1440) {
          r.focus = await focusCheck(page)
          if (r.focus.some(f => f.tag !== 'body' && !f.visible))
            r.problems.push('a focused element without a visible focus style')
        }
        if (theme === 'dark' && size.w === 1440) {
          const copy = page.getByRole('button', { name: /copy/i }).first()
          if (await copy.count()) {
            await copy.click()
            const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
            r.copy = clip ? `copied ${clip.length} chars` : 'nothing copied'
            if (!clip) r.problems.push('copy button copied nothing')
          }
        }
        if (errors.length) r.problems.push(`console/page errors: ${errors.slice(0, 5).join(' | ')}`)
        failures += r.problems.length
        qa.push(r)
        await ctx.close()
      }

  // Reduced motion: no animation may keep running.
  for (const p of PAGES) {
    const { ctx, page } = await newPage(WIDTHS[0], 'dark', 'reduce')
    await page.goto(origin + BASE + (p.path === '/' ? '/' : p.path), { waitUntil: 'load' })
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            a =>
              a.playState === 'running' &&
              (a.effect?.getComputedTiming().duration ?? 0) > 10 &&
              a.effect?.getComputedTiming().iterations === Infinity,
          ).length,
    )
    const r = { page: p.id, check: 'reduced-motion', running, problems: [] }
    if (running) r.problems.push(`${running} infinite animation(s) with reduced motion`)
    failures += r.problems.length
    qa.push(r)
    await ctx.close()
  }

  // Internal links and anchors over everything the built pages link to.
  const linkProblems = []
  const seen = new Set()
  for (const r of qa.filter(x => x.anchors))
    for (const href of r.anchors) {
      if (seen.has(href) || /^(https?:|mailto:)/.test(href)) continue
      seen.add(href)
      const pagePath = PAGES.find(p => p.id === r.page).path
      const u = new URL(href, origin + BASE + (pagePath === '/' ? '/' : pagePath))
      if (!resolveFile(u.pathname)) linkProblems.push(`${r.page}: ${href} → missing page`)
      else if (u.hash) {
        const target = u.pathname.slice(BASE.length) || '/'
        const ids = pagesByPath.get(target)
        if (ids && !ids.includes(decodeURIComponent(u.hash.slice(1))))
          linkProblems.push(`${r.page}: ${href} → missing anchor`)
      }
    }
  qa.push({ check: 'internal-links', checked: seen.size, problems: linkProblems })
  failures += linkProblems.length
  for (const r of qa) delete r.anchors

  // ----------------------------------------- before (live) and reference: best effort
  for (const [dir, baseUrl, pages] of [
    ['before', beforeUrl, PAGES],
    ['reference', referenceUrl, [{ id: 'home', path: '/' }]],
  ]) {
    if (!baseUrl) continue
    for (const p of pages)
      for (const size of WIDTHS) {
        const { ctx, page } = await newPage(size, 'dark')
        try {
          // 'load' plus a short settle: third-party pages may never go network-idle.
          await page.goto(baseUrl + (p.path === '/' ? '/' : p.path), {
            waitUntil: 'load',
            timeout: 20_000,
          })
          await page.waitForTimeout(1500)
          await shoot(page, dir, `${p.id}-${size.w}`)
        } catch (e) {
          manifest.notes.push(
            scrub(`${dir} ${p.id} ${size.w}: ${String(e?.message ?? e).slice(0, 120)}`),
          )
        }
        await ctx.close()
      }
  }
} finally {
  writeResults()
  await browser.close()
  server.close()
}
console.log(`site QA: ${failures} problem(s); ${manifest.shots.length} screenshot(s)`)
process.exit(failures ? 1 : 0)
