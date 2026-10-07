#!/usr/bin/env node
// Reactivity end-to-end check through MCP, on a real SvelteKit dev server.
//
//   pnpm build && node scripts/reactivity-e2e.mjs [--port=5290] [--headed]
//
// Drives playground/src/routes/lab (one page with the patterns the runtime
// has to follow: module/class state, context, props, bind:, {#each} with
// {@const}, snippets, {#key}, {#await}, <svelte:boundary>, $app/state,
// SvelteMap) with Playwright and checks what the MCP tools report: the
// component tree, the reactive graph (edges, markup readers, module scopes,
// orphans, isolated nodes), the state timeline after interactions, and the
// tree after an HMR edit. Exit 0 when every check passes, 1 otherwise.
//
// The dev server runs in its own process group and is killed on exit; the
// HMR edit is undone in finally.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(repoRoot, 'playground')
const argv = process.argv.slice(2)
const port = Number(argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5290)
const headed = argv.includes('--headed')
const base = `http://127.0.0.1:${port}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ------------------------------------------------------------------ ledger
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  )
}

// ------------------------------------------------------------------ dev server
const child = spawn(
  process.execPath,
  [
    path.join(appDir, 'node_modules/vite/bin/vite.js'),
    '--port',
    String(port),
    '--strictPort',
    '--host',
    '127.0.0.1',
  ],
  { cwd: appDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
)
let log = ''
child.stdout.on('data', d => (log += d))
child.stderr.on('data', d => (log += d))
const stopServer = () => {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {}
}
const hmrFile = path.join(appDir, 'src/lib/lab/Row.svelte')
const hmrOriginal = fs.readFileSync(hmrFile, 'utf8')
const restore = () => {
  if (fs.readFileSync(hmrFile, 'utf8') !== hmrOriginal) fs.writeFileSync(hmrFile, hmrOriginal)
}
process.on('exit', () => {
  restore()
  stopServer()
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

// ------------------------------------------------------------------ MCP
let token
let rpcId = 0
async function tool(name, args = {}) {
  const r = await fetch(`${base}/__svelte-devtools/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'x-svelte-devtools-token': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await r.text()
  const raw = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find(l => l.startsWith('data:'))
        ?.slice(5)
  const msg = JSON.parse(raw)
  if (msg.error) throw new Error(`${name}: ${msg.error.message}`)
  const out = msg.result.content?.find(c => c.type === 'text')?.text ?? 'null'
  if (msg.result.isError) throw new Error(`${name}: ${out.slice(0, 300)}`)
  try {
    return JSON.parse(out)
  } catch {
    return out
  }
}

async function until(fn, ok, ms = 8000) {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn()
    if (ok(last)) return last
    await sleep(250)
  }
  return last
}

// ------------------------------------------------------------------ helpers
const file = c => c.file ?? c.componentFile ?? ''
const isFile = suffix => c => file(c).endsWith(suffix)
const edgesOf = g => new Set(g.edges.map(e => `${e.from} -> ${e.to}`))
const byName = (g, name, suffix) =>
  g.nodes.find(n => n.name === name && (!suffix || file(n).endsWith(suffix)))

async function snapshot() {
  const live = await tool('get_live_components', { includeMeta: true })
  const graph = await tool('get_reactive_scope', {})
  return { live, graph, comps: live.components }
}

function checkTree(label, comps) {
  const ids = new Set(comps.map(c => c.id))
  const orphans = comps.filter(c => c.parentId !== null && !ids.has(c.parentId))
  check(`${label}: every parent is a live component`, orphans.length === 0, orphans)
  check(
    `${label}: one root`,
    comps.filter(c => c.parentId === null).length === 1,
    comps.filter(c => c.parentId === null),
  )
}

// ------------------------------------------------------------------ run
let browser
try {
  for (let i = 0; i < 200 && !/x-svelte-devtools-token:/.test(log); i++) await sleep(150)
  token = log.match(/x-svelte-devtools-token:([0-9a-f-]{36})/)?.[1]
  if (!token) throw new Error(`dev server did not start:\n${log.slice(-2000)}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  page.on('console', m => m.type() === 'error' && pageErrors.push(m.text()))
  await page.goto(`${base}/lab`)
  await page.waitForFunction(
    () => document.querySelector('h1')?.textContent?.includes('items'),
    null,
    { timeout: 60_000 },
  )
  await sleep(500)
  // the first MCP call leases the runtime (activation + full snapshot)
  await until(
    () => tool('get_live_components', { includeMeta: true }),
    l => l.components?.some(isFile('lab/+page.svelte')),
    10_000,
  )

  // ---------------------------------------------------------------- tree
  let { comps, graph: g } = await snapshot()
  checkTree('initial', comps)
  const labPage = comps.find(isFile('routes/lab/+page.svelte'))
  const labLayout = comps.find(isFile('routes/lab/+layout.svelte'))
  check(
    'lab page under the lab layout',
    labPage && labLayout && labPage.parentId === labLayout.id,
    { labPage, labLayout },
  )
  const rows = comps.filter(isFile('lib/lab/Row.svelte'))
  const panels = comps.filter(isFile('lib/lab/Panel.svelte'))
  check(
    'two rows, both children of the page',
    rows.length === 2 && rows.every(r => r.parentId === labPage.id),
    rows,
  )
  check(
    'two panels ({#if} + {#key}), children of the page',
    panels.length === 2 && panels.every(p => p.parentId === labPage.id),
    panels,
  )

  // ---------------------------------------------------------------- graph
  const E = edgesOf(g)
  const P = n => `${labPage.id}:${n}`
  const items = byName(g, 'Inventory.items', 'lab/store.svelte.ts')
  const total = byName(g, 'Inventory.total', 'lab/store.svelte.ts')
  const prefs = byName(g, 'prefs', 'lab/store.svelte.ts')
  check(
    'module state is tracked (Inventory.items/total, prefs)',
    items && total && prefs,
    g.nodes.map(n => n.id),
  )
  check('Inventory.items -> Inventory.total', items && total && E.has(`${items.id} -> ${total.id}`))
  check('Inventory.items -> page visible', items && E.has(`${items.id} -> ${P('visible')}`))
  check(
    'visible -> count / pieces (destructured $derived)',
    E.has(`${P('visible')} -> ${P('count')}`) && E.has(`${P('visible')} -> ${P('pieces')}`),
  )
  check(
    'count / pieces -> summary ($derived.by)',
    E.has(`${P('count')} -> ${P('summary')}`) && E.has(`${P('pieces')} -> ${P('summary')}`),
  )
  check(
    'summary -> markup and -> $effect.pre',
    E.has(`${P('summary')} -> ${P('(template)')}`) &&
      E.has(`${P('summary')} -> ${P('effect_pre_1')}`),
  )
  check('pieces -> $effect', E.has(`${P('pieces')} -> ${P('effect_1')}`))
  check(
    'module prefs and Inventory.total -> page markup',
    prefs &&
      E.has(`${prefs.id} -> ${P('(template)')}`) &&
      E.has(`${total.id} -> ${P('(template)')}`),
  )
  check(
    'query -> markup (bind:value) and -> visible',
    E.has(`${P('query')} -> ${P('(template)')}`) && E.has(`${P('query')} -> ${P('visible')}`),
  )
  const pathNode = g.nodes.find(n => n.id === P('path'))
  check('path ($app/state) reports untracked dependencies', pathNode?.untrackedDeps > 0, pathNode)
  for (const row of rows) {
    const label = `${row.id}:label`
    check(
      `row ${row.id}: label <- Inventory.items (prop of a module proxy)`,
      items && E.has(`${items.id} -> ${label}`),
      [...E].filter(e => e.endsWith(label)),
    )
    check(
      `row ${row.id}: editing -> its markup`,
      E.has(`${row.id}:editing -> ${row.id}:(template)`),
    )
  }
  const labCtx = `${labLayout.id}:lab`
  for (const panel of panels) {
    check(
      `panel ${panel.id}: greeting <- layout context state`,
      E.has(`${labCtx} -> ${panel.id}:greeting`),
      [...E].filter(e => e.includes(`${panel.id}:`)),
    )
  }

  const problems = await tool('get_reactive_graph_problems', {})
  const orphanNames = problems.orphanDeriveds.filter(d => file(d).includes('/lab')).map(d => d.name)
  check(
    'orphan deriveds of the lab: only unusedOnPurpose',
    JSON.stringify(orphanNames) === '["unusedOnPurpose"]',
    problems.orphanDeriveds,
  )
  check('no isolated nodes', problems.isolatedNodes.length === 0, problems.isolatedNodes)
  const issues = await tool('list_performance_issues', {})
  check(
    'no derived-orphan performance issue',
    !issues.issues.some(i => i.kind === 'derived-orphan'),
    issues.issues,
  )

  // scoped views
  const scope = await tool('get_reactive_scope', {
    componentId: labPage.id,
    epoch: (await tool('get_live_components', { includeMeta: true })).epoch,
  })
  const SE = edgesOf(scope)
  check(
    'scoped page graph keeps the module edges',
    items && SE.has(`${items.id} -> ${P('visible')}`),
  )
  // the page's snippet <span>{count} visible</span> is rendered by the {#if}
  // Panel: its markup effect belongs to the Panel, reading the page's count
  const countReaders = [...E].filter(
    e => e.startsWith(`${P('count')} -> `) && e.endsWith(':(template)'),
  )
  check(
    'page snippet rendered by a child reads count (global)',
    countReaders.some(e => panels.some(p => e.endsWith(`${p.id}:(template)`))),
    countReaders,
  )
  check(
    'scoped page graph shows that reader in the child',
    countReaders.every(e => SE.has(e)),
    { countReaders, scoped: [...SE].filter(e => e.includes(':count')) },
  )

  // ---------------------------------------------------------------- timeline
  const timeline = await tool('get_state_timeline', {})
  let cursor = timeline.cursor
  async function changesAfter(action, expectNames) {
    await action()
    const found = await until(
      async () => {
        const t = await tool('get_state_timeline', { since: cursor })
        return t
      },
      t => expectNames.every(n => t.changes?.some(c => c.name === n)),
      6000,
    )
    if (found?.cursor) cursor = found.cursor
    return (found?.changes ?? []).map(c => c.name)
  }
  const step = async (label, action, names) => {
    const got = await changesAfter(action, names)
    check(
      `timeline: ${label} -> ${names.join(', ')}`,
      names.every(n => got.includes(n)),
      got,
    )
  }
  await step('type a filter', () => page.fill('[data-testid=query]', 'al'), ['query'])
  await step('add an item (class field array push)', () => page.click('[data-testid=add]'), [
    'Inventory.items',
  ])
  await step('toggle module prefs', () => page.click('[data-testid=compact]'), ['prefs'])
  await step('switch the context user', () => page.click('[data-testid=user]'), ['lab'])
  await step('toggle the {#key} tab', () => page.click('[data-testid=tab]'), ['tab'])
  await step('hide the panel', () => page.click('[data-testid=panel]'), ['showPanel'])
  await page.fill('[data-testid=query]', '')
  await step('bind:qty from a row', () => page.click('[data-testid=inc] >> nth=0'), [
    'Inventory.items',
  ])

  ;({ comps } = await snapshot())
  checkTree('after interactions', comps)
  check(
    'three rows after add + clearing the filter',
    comps.filter(isFile('lib/lab/Row.svelte')).length === 3,
  )
  check(
    'one panel after hiding the {#if} one',
    comps.filter(isFile('lib/lab/Panel.svelte')).length === 1,
  )

  // ---------------------------------------------------------------- HMR
  const before = comps.filter(isFile('lib/lab/Row.svelte')).map(r => r.id)
  const epochBefore = (await tool('get_live_components', { includeMeta: true })).epoch
  fs.writeFileSync(
    hmrFile,
    hmrOriginal.replace(
      '<button onclick={() => (editing = !editing)}>edit</button>',
      '<button onclick={() => (editing = !editing)}>edit!</button>',
    ),
  )
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => b.textContent === 'edit!'),
    null,
    { timeout: 15_000 },
  )
  await sleep(800)
  ;({ comps, graph: g } = await snapshot())
  const epochAfter = (await tool('get_live_components', { includeMeta: true })).epoch
  checkTree('after HMR of Row.svelte', comps)
  const after = comps.filter(isFile('lib/lab/Row.svelte'))
  check('HMR: the page was not reloaded', epochAfter === epochBefore, { epochBefore, epochAfter })
  check(
    'HMR: same number of rows, all re-created (no ghosts)',
    after.length === before.length && !after.some(r => before.includes(r.id)),
    { before, after: after.map(r => r.id) },
  )
  // the graph may come from the collector's cache (up to 1 s, see
  // get_reactive_scope): judge an answer computed after the HMR update
  const hmrAt = Date.now()
  g = await until(
    () => tool('get_reactive_scope', {}),
    r => (r.computedAt ?? 0) > hmrAt,
    5000,
  )
  const ghostNodes = g.nodes.filter(
    n => !comps.some(c => c.id === n.componentId) && !file(n).endsWith('.svelte.ts'),
  )
  check(
    'HMR: every graph node belongs to a live component or module',
    ghostNodes.length === 0,
    ghostNodes.map(n => n.id),
  )
  restore()
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => b.textContent === 'edit'),
    null,
    { timeout: 15_000 },
  )

  // ---------------------------------------------------------------- boundary
  // (after HMR: once an init failed inside <svelte:boundary>, the next HMR
  // update is a full page reload — also without this plugin)
  await page.click('[data-testid=fail]')
  await page.waitForSelector('[data-testid=failed]', { timeout: 5000 })
  ;({ comps } = await snapshot())
  checkTree('after a failing init inside <svelte:boundary>', comps)
  check('the failed component left no instance', !comps.some(isFile('lib/lab/Broken.svelte')))
  await page.click('[data-testid=add]')
  await sleep(500)
  ;({ comps } = await snapshot())
  const page2 = comps.find(isFile('routes/lab/+page.svelte'))
  check(
    'rows added after the failure are children of the page',
    comps.filter(isFile('lib/lab/Row.svelte')).every(r => r.parentId === page2?.id),
  )

  // ---------------------------------------------------------------- errors
  const unexpected = pageErrors.filter(e => !e.includes('fails on purpose'))
  check('no unexpected page errors', unexpected.length === 0, unexpected)
  const serverErrors = log
    .split('\n')
    .filter(l => /\b(error|Error)\b/.test(l) && !l.includes('fails on purpose'))
  check('no server errors', serverErrors.length === 0, serverErrors.slice(0, 10))
} catch (e) {
  check('run completed', false, e.stack)
} finally {
  await browser?.close()
  restore()
  stopServer()
}

const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
