#!/usr/bin/env node
// Deterministic "huge app" fixture for vite-devtools-svelte performance work.
//
// Writes a SvelteKit app to playground/.temp/large-app (gitignored). It lives
// under playground/ so that @sveltejs/kit, svelte, vite and the workspace
// vite-devtools-svelte resolve from playground/node_modules without touching
// the lockfile.
//
// Shape (defaults, override with --key=value):
//   components  generated .svelte files with an import graph (static analysis,
//               Components "static" view, module graph)
//   routes      +page.svelte routes, every 4th with a +page.ts load, nested and
//               dynamic segments (Routes panel, OG, load profiler)
//   assets      files under static/ in nested dirs (Assets panel)
//   /bench      runtime stress page driven via window.__bench:
//               wide keyed list (rows), deep recursive tree (depth x breadth),
//               one big $state array (stringify cost), state churn, mount cycles
//
// Usage: node perf/generate-large-app.mjs [--components=800] [--routes=300]
//        [--assets=1500] [--out=playground/.temp/large-app]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULTS = {
  components: 800,
  routes: 300,
  assets: 1500,
  out: path.join(repoRoot, 'playground/.temp/large-app'),
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS }
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (!m) continue
    const [, key, value] = m
    if (!(key in opts)) throw new Error(`Unknown option --${key}`)
    opts[key] = key === 'out' ? path.resolve(value) : Number(value)
  }
  return opts
}

// Small deterministic PRNG so every run produces byte-identical output.
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const pad = n => String(n).padStart(4, '0')

function componentSource(i, imports) {
  const importLines = imports.map(j => `  import C${pad(j)} from './C${pad(j)}.svelte'`).join('\n')
  // Children are only rendered when `depth > 0` so the static import graph can
  // be dense without exploding the runtime instance count on route pages.
  const children = imports.map(j => `    <C${pad(j)} depth={depth - 1} />`).join('\n')
  return `<script lang="ts">
${importLines}
  let { depth = 0 }: { depth?: number } = $props()
  let count = $state(${i % 7})
  let label = $state('component-${i}')
  const doubled = $derived(count * 2)
  $effect(() => {
    // touch reactive values so the effect has dependencies
    void doubled
    void label
  })
</script>

<section class="c" data-c="${i}">
  <button onclick={() => count++}>{label}: {count} / {doubled}</button>
  {#if depth > 0}
${children}
  {/if}
</section>
`
}

function routeSegments(i, rand) {
  // Mix of static, nested, dynamic, optional, rest and grouped segments.
  const kind = i % 10
  const base = `section-${Math.floor(i / 10)}`
  switch (kind) {
    case 0:
      return [base]
    case 1:
      return [base, `page-${i}`]
    case 2:
      return [base, `[id]`, `item-${i}`]
    case 3:
      return [`(group-${i % 3})`, base, `g-${i}`]
    case 4:
      return [base, `[[lang]]`, `opt-${i}`]
    case 5:
      return [base, `rest-${i}`, `[...path]`]
    case 6:
      return [base, `[slug=integer]`, `m-${i}`]
    default:
      return [base, `deep-${Math.floor(rand() * 5)}`, `leaf-${i}`]
  }
}

// Major version of the @sveltejs/kit that resolves from `dir` (playground's,
// for anything under playground/). The fixture follows it so that a checkout
// from before the Kit 3 move still generates the Kit 2 shape it was measured
// with: Kit 2 reads svelte.config.js and `$lib`; Kit 3 takes its config from
// the Vite plugin and uses the `#lib` subpath import. Run-paired refuses
// B/F pairs whose fixture sources differ, so the two shapes never mix.
function kitMajor(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const file = path.join(d, 'node_modules/@sveltejs/kit/package.json')
    if (fs.existsSync(file)) {
      const { version } = JSON.parse(fs.readFileSync(file, 'utf8'))
      const major = Number(version.split('.')[0])
      if (!Number.isInteger(major)) throw new Error(`unexpected @sveltejs/kit version ${version}`)
      return major
    }
    if (path.dirname(d) === d) throw new Error(`@sveltejs/kit not found from ${dir}`)
  }
}

// Fixture shape for the Kit that resolves from `dir`.
export function kitShape(dir) {
  return kitMajor(dir) >= 3 ? 'kit3' : 'kit2'
}

// Shape of an existing fixture in `out` (null: none), to detect one generated
// for another Kit major.
export function fixtureShape(out) {
  if (!fs.existsSync(path.join(out, 'package.json'))) return null
  return fs.existsSync(path.join(out, 'svelte.config.js')) ? 'kit2' : 'kit3'
}

// Files under playground/.temp resolve playground/tsconfig.json, which extends
// the tsconfig `svelte-kit sync` generates (Kit 2: .svelte-kit/tsconfig.json,
// Kit 3: node_modules/$app/tsconfig.json) — absent in a fresh checkout.
// Generate it (gitignored) the same way a normal dev flow does.
export function ensurePlaygroundSync(repo = repoRoot) {
  const playground = path.join(repo, 'playground')
  const generated =
    kitShape(playground) === 'kit3'
      ? 'node_modules/$app/tsconfig.json'
      : '.svelte-kit/tsconfig.json'
  if (fs.existsSync(path.join(playground, generated))) return false
  const res = spawnSync(
    process.execPath,
    [path.join(playground, 'node_modules/@sveltejs/kit/svelte-kit.js'), 'sync'],
    { cwd: playground, stdio: 'inherit' },
  )
  // Kit 3's sync loads playground/vite.config.ts, so the plugin must be built.
  if (res.status !== 0)
    throw new Error('svelte-kit sync failed in playground/ (is the plugin built? pnpm build)')
  return true
}

export function generate(opts = DEFAULTS) {
  const rand = mulberry32(0x5eed)
  const out = opts.out
  const shape = kitShape(out)
  const lib = shape === 'kit3' ? '#lib' : '$lib'
  fs.rmSync(out, { recursive: true, force: true })

  write(
    path.join(out, 'package.json'),
    // Dependencies are declared (but resolved from playground/node_modules) so
    // Vite/SvelteKit classify them exactly like in a real project.
    JSON.stringify(
      {
        name: 'perf-large-app',
        private: true,
        type: 'module',
        ...(shape === 'kit3' && { imports: { '#lib/*': './src/lib/*' } }),
        devDependencies: Object.fromEntries(
          [
            '@sveltejs/kit',
            '@sveltejs/vite-plugin-svelte',
            'svelte',
            'vite',
            'vite-devtools-svelte',
          ].map(d => [d, '*']),
        ),
      },
      null,
      2,
    ) + '\n',
  )

  // PERF_DEVTOOLS=0 runs the identical app without the plugin so the bench can
  // compute the instrumentation overhead (ROADMAP target: < 5 %).
  write(
    path.join(out, 'vite.config.js'),
    `import { sveltekit } from '@sveltejs/kit/vite'
import { svelteDevtools } from 'vite-devtools-svelte'
import { defineConfig } from 'vite'

const withDevtools = process.env.PERF_DEVTOOLS !== '0'

export default defineConfig({
  plugins: [...(withDevtools ? [svelteDevtools()] : []), sveltekit()],
  // forwardConsole off on both sides: Vite >= 8.1 enables it when it detects
  // an AI-agent environment, which would add one HMR frame per page warning.
  server: { strictPort: true, forwardConsole: false },
  logLevel: process.env.PERF_LOG_LEVEL ?? 'warn',
})
`,
  )

  write(
    path.join(out, 'tsconfig.json'),
    JSON.stringify(
      shape === 'kit3'
        ? { extends: '$app/tsconfig', include: ['src', '*'], compilerOptions: { strict: true } }
        : {
            extends: './.svelte-kit/tsconfig.json',
            compilerOptions: { strict: true, skipLibCheck: true, moduleResolution: 'bundler' },
          },
      null,
      2,
    ) + '\n',
  )

  if (shape === 'kit2') {
    write(
      path.join(out, 'svelte.config.js'),
      `/** @type {import('@sveltejs/kit').Config} */
export default { kit: {} }
`,
    )
  }

  write(
    path.join(out, 'src/app.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="off">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`,
  )

  write(
    path.join(out, 'src/params/integer.ts'),
    `export function match(param: string) {
  return /^\\d+$/.test(param)
}
`,
  )

  // --- generated components with a sparse DAG import graph (j > i only) ---
  const compDir = path.join(out, 'src/lib/components/gen')
  for (let i = 0; i < opts.components; i++) {
    const imports = []
    const fanOut = i % 5 === 0 ? 3 : 1
    for (let k = 0; k < fanOut; k++) {
      const j = i + 1 + Math.floor(rand() * 20)
      if (j < opts.components && !imports.includes(j)) imports.push(j)
    }
    write(path.join(compDir, `C${pad(i)}.svelte`), componentSource(i, imports))
  }

  // --- bench components ---
  write(
    path.join(out, 'src/lib/bench/Row.svelte'),
    `<script lang="ts">
  let { row }: { row: { id: number; value: number } } = $props()
  let local = $state(row.value)
  let note = $state({ id: row.id, tags: ['a', 'b'] })
  const total = $derived(local + row.value)
  $effect(() => {
    void total
  })
  export function bump() {
    local++
  }
</script>

<div class="row" data-row={row.id}>
  <span>#{row.id}</span>
  <span>{local}</span>
  <span>{total}</span>
  <span>{note.tags.length}</span>
</div>
`,
  )

  write(
    path.join(out, 'src/lib/bench/Tree.svelte'),
    `<script lang="ts">
  import Tree from './Tree.svelte'
  let { depth, breadth, path = '0' }: { depth: number; breadth: number; path?: string } = $props()
  let open = $state(true)
  const kids = $derived(depth > 0 ? Array.from({ length: breadth }, (_, i) => i) : [])
</script>

<div class="node" data-path={path}>
  <span>{path}</span>
  {#if open}
    {#each kids as k (k)}
      <Tree depth={depth - 1} {breadth} path={path + '.' + k} />
    {/each}
  {/if}
</div>
`,
  )

  write(
    path.join(out, 'src/routes/+layout.svelte'),
    `<script lang="ts">
  let { children } = $props()
</script>

<nav><a href="/">home</a> <a href="/bench">bench</a></nav>
{@render children()}
`,
  )

  write(
    path.join(out, 'src/routes/+page.svelte'),
    `<script lang="ts">
  import C0000 from '${lib}/components/gen/C0000.svelte'
</script>

<h1>perf large app</h1>
<C0000 depth={3} />
`,
  )

  // /bench is driven from Playwright through window.__bench; nothing mounts
  // until asked so the bench can time mount/unmount precisely.
  write(
    path.join(out, 'src/routes/bench/+page.svelte'),
    `<script lang="ts">
  import { tick } from 'svelte'
  import Row from '${lib}/bench/Row.svelte'
  import Tree from '${lib}/bench/Tree.svelte'

  let rows = $state<{ id: number; value: number }[]>([])
  let tree = $state<{ depth: number; breadth: number } | null>(null)
  // One large object state: exercises snapshot / stringify paths in the runtime.
  let big = $state<{ id: number; label: string; done: boolean }[]>([])
  let ticker = $state(0)
  // Plain (non-reactive) refs on purpose: the churn driver calls their API.
  // The template binds them with a function binding (get, set), which Svelte
  // does not validate, so there is no binding_property_non_reactive warning
  // per Row. Fixture src sha before this change: 3b367a092b718f74 (slot A).
  const rowRefs: Array<{ bump(): void } | undefined> = []

  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

  async function timed(fn: () => void) {
    const t0 = performance.now()
    fn()
    await tick()
    await frame()
    return performance.now() - t0
  }

  if (typeof window !== 'undefined') {
    ;(window as any).__bench = {
      ready: true,
      mountRows: (n: number) =>
        timed(() => {
          rows = Array.from({ length: n }, (_, i) => ({ id: i, value: i % 13 }))
        }),
      clearRows: () =>
        timed(() => {
          rows = []
        }),
      mountTree: (depth: number, breadth: number) =>
        timed(() => {
          tree = { depth, breadth }
        }),
      clearTree: () =>
        timed(() => {
          tree = null
        }),
      setBig: (n: number) =>
        timed(() => {
          big = Array.from({ length: n }, (_, i) => ({ id: i, label: 'item ' + i, done: i % 2 === 0 }))
        }),
      // Mutate \`count\` row states per frame for \`ms\`; returns frame durations.
      churn: async (count: number, ms: number) => {
        const durations: number[] = []
        const end = performance.now() + ms
        let last = performance.now()
        let cursor = 0
        while (performance.now() < end) {
          for (let k = 0; k < count; k++) {
            rowRefs[cursor++ % Math.max(1, rowRefs.length)]?.bump()
          }
          ticker++
          await new Promise((r) => requestAnimationFrame(r))
          const now = performance.now()
          durations.push(now - last)
          last = now
        }
        return durations
      },
      counts: () => ({
        rows: rows.length,
        dom: document.getElementsByTagName('*').length,
        // The fixture must never contain the runtime marker literally, because
        // perf/check-prod-noop.mjs scans its production build for it. A
        // key built by concatenating two string literals is constant-folded by
        // the minifier back into the marker; two separate predicates are not.
        devtools: Object.keys(window).some(
          (k) => k.startsWith('__SVELTE_') && k.endsWith('DEVTOOLS__'),
        ),
      }),
    }
  }
</script>

<!-- App input -> paint probe (perf/run-paired.mjs): one click writes 50 row
     states and the ticker, i.e. a user input that fans out into many components. -->
<button
  data-bench="input"
  onclick={() => {
    for (let k = 0; k < 50; k++) rowRefs[k]?.bump()
    ticker++
  }}>bump 50</button>
<p>ticker {ticker} / big {big.length}</p>
{#if tree}
  <Tree depth={tree.depth} breadth={tree.breadth} />
{/if}
{#each rows as row, i (row.id)}
  <Row {row} bind:this={() => rowRefs[i], (v) => (rowRefs[i] = v)} />
{/each}
`,
  )

  // --- routes ---
  for (let i = 0; i < opts.routes; i++) {
    const segs = routeSegments(i, rand)
    const dir = path.join(out, 'src/routes', ...segs)
    const comp = i % opts.components
    write(
      path.join(dir, '+page.svelte'),
      `<script lang="ts">
  import C from '${lib}/components/gen/C${pad(comp)}.svelte'
  let { data } = $props()
</script>

<svelte:head>
  <title>route ${i}</title>
  <meta property="og:title" content="route ${i}" />
</svelte:head>
<h1>route ${i}</h1>
<C depth={1} />
<pre>{JSON.stringify(data ?? {})}</pre>
`,
    )
    if (i % 4 === 0) {
      write(
        path.join(dir, '+page.ts'),
        `export async function load() {
  return { route: ${i}, items: Array.from({ length: ${(i % 20) + 1} }, (_, k) => k) }
}
`,
      )
    }
    if (i % 25 === 0) {
      write(
        path.join(out, 'src/routes/api', `endpoint-${i}`, '+server.ts'),
        `import { json } from '@sveltejs/kit'
export function GET() {
  return json({ endpoint: ${i} })
}
export async function POST({ request }) {
  return json({ echo: await request.text() })
}
`,
      )
    }
  }

  // --- static assets ---
  const exts = ['svg', 'json', 'txt', 'css', 'png']
  for (let i = 0; i < opts.assets; i++) {
    const ext = exts[i % exts.length]
    const dir = path.join(out, 'static', `group-${i % 15}`, `sub-${Math.floor(i / 100)}`)
    const file = path.join(dir, `asset-${pad(i)}.${ext}`)
    let content
    if (ext === 'svg') {
      content = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="${(i % 8) + 1}" height="8"/></svg>\n`
    } else if (ext === 'json') {
      content = JSON.stringify({ i }) + '\n'
    } else if (ext === 'png') {
      // 1x1 transparent PNG
      content = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      )
    } else {
      content = `asset ${i}\n`.repeat((i % 50) + 1)
    }
    write(file, content)
  }

  return { out, shape, ...opts }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  const t0 = performance.now()
  const res = generate(opts)
  console.log(
    `large app → ${path.relative(repoRoot, res.out)} (components=${res.components} routes=${res.routes} assets=${res.assets}) in ${Math.round(performance.now() - t0)} ms`,
  )
}
