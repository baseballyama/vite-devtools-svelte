#!/usr/bin/env node
// Reactivity end-to-end check through MCP, on a real SvelteKit dev server.
//
//   pnpm build && node e2e/reactivity.mjs [--port=5290] [--headed]
//
// Drives playground/src/routes/lab, one page with the patterns the runtime
// has to follow, and the Svelte Inspector, which runs in the Vite DevTools
// dock. Exit 0 when every check passes, 1 otherwise.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright-core';

const repoRoot = path.resolve(import.meta.dirname, '..');
const appDir = path.join(repoRoot, 'playground');
const argv = process.argv.slice(2);
const port = Number(argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5290);
const headed = argv.includes('--headed');
const base = `http://127.0.0.1:${port}`;
const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms);
  });

/** The MCP token the dev server wrote to its registry file, once there. */
function registeredToken() {
  try {
    const name = fs.readdirSync(registry).find(n => n.endsWith(`-${port}.json`));
    return name ? JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8')).token : null;
  } catch {
    return null;
  }
}

// The dev server announces its MCP endpoint and token here.
const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-reactivity-registry-'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
}

// launch-editor runs LAUNCH_EDITOR instead of a real editor: it records each
// file it is asked to open
const editorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-devtools-e2e-'));
const editorLog = path.join(editorDir, 'opened');
const editorBin = path.join(editorDir, 'editor.sh');
fs.writeFileSync(editorBin, `#!/bin/sh\necho "$1" >> '${editorLog}'\n`, { mode: 0o755 });
const editorOpened = () => (fs.existsSync(editorLog) ? fs.readFileSync(editorLog, 'utf8') : '');

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
  {
    cwd: appDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LAUNCH_EDITOR: editorBin, VITE_DEVTOOLS_SVELTE_REGISTRY: registry },
  },
);
let log = '';
child.stdout.on('data', d => {
  log += d;
});
child.stderr.on('data', d => {
  log += d;
});
const stopServer = () => {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
};
const hmrFile = path.join(appDir, 'src/lib/lab/Row.svelte');
const hmrOriginal = fs.readFileSync(hmrFile, 'utf8');
const restore = () => {
  if (fs.readFileSync(hmrFile, 'utf8') !== hmrOriginal) fs.writeFileSync(hmrFile, hmrOriginal);
};
process.on('exit', () => {
  restore();
  stopServer();
  fs.rmSync(editorDir, { recursive: true, force: true });
  fs.rmSync(registry, { recursive: true, force: true });
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let token;
let rpcId = 0;
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
  });
  const text = await r.text();
  const raw = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find(l => l.startsWith('data:'))
        ?.slice(5);
  const msg = JSON.parse(raw);
  if (msg.error) throw new Error(`${name}: ${msg.error.message}`);
  const out = msg.result.content?.find(c => c.type === 'text')?.text ?? 'null';
  // oxlint-disable-next-line unicorn/prefer-type-error -- `isError` is the MCP tool-error flag, not a type check
  if (msg.result.isError) throw new Error(`${name}: ${out.slice(0, 300)}`);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

async function until(fn, ok, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (ok(last)) return last;
    await sleep(250);
  }
  return last;
}

const file = c => c.file ?? c.componentFile ?? '';
const isFile = suffix => c => file(c).endsWith(suffix);
const edgesOf = g => new Set(g.edges.map(e => `${e.from} -> ${e.to}`));
const byName = (g, name, suffix) =>
  g.nodes.find(n => n.name === name && (!suffix || file(n).endsWith(suffix)));

async function snapshot() {
  const live = await tool('get_live_components', { includeMeta: true });
  const graph = await tool('get_reactive_scope', {});
  return { live, graph, comps: live.components };
}

// The dock auto-minimizes (buttons get pointer-events: none) unless a
// mousemove reached it within 3 s. A move to the same point fires no event, so
// move across it in steps.
async function nudgeDock(page) {
  const box = await page.locator('#devframes-dock').boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 3, cy, { steps: 5 });
  await page.mouse.move(cx + 3, cy, { steps: 5 });
}

// The dock's logo wrapper takes pointer events over the centre of its buttons
function unobscuredPoint(target) {
  return target
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      const root = el.getRootNode();
      const y = r.height / 2;
      for (const x of [r.width * 0.15, r.width * 0.85, 10, r.width - 10, r.width / 2]) {
        const hit = root.elementFromPoint(r.left + x, r.top + y);
        if (hit && (hit === el || el.contains(hit))) return { x: Math.round(x), y: Math.round(y) };
      }
      return null;
    })
    .catch(() => null);
}

async function clickInDock(page, target) {
  let last;
  for (let i = 0; i < 4; i++) {
    await page.locator('#devframes-dock').waitFor({ state: 'attached', timeout: 20_000 });
    await nudgeDock(page);
    await sleep(600);
    await nudgeDock(page);
    try {
      const position = await unobscuredPoint(target);
      const at = position ? { position } : {};
      await target.hover({ timeout: 2500, ...at });
      await sleep(350);
      await target.click({ timeout: 2500, ...at });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// The hub loads the inspector's dock script only once this browser is
// authorized, with the code the dev server prints
async function authorizeDock(page) {
  await page.locator('devframes-dock-embedded').waitFor({ state: 'attached', timeout: 20_000 });
  const ansi = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'g');
  const from = log.length;
  await clickInDock(page, page.getByRole('button', { name: 'Unauthorized' }));
  let code;
  for (let i = 0; i < 100 && !code; i++) {
    const found = [
      ...log
        .slice(from)
        .replaceAll(ansi, '')
        .matchAll(/(?:auth code\s+|devframe_otp=)(\d{6})/g),
    ];
    code = found.at(-1)?.[1];
    if (!code) await sleep(100);
  }
  if (!code) throw new Error('no dock auth code in the dev server log');
  for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1} of 6`).fill(code[i]);
  await page
    .getByRole('button', { name: 'Unauthorized' })
    .waitFor({ state: 'detached', timeout: 15_000 });
  await page.keyboard.press('Escape');
}

const inspectorOn = page =>
  page.evaluate(() => document.body.classList.contains('svelte-inspector-enabled'));
async function enableInspector(page) {
  await page.mouse.move(5, 5);
  if (await inspectorOn(page)) return;
  await page.keyboard.press('Alt+KeyX');
  await page.waitForFunction(
    () => document.body.classList.contains('svelte-inspector-enabled'),
    null,
    { timeout: 5000 },
  );
}
// Inspect opens the Svelte panel of the dock over the page; Escape closes it
async function closeDockPanel(page) {
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => {
      const r = document.querySelector('[data-testid=add]').getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit?.dataset.testid === 'add';
    },
    null,
    { timeout: 5000 },
  );
}

function checkTree(label, comps) {
  const ids = new Set(comps.map(c => c.id));
  const orphans = comps.filter(c => c.parentId !== null && !ids.has(c.parentId));
  check(`${label}: every parent is a live component`, orphans.length === 0, orphans);
  check(
    `${label}: one root`,
    comps.filter(c => c.parentId === null).length === 1,
    comps.filter(c => c.parentId === null),
  );
}

let browser;
try {
  for (let i = 0; i < 200 && !token; i++) {
    token = registeredToken();
    if (!token) await sleep(150);
  }
  if (!token) throw new Error(`dev server did not start:\n${log.slice(-2000)}`);

  browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => m.type() === 'error' && pageErrors.push(m.text()));
  const picks = [];
  page.on('websocket', ws =>
    ws.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.includes('element-picked')) return;
      const msg = JSON.parse(payload);
      if (msg.event === 'svelte-devtools:element-picked') picks.push(msg.data);
    }),
  );
  await page.goto(`${base}/lab`);
  await page.waitForFunction(
    () => document.querySelector('h1')?.textContent?.includes('items'),
    null,
    { timeout: 60_000 },
  );
  await sleep(500);
  // the first MCP call leases the runtime (activation + full snapshot)
  await until(
    () => tool('get_live_components', { includeMeta: true }),
    l => l.components?.some(isFile('lab/+page.svelte')),
    10_000,
  );

  let { comps, graph: g } = await snapshot();
  checkTree('initial', comps);
  const labPage = comps.find(isFile('routes/lab/+page.svelte'));
  const labLayout = comps.find(isFile('routes/lab/+layout.svelte'));
  check(
    'lab page under the lab layout',
    labPage && labLayout && labPage.parentId === labLayout.id,
    { labPage, labLayout },
  );
  const rows = comps.filter(isFile('lib/lab/Row.svelte'));
  const panels = comps.filter(isFile('lib/lab/Panel.svelte'));
  check(
    'two rows, both children of the page',
    rows.length === 2 && rows.every(r => r.parentId === labPage.id),
    rows,
  );
  check(
    'two panels ({#if} + {#key}), children of the page',
    panels.length === 2 && panels.every(p => p.parentId === labPage.id),
    panels,
  );

  // A click on the second row's "+" opens it in the editor and does not reach
  // the app
  await authorizeDock(page);
  await page.locator('#svelte-inspector-host').waitFor({ state: 'attached', timeout: 20_000 });
  const secondInc = page.locator('[data-testid=inc]').nth(1);
  const secondRow = secondInc.locator('xpath=ancestor::li[1]');
  const rowBefore = await secondRow.textContent();
  await enableInspector(page);
  await secondInc.hover();
  const hoverLabel = await page
    .locator('#svelte-inspector-overlay .svelte-inspector-tag')
    .textContent({ timeout: 5000 })
    .catch(() => '');
  check('inspector: hover names the component instance', hoverLabel === '<Row>', hoverLabel);
  await secondInc.click();
  await sleep(500);
  check(
    'inspector: the click did not reach the app',
    (await secondRow.textContent()) === rowBefore,
  );
  // without holding the toggle keys, it stays on for the next element
  check('inspector: still on after the click', await inspectorOn(page));
  const live = await tool('get_live_components', { includeMeta: true });
  // a tracked inspector component has no file (its module is not instrumented)
  const outside = live.components.filter(c => !file(c).startsWith(`${appDir}/src/`));
  check('inspector: none of its components are live components', outside.length === 0, outside);
  const opened = await until(editorOpened, t => t.includes('Row.svelte'), 5000);
  check(
    'inspector: the click opens the element in the editor',
    opened.includes('Row.svelte'),
    opened,
  );
  check('inspector: the click picks no component', picks.length === 0, picks);

  // Right-click on the first row's "+": Inspect on the <Row> row of the menu
  // picks that Row instance and opens no editor
  const firstInc = page.locator('[data-testid=inc]').nth(0);
  await enableInspector(page);
  await firstInc.hover();
  await firstInc.click({ button: 'right' });
  const menuRows = page.locator('#svelte-inspector-overlay li');
  await menuRows
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  const menuText = (await menuRows.allTextContents()).map(t => t.replaceAll(/\s+/g, ' ').trim());
  check(
    'inspector: the right-click menu lists the element and its parent <Row>, each with Inspect and Open',
    menuText.length >= 2 &&
      /^<button> .*Row\.svelte:\d+ Inspect Open ↗$/.test(menuText[0]) &&
      /^<Row> .*lab\/\+page\.svelte:\d+ Inspect Open ↗$/.test(menuText[1]),
    menuText,
  );
  const openedBefore = editorOpened();
  const picksBefore = picks.length;
  await menuRows
    .nth(1)
    .getByRole('button', { name: /^Inspect / })
    .click({ timeout: 5000 })
    .catch(() => {});
  const menuPicks = await until(
    () => picks.slice(picksBefore),
    p => p.length > 0,
    2000,
  );
  check(
    "inspector: the <Row> row's Inspect picks the first Row instance",
    menuPicks.length === 1 &&
      menuPicks[0].componentId === rows[0]?.id &&
      menuPicks[0].epoch === live.epoch,
    { menuPicks, rows: rows.map(r => r.id), epoch: live.epoch },
  );
  const openedAfter = await until(editorOpened, t => t !== openedBefore, 2000);
  check('inspector: Inspect opens no editor', openedAfter === openedBefore, openedAfter);
  check('inspector: turned off after Inspect', !(await inspectorOn(page)));
  await closeDockPanel(page);

  const E = edgesOf(g);
  const P = n => `${labPage.id}:${n}`;
  const items = byName(g, 'Inventory.items', 'lab/store.svelte.ts');
  const total = byName(g, 'Inventory.total', 'lab/store.svelte.ts');
  const prefs = byName(g, 'prefs', 'lab/store.svelte.ts');
  check(
    'module state is tracked (Inventory.items/total, prefs)',
    items && total && prefs,
    g.nodes.map(n => n.id),
  );
  check(
    'Inventory.items -> Inventory.total',
    items && total && E.has(`${items.id} -> ${total.id}`),
  );
  check('Inventory.items -> page visible', items && E.has(`${items.id} -> ${P('visible')}`));
  check(
    'visible -> count / pieces (destructured $derived)',
    E.has(`${P('visible')} -> ${P('count')}`) && E.has(`${P('visible')} -> ${P('pieces')}`),
  );
  check(
    'count / pieces -> summary ($derived.by)',
    E.has(`${P('count')} -> ${P('summary')}`) && E.has(`${P('pieces')} -> ${P('summary')}`),
  );
  check(
    'summary -> markup and -> $effect.pre',
    E.has(`${P('summary')} -> ${P('(template)')}`) &&
      E.has(`${P('summary')} -> ${P('effect_pre_1')}`),
  );
  check('pieces -> $effect', E.has(`${P('pieces')} -> ${P('effect_1')}`));
  check(
    'module prefs and Inventory.total -> page markup',
    prefs &&
      E.has(`${prefs.id} -> ${P('(template)')}`) &&
      E.has(`${total.id} -> ${P('(template)')}`),
  );
  check(
    'query -> markup (bind:value) and -> visible',
    E.has(`${P('query')} -> ${P('(template)')}`) && E.has(`${P('query')} -> ${P('visible')}`),
  );
  const pathNode = g.nodes.find(n => n.id === P('path'));
  check('path ($app/state) reports untracked dependencies', pathNode?.untrackedDeps > 0, pathNode);
  for (const row of rows) {
    const label = `${row.id}:label`;
    check(
      `row ${row.id}: label <- Inventory.items (prop of a module proxy)`,
      items && E.has(`${items.id} -> ${label}`),
      [...E].filter(e => e.endsWith(label)),
    );
    check(
      `row ${row.id}: editing -> its markup`,
      E.has(`${row.id}:editing -> ${row.id}:(template)`),
    );
  }
  const labCtx = `${labLayout.id}:lab`;
  for (const panel of panels) {
    check(
      `panel ${panel.id}: greeting <- layout context state`,
      E.has(`${labCtx} -> ${panel.id}:greeting`),
      [...E].filter(e => e.includes(`${panel.id}:`)),
    );
  }

  const problems = await tool('get_reactive_graph_problems', {});
  const orphanNames = problems.orphanDeriveds
    .filter(d => file(d).includes('/lab'))
    .map(d => d.name);
  check(
    'orphan deriveds of the lab: only unusedOnPurpose',
    JSON.stringify(orphanNames) === '["unusedOnPurpose"]',
    problems.orphanDeriveds,
  );
  check('no isolated nodes', problems.isolatedNodes.length === 0, problems.isolatedNodes);
  const issues = await tool('list_performance_issues', {});
  check(
    'no derived-orphan performance issue',
    !issues.issues.some(i => i.kind === 'derived-orphan'),
    issues.issues,
  );

  const scope = await tool('get_reactive_scope', {
    componentId: labPage.id,
    epoch: (await tool('get_live_components', { includeMeta: true })).epoch,
  });
  const SE = edgesOf(scope);
  check(
    'scoped page graph keeps the module edges',
    items && SE.has(`${items.id} -> ${P('visible')}`),
  );
  // the page's snippet <span>{count} visible</span> is rendered by the {#if}
  // Panel: its markup effect belongs to the Panel, reading the page's count
  const countReaders = [...E].filter(
    e => e.startsWith(`${P('count')} -> `) && e.endsWith(':(template)'),
  );
  check(
    'page snippet rendered by a child reads count (global)',
    countReaders.some(e => panels.some(p => e.endsWith(`${p.id}:(template)`))),
    countReaders,
  );
  check(
    'scoped page graph shows that reader in the child',
    countReaders.every(e => SE.has(e)),
    { countReaders, scoped: [...SE].filter(e => e.includes(':count')) },
  );

  const timeline = await tool('get_state_timeline', {});
  let cursor = timeline.cursor;
  const changesAfter = async (action, expectNames) => {
    await action();
    const found = await until(
      async () => {
        const t = await tool('get_state_timeline', { since: cursor });
        return t;
      },
      t => expectNames.every(n => t.changes?.some(c => c.name === n)),
      6000,
    );
    if (found?.cursor) cursor = found.cursor;
    return (found?.changes ?? []).map(c => c.name);
  };
  const step = async (label, action, names) => {
    const got = await changesAfter(action, names);
    check(
      `timeline: ${label} -> ${names.join(', ')}`,
      names.every(n => got.includes(n)),
      got,
    );
  };
  await step('type a filter', () => page.fill('[data-testid=query]', 'al'), ['query']);
  await step('add an item (class field array push)', () => page.click('[data-testid=add]'), [
    'Inventory.items',
  ]);
  await step('toggle module prefs', () => page.click('[data-testid=compact]'), ['prefs']);
  await step('switch the context user', () => page.click('[data-testid=user]'), ['lab']);
  await step('toggle the {#key} tab', () => page.click('[data-testid=tab]'), ['tab']);
  await step('hide the panel', () => page.click('[data-testid=panel]'), ['showPanel']);
  await page.fill('[data-testid=query]', '');
  await step('bind:qty from a row', () => page.click('[data-testid=inc] >> nth=0'), [
    'Inventory.items',
  ]);

  ({ comps } = await snapshot());
  checkTree('after interactions', comps);
  check(
    'three rows after add + clearing the filter',
    comps.filter(isFile('lib/lab/Row.svelte')).length === 3,
  );
  check(
    'one panel after hiding the {#if} one',
    comps.filter(isFile('lib/lab/Panel.svelte')).length === 1,
  );

  const before = comps.filter(isFile('lib/lab/Row.svelte')).map(r => r.id);
  const epochBefore = (await tool('get_live_components', { includeMeta: true })).epoch;
  fs.writeFileSync(
    hmrFile,
    hmrOriginal.replace(
      '<button type="button" onclick={() => (editing = !editing)}>edit</button>',
      '<button type="button" onclick={() => (editing = !editing)}>edit!</button>',
    ),
  );
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => b.textContent === 'edit!'),
    null,
    { timeout: 15_000 },
  );
  await sleep(800);
  ({ comps, graph: g } = await snapshot());
  const epochAfter = (await tool('get_live_components', { includeMeta: true })).epoch;
  checkTree('after HMR of Row.svelte', comps);
  const after = comps.filter(isFile('lib/lab/Row.svelte'));
  check('HMR: the page was not reloaded', epochAfter === epochBefore, { epochBefore, epochAfter });
  check(
    'HMR: same number of rows, all re-created (no ghosts)',
    after.length === before.length && !after.some(r => before.includes(r.id)),
    { before, after: after.map(r => r.id) },
  );
  // the graph may come from the collector's cache (up to 1 s, see
  // get_reactive_scope): judge an answer computed after the HMR update
  const hmrAt = Date.now();
  g = await until(
    () => tool('get_reactive_scope', {}),
    r => (r.computedAt ?? 0) > hmrAt,
    5000,
  );
  const ghostNodes = g.nodes.filter(
    n => !comps.some(c => c.id === n.componentId) && !file(n).endsWith('.svelte.ts'),
  );
  check(
    'HMR: every graph node belongs to a live component or module',
    ghostNodes.length === 0,
    ghostNodes.map(n => n.id),
  );
  restore();
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => b.textContent === 'edit'),
    null,
    { timeout: 15_000 },
  );

  // After HMR: once an init failed inside <svelte:boundary>, the next HMR
  // update is a full page reload, also without this plugin.
  await page.click('[data-testid=fail]');
  await page.waitForSelector('[data-testid=failed]', { timeout: 5000 });
  ({ comps } = await snapshot());
  checkTree('after a failing init inside <svelte:boundary>', comps);
  check('the failed component left no instance', !comps.some(isFile('lib/lab/Broken.svelte')));
  await page.click('[data-testid=add]');
  await sleep(500);
  ({ comps } = await snapshot());
  const page2 = comps.find(isFile('routes/lab/+page.svelte'));
  check(
    'rows added after the failure are children of the page',
    comps.filter(isFile('lib/lab/Row.svelte')).every(r => r.parentId === page2?.id),
  );

  const unexpected = pageErrors.filter(e => !e.includes('fails on purpose'));
  check('no unexpected page errors', unexpected.length === 0, unexpected);
  const serverErrors = log
    .split('\n')
    .filter(l => /\b(error|Error)\b/.test(l) && !l.includes('fails on purpose'));
  check('no server errors', serverErrors.length === 0, serverErrors.slice(0, 10));
} catch (e) {
  check('run completed', false, e.stack);
} finally {
  await browser?.close();
  restore();
  stopServer();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
