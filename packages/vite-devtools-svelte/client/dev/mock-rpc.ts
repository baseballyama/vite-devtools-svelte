/**
 * Dev-only synthetic backend: every `svelte-devtools:*` RPC answered with
 * large, deterministic data so the client UI can be developed and
 * stress-tested without a SvelteKit app. Transport-agnostic — see
 * `vite.mock.config.ts` for how it is mounted (devframe WS or legacy HTTP).
 *
 * Never bundled: only `dev/vite.mock.config.ts` imports it.
 */
import { compile } from 'svelte/compiler'
import type {
  ComponentInstance,
  ComponentRelation,
  ModuleNode,
  ReactiveGraph,
  RenderProfile,
  RouteInfo,
  StateChange,
} from '../../src/types.js'

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = 'app shell nav header footer sidebar card list item row table cell button icon avatar modal dialog form field input select toggle tabs tab panel chart graph legend tooltip menu dropdown badge toast banner hero grid feed post comment user profile settings billing invoice cart product price search filter sort pager editor preview upload'.split(' ')

export const MOCK_ASSET_BASE = '/__mock-static/'

export function createMockBackend(scale = 5000) {
  const r = rng(42)
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
  const root = '/Users/dev/acme-store'

  // ---- component files & relations
  const fileCount = Math.max(40, Math.round(scale / 4))
  const files: { file: string; name: string }[] = []
  const used = new Set<string>()
  for (let i = 0; files.length < fileCount; i++) {
    const name = cap(pick(WORDS)) + cap(pick(WORDS)) + (i > WORDS.length * 3 ? i : '')
    if (used.has(name)) continue
    used.add(name)
    const dir = pick(['lib/components', 'lib/components/ui', 'lib/features/' + pick(WORDS), 'routes/(app)/' + pick(WORDS)])
    files.push({ file: `src/${dir}/${name}.svelte`, name })
  }
  const relations: ComponentRelation[] = files.map((f, i) => ({
    ...f,
    imports: Array.from({ length: Math.floor(r() * 6) }, () => files[Math.min(files.length - 1, i + 1 + Math.floor(r() * 40))].file).filter((v, j, a) => a.indexOf(v) === j && v !== f.file),
  }))

  // ---- live instance tree (wide + deep), mutated on every poll
  let nextId = 1
  let live: ComponentInstance[] = []
  const grow = (parentId: number | null, depth: number) => {
    if (live.length >= scale) return
    const id = nextId++
    const f = depth === 0 ? { file: 'src/routes/+layout.svelte', name: 'Layout' } : pick(files)
    live.push({ id, file: f.file, name: f.name, parentId, mounted: true })
    const kids = depth === 0 ? 8 : depth < 3 ? 2 + Math.floor(r() * 8) : depth < 14 ? Math.floor(r() * 4) : 0
    for (let k = 0; k < kids; k++) grow(id, depth + 1)
  }
  while (live.length < scale) grow(null, 0)

  function churn() {
    // Unmount a few leaves, mount a few new ones under random parents.
    const n = Math.max(1, Math.round(scale * 0.002))
    const parents = new Set(live.map((c) => c.parentId))
    const leaves = live.filter((c) => !parents.has(c.id))
    const drop = new Set(Array.from({ length: n }, () => pick(leaves).id))
    live = live.filter((c) => !drop.has(c.id))
    for (let i = 0; i < n; i++) {
      const p = pick(live)
      const f = pick(files)
      live.push({ id: nextId++, file: f.file, name: f.name, parentId: p.id, mounted: true })
    }
  }

  // ---- routes (nested, with params / groups)
  const routes: RouteInfo[] = [
    { id: '/', path: '/', pattern: '^/$', segments: [], hasPage: true, hasLayout: true, hasServerPage: false, hasServerLayout: true, hasEndpoint: false, hasPageLoad: true, hasLayoutLoad: true, params: [], files: [{ type: 'page', path: 'src/routes/+page.svelte' }, { type: 'layout', path: 'src/routes/+layout.svelte' }, { type: 'layout-load-server', path: 'src/routes/+layout.server.ts' }] },
  ]
  const routeCount = Math.max(30, Math.round(scale / 15))
  const seen = new Set(['/'])
  while (routes.length < routeCount) {
    const depth = 1 + Math.floor(r() * 4)
    const segs: string[] = []
    for (let d = 0; d < depth; d++) {
      const x = r()
      segs.push(x < 0.15 ? `[${pick(['id', 'slug', 'userId', 'lang'])}]` : x < 0.2 ? `(${pick(['app', 'marketing', 'auth'])})` : x < 0.23 ? '[...rest]' : pick(WORDS))
    }
    const id = '/' + segs.join('/')
    if (seen.has(id)) continue
    seen.add(id)
    const hasEndpoint = r() < 0.15
    const hasPage = !hasEndpoint || r() < 0.3
    const params = segs.filter((s) => s.startsWith('[')).map((s) => ({ name: s.replace(/[[\].]/g, ''), optional: false, rest: s.startsWith('[...') }))
    const dir = `src/routes${id}`
    const filesR: RouteInfo['files'] = []
    if (hasPage) filesR.push({ type: 'page', path: `${dir}/+page.svelte` })
    if (hasPage && r() < 0.5) filesR.push({ type: 'page-load-server', path: `${dir}/+page.server.ts` })
    if (r() < 0.2) filesR.push({ type: 'layout', path: `${dir}/+layout.svelte` })
    if (hasEndpoint) filesR.push({ type: 'endpoint', path: `${dir}/+server.ts` })
    const path = '/' + segs.filter((s) => !s.startsWith('(')).join('/')
    routes.push({ id, path, pattern: '^' + path.replace(/\[\.\.\.\w+\]/g, '(.*)').replace(/\[\w+\]/g, '([^/]+?)') + '/?$', segments: segs, hasPage, hasLayout: filesR.some((f) => f.type === 'layout'), hasServerPage: filesR.some((f) => f.type === 'page-load-server'), hasServerLayout: false, hasEndpoint, hasPageLoad: false, hasLayoutLoad: false, params, files: filesR })
  }

  // ---- modules (with a few cycles)
  const modCount = Math.max(200, Math.round(scale * 1.2))
  const types: ModuleNode['type'][] = ['svelte', 'ts', 'ts', 'js', 'css', 'other']
  const modules: ModuleNode[] = []
  for (let i = 0; i < modCount; i++) {
    const t = i < files.length ? 'svelte' : pick(types)
    const id = i < files.length ? files[i].file : `${pick(['src/lib', 'src/lib/stores', 'node_modules/.vite/deps', 'src/lib/utils'])}/${pick(WORDS)}-${i}.${t === 'other' ? 'json' : t}`
    modules.push({ id: '/' + id, file: `${root}/${id}`, type: t, imports: [], importedBy: [], size: Math.floor(200 + r() * r() * 90000) })
  }
  for (let i = 0; i < modules.length; i++) {
    const k = Math.floor(r() * 7)
    for (let j = 0; j < k; j++) {
      const t = modules[Math.min(modules.length - 1, i + 1 + Math.floor(r() * 200))]
      if (t === modules[i] || modules[i].imports.includes(t.id)) continue
      modules[i].imports.push(t.id)
      t.importedBy.push(modules[i].id)
    }
  }
  const cycles: string[][] = []
  for (let c = 0; c < 4; c++) {
    const a = pick(modules), b = pick(modules), d = pick(modules)
    a.imports.push(b.id), b.imports.push(d.id), d.imports.push(a.id)
    a.isCyclic = b.isCyclic = d.isCyclic = true
    cycles.push([a.id, b.id, d.id, a.id])
  }

  // ---- assets
  const assetTypes = [['png', 'image/png'], ['svg', 'image/svg+xml'], ['webp', 'image/webp'], ['woff2', 'font/woff2'], ['json', 'application/json'], ['txt', 'text/plain'], ['mp4', 'video/mp4']] as const
  const assets = Array.from({ length: Math.max(40, Math.round(scale / 5)) }, (_, i) => {
    const [ext, type] = pick(assetTypes)
    const rel = `${pick(['images', 'images/products', 'fonts', 'icons', 'data', 'media'])}/${pick(WORDS)}-${i}.${ext}`
    return { name: rel.split('/').pop()!, path: `${root}/static/${rel}`, relativePath: rel, url: MOCK_ASSET_BASE + rel, size: Math.floor(r() * r() * 2_000_000), type, mtime: Date.now() - Math.floor(r() * 9e9) }
  })

  // ---- reactive graph
  const rnodes: ReactiveGraph['nodes'] = []
  const redges: ReactiveGraph['edges'] = []
  // MOCK_GRAPH_SCALE=N: grow the graph to ≥ N signals (e.g. 2500 to exercise
  // the Reactivity auto-pause above 2 000); default ≈ 60 components' worth.
  const GRAPH_SCALE = Number(process.env.MOCK_GRAPH_SCALE) || 0
  for (let c = 0; GRAPH_SCALE ? rnodes.length < GRAPH_SCALE : c < Math.min(60, files.length); c++) {
    const f = files[c % files.length]
    const lap = Math.floor(c / files.length)
    const base = rnodes.length
    const k = 2 + Math.floor(r() * 5)
    for (let j = 0; j < k; j++) {
      const type = j === 0 ? 'state' : j < k - 1 ? pick(['state', 'derived'] as const) : 'effect'
      rnodes.push({ id: lap ? `${f.name}~${lap}:${j}` : `${f.name}:${j}`, type, name: type === 'effect' ? `$effect#${j}` : pick(['count', 'items', 'filter', 'open', 'total', 'user', 'query', 'selected']) + j, componentId: c + 1, componentFile: f.file, value: type === 'effect' ? undefined : Math.floor(r() * 100) })
      if (j > 0) redges.push({ from: rnodes[base + Math.floor(r() * j)].id, to: rnodes[base + j].id })
    }
  }

  // ---- misc
  // Server-side ring with monotonically increasing `seq` (collector §6.4).
  let timeline: (StateChange & { seq: number })[] = []
  let seq = 0
  const stateNodes = rnodes.filter((x) => x.type === 'state')
  const t0 = Date.now()
  for (let i = 0; i < 500; i++) {
    const n = pick(stateNodes)
    timeline.push({ seq: ++seq, id: n.id, name: n.name, componentFile: n.componentFile, oldValue: i % 50 === 0 ? null : Math.floor(r() * 100), newValue: r() < 0.2 ? { items: [1, 2, 3], filter: pick(WORDS), nested: { open: r() < 0.5 } } : Math.floor(r() * 100), timestamp: t0 - (500 - i) * 120 })
  }
  const warnings = Array.from({ length: 120 }, (_, i) => ({ code: pick(['a11y_click_events_have_key_events', 'a11y_missing_attribute', 'css_unused_selector', 'state_referenced_locally', 'non_reactive_update']), message: pick(['Visible, non-interactive elements with a click event must be accompanied by a keyboard event handler.', 'Unused CSS selector ".active"', '`<img>` element should have an alt attribute', 'This reference only captures the initial value of `count`. Did you mean to reference it inside a closure instead?']), file: pick(files).file, line: 1 + Math.floor(r() * 200), column: 1 + Math.floor(r() * 40) + i * 0 }))
  const errors = Array.from({ length: 24 }, () => ({ message: pick(["TypeError: Cannot read properties of undefined (reading 'map')", 'Error: Failed to fetch /api/cart', 'ReferenceError: user is not defined']), file: pick(files).file, line: 1 + Math.floor(r() * 120), stack: 'at render (Cart.svelte:42:13)\n  at update (runtime.js:120:5)\n  at flush (scheduler.js:88:9)', timestamp: Date.now() - Math.floor(r() * 3e6) }))
  const loads = Array.from({ length: 300 }, () => ({ route: pick(routes).id, file: 'src/routes/+page.server.ts', type: pick(['server', 'universal'] as const), duration: r() * r() * 600, dataSize: Math.floor(r() * 80000), timestamp: Date.now() - Math.floor(r() * 6e5) }))
  const chunks = Array.from({ length: 120 }, (_, i) => {
    const ext = pick(['js', 'js', 'js', 'css'])
    return { name: `${pick(WORDS)}-${i.toString(36)}.${ext}`, file: `_app/immutable/${ext === 'css' ? 'assets' : 'chunks'}/${pick(WORDS)}.${Math.floor(r() * 1e8).toString(36)}.${ext}`, size: Math.floor(r() * r() * 400000), modules: modules.slice(i * 3, i * 3 + 1 + Math.floor(r() * 30)).map((m) => m.id), isEntry: i < 3 }
  })
  const endpoints = routes.filter((x) => x.hasEndpoint).map((x) => ({ route: x.id, path: x.path, methods: r() < 0.5 ? ['GET'] : ['GET', 'POST', 'DELETE'], file: x.files.find((f) => f.type === 'endpoint')!.path }))

  let fps: { timestamp: number; fps: number }[] = []
  const profiles = () => {
    const out: RenderProfile[] = []
    for (const c of live) {
      const h = (c.id * 2654435761) >>> 0
      const renders = 1 + (h % 40) + Math.floor((Date.now() / 1000) % (1 + (h % 7)))
      const avg = ((h >>> 8) % 1000) / 400
      out.push({ componentId: c.id, file: c.file, name: c.name, initTime: ((h >>> 4) % 900) / 100, renderCount: renders, totalRenderTime: renders * avg, lastRenderTime: avg, lastRenderAt: Date.now() - (h % 60000) })
    }
    return out
  }

  const SAMPLE = `<script lang="ts">\n  let { items = [] } = $props()\n  let query = $state('')\n  let open = $state(false)\n  const filtered = $derived(items.filter((i) => i.name.includes(query)))\n\n  $effect(() => {\n    if (open) console.log('opened with', filtered.length)\n  })\n</script>\n\n<div class="card">\n  <input bind:value={query} placeholder="Search" />\n  <button onclick={() => (open = !open)}>Toggle</button>\n  {#if open}\n    <ul>\n      {#each filtered as item (item.id)}\n        <li class:active={item.active}>{item.name}</li>\n      {/each}\n    </ul>\n  {/if}\n</div>\n\n<style>\n  .card {\n    padding: 12px;\n  }\n  .active {\n    color: tomato;\n  }\n</style>\n`

  // Mirror the dev server's bounded buffers (src/collector.ts LIMITS, `tail`
  // = newest kept) so >cap apps reproduce the real truncation, including
  // subtrees whose ancestors fall outside the capture. MOCK_CAP=0 disables.
  const CAP = Number(process.env.MOCK_CAP ?? 5000)
  const capped = <T>(a: T[], n = CAP) => (n > 0 && a.length > n ? a.slice(-n) : a)
  // Live components: parents-first capture (instances are in registration
  // order, so the head keeps every ancestor of what it keeps).
  const headCapped = <T>(a: T[], n = CAP) => (n > 0 && a.length > n ? a.slice(0, n) : a)

  // Dataset counters (`get-versions`). The simulated app "runs" at most once
  // per second, driven by version polls: components churn, a state change is
  // recorded, render profiles / fps move. Loads and errors change on clear only.
  const versions = { components: 0, renderProfiles: 0, loadProfiles: 0, stateTimeline: 0, reactiveGraph: 0, errors: 0, fps: 0 }
  let lastTick = 0
  function tick() {
    if (Date.now() - lastTick < 1000) return
    lastTick = Date.now()
    churn()
    const n = pick(stateNodes)
    timeline.push({ seq: ++seq, id: n.id, name: n.name, componentFile: n.componentFile, oldValue: Math.floor(r() * 100), newValue: Math.floor(r() * 100), timestamp: Date.now() })
    if (timeline.length > 500) timeline = timeline.slice(-500)
    versions.components++
    versions.renderProfiles++
    versions.stateTimeline++
    versions.reactiveGraph++
    versions.fps++
  }
  const info = (total: number, n = CAP) => ({ captured: n > 0 ? Math.min(total, n) : total, total, truncated: n > 0 && total > n, policy: 'tail' })

  const handlers: Record<string, (...args: any[]) => unknown> = {
    'svelte-devtools:get-versions': () => (tick(), { ...versions }),
    'svelte-devtools:get-live-components-meta': () => ({ total: live.length, kept: CAP > 0 ? Math.min(live.length, CAP) : live.length, truncated: CAP > 0 && live.length > CAP }),
    'svelte-devtools:get-state-timeline-delta': (args?: { since?: number }) => {
      const since = args?.since
      const oldest = timeline[0]?.seq ?? seq + 1
      if (since == null || since < oldest - 1 || since > seq) return { cursor: seq, reset: true, changes: timeline }
      return { cursor: seq, reset: false, changes: timeline.filter((e) => e.seq > since) }
    },
    'svelte-devtools:get-capture-info': () => ({
      liveComponents: info(live.length),
      renderProfiles: info(live.length),
      stateTimeline: info(timeline.length, CAP ? 500 : 0),
      reactiveNodes: info(rnodes.length),
      runtimeErrors: info(errors.length, CAP ? 200 : 0),
      compilerWarnings: info(warnings.length, CAP ? 500 : 0),
      loadProfiles: info(loads.length, CAP ? 200 : 0),
    }),
    'svelte-devtools:get-project': () => ({ name: 'acme-store', version: '2.14.0', svelteVersion: '5.56.8', sveltekitVersion: '2.70.1', viteVersion: '8.1.5', dependencies: Object.fromEntries(WORDS.slice(0, 18).map((w) => [`@acme/${w}`, `^${1 + (w.length % 5)}.${w.length}.0`])), devDependencies: { '@sveltejs/kit': '^2.70.1', svelte: '^5.56.8', vite: '^8.1.5', typescript: '^6.0.3', 'vite-devtools-svelte': 'workspace:*', vitest: '^4.1.10', playwright: '^1.63.0' }, routesDir: 'src/routes', staticDir: 'static' }),
    'svelte-devtools:get-routes': () => routes,
    'svelte-devtools:get-assets': () => assets,
    'svelte-devtools:get-component-relations': () => relations,
    'svelte-devtools:get-live-components': () => headCapped(live),
    'svelte-devtools:get-render-profiles': () => capped(profiles()),
    'svelte-devtools:get-reactive-graph': () => ({ nodes: rnodes.map((n) => (n.type === 'effect' || r() > 0.1 ? n : { ...n, value: Math.floor(r() * 100) })), edges: redges }),
    'svelte-devtools:get-load-profiles': () => capped(loads, CAP ? 200 : 0),
    'svelte-devtools:clear-load-profiles': () => ((loads.length = 0), versions.loadProfiles++),
    'svelte-devtools:get-state-timeline': () => (tick(), timeline),
    'svelte-devtools:clear-state-timeline': () => ((timeline = []), versions.stateTimeline++),
    'svelte-devtools:get-api-endpoints': () => endpoints,
    'svelte-devtools:send-api-request': ({ url, method }: { url: string; method: string }) => ({ status: method === 'DELETE' ? 404 : 200, statusText: method === 'DELETE' ? 'Not Found' : 'OK', headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: true, url, method, items: [{ id: 1, name: 'Widget' }] }), duration: Math.round(20 + r() * 200) }),
    'svelte-devtools:get-compiler-warnings': () => warnings,
    'svelte-devtools:get-runtime-errors': () => errors,
    'svelte-devtools:clear-errors': () => ((warnings.length = 0), (errors.length = 0), versions.errors++),
    'svelte-devtools:get-svelte-files': () => files,
    'svelte-devtools:inspect-file': ({ file }: { file: string }) => {
      const res = compile(SAMPLE, { filename: file.split('/').pop(), generate: 'client', dev: false })
      return { source: SAMPLE, compiled: res.js.code, file, mappings: res.js.map.mappings, sources: res.js.map.sources }
    },
    'svelte-devtools:get-module-graph': () => ({ modules, cycles }),
    'svelte-devtools:get-og-preview': ({ url }: { url: string }) => ({ url, title: 'Acme Store — Everything for your desk', description: 'Hand-picked desk gear, shipped fast.', image: '', tags: [{ property: 'og:title', content: 'Acme Store — Everything for your desk' }, { property: 'og:description', content: 'Hand-picked desk gear, shipped fast.' }, { property: 'twitter:card', content: 'summary_large_image' }], issues: ['og:image is missing', 'og:url is missing'] }),
    'svelte-devtools:get-build-analysis': () => ({ chunks, totalSize: chunks.reduce((s, c) => s + c.size, 0), timestamp: Date.now() }),
    'svelte-devtools:get-fps': () => {
      const now = Date.now()
      const last = fps.at(-1)?.timestamp ?? now - 60000
      for (let t = last + 500; t <= now; t += 500) fps.push({ timestamp: t, fps: Math.max(8, Math.min(120, Math.round(60 - (r() < 0.06 ? r() * 45 : r() * 4)))) })
      fps = fps.filter((s) => s.timestamp > now - 120000)
      return fps
    },
    'svelte-devtools:clear-fps': () => ((fps = []), versions.fps++),
    'svelte-devtools:open-in-editor': ({ file, line }: { file: string; line?: number }) => console.log('[mock] open-in-editor', file, line ?? ''),
    'svelte-devtools:set-active': ({ client, active }: { client: string; active: boolean }) => console.log('[mock] set-active', client, active),
    'svelte-devtools:open-reactive-in-editor': ({ file, name }: { file: string; name: string }) => console.log('[mock] open-reactive', file, name),
  }

  return handlers
}

/** Placeholder image served for every mock asset URL. */
export const MOCK_ASSET_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#ff3e00"/><text x="50%" y="55%" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">mock asset</text></svg>'

/** RPCs with side effects are `action`s on the devframe wire. */
export function rpcType(name: string): 'query' | 'action' {
  return /:(clear|open|send|set)-/.test(name) ? 'action' : 'query'
}
