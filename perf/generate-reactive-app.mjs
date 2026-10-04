#!/usr/bin/env node
// Deterministic reactive-STATE stress fixture (50k+ tracked reactive nodes).
//
// Builds on generate-large-app.mjs (same package.json / vite.config.js with
// PERF_DEVTOOLS=0|1 / forwardConsole off, same resolution from playground/),
// with a small static part, and adds the route /reactive:
//
//   a binary tree of <Group> components (depth `treeDepth`), each group owns
//   one shared $state (fan-out source) and renders `nodesPerGroup` <Cell>s.
//   Every Cell has:
//     - `primitives` $state numbers/strings,
//     - one object $state (proxy) whose payload size class depends on the
//       index (small ~100 B / medium ~2 kB / large ~64 kB),
//     - a $derived chain of length 1..maxDerivedDepth (varies by index),
//       the first link reading the group's shared state (fan-out edges),
//     - `effects` $effect()s reading the chain end.
//   Probes for known blind spots (expected NOT to be fully tracked; they are
//   there to make loss visible, not to pass): module-level $state
//   (store.svelte.js) and many class instances with $state fields created by
//   one component (same tag name → same node id?).
//
// window.__reactive drives updates (all writes carry a monotonically
// increasing sequence number so recorded vs. written can be compared):
//   expected()                      static node/edge counts by type
//   writePrimitives(k)              k distinct primitive states, one batch
//   burstSame(n)                    one state written n times in one task
//   cascade(groups)                 bump shared state of `groups` groups
//   mutateDeep(k)                   in-place push into k object states
//   startNoise([{ hz, k, kind }])   concurrent timer-driven write streams (kind: primitive |
//                                   object | deep | cascade); stopNoise() →
//                                   [{ ticks, writes, lastSeq }]; startRate/stopRate = one stream
//   scenarios() / trigger(id)       "why did it change?" scenarios with the
//                                   expected answer and what is recordable
//   flushTime(fn)                   ms from fn() to the DOM being updated
//   mountTree(on)                   unmount/remount the whole tree
//
// Usage: node perf/generate-reactive-app.mjs [--treeDepth=6] [--nodesPerGroup=42]
//        [--primitives=4] [--maxDerivedDepth=6] [--effects=1]
//        [--classItems=2000] [--causalRows=200] [--out=playground/.temp/reactive-app] [--print]
// --print only computes the expected counts (writes nothing).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate as generateBase } from './generate-large-app.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULTS = {
  treeDepth: 6, // 2^(d+1)-1 = 127 groups
  nodesPerGroup: 42, // 127 × 42 = 5334 Cells
  primitives: 4,
  maxDerivedDepth: 6, // chain length 1..6, mean 3.5
  effects: 1,
  classItems: 2000,
  causalRows: 200,
  out: path.join(repoRoot, 'playground/.temp/reactive-app'),
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, print: false }
  for (const arg of argv) {
    if (arg === '--print') {
      opts.print = true
      continue
    }
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (!m || !(m[1] in DEFAULTS)) throw new Error(`Unknown option ${arg}`)
    opts[m[1]] = m[1] === 'out' ? path.resolve(m[2]) : Number(m[2])
  }
  return opts
}

/** Payload class by Cell index: 0 small (~100 B), 1 medium (~2 kB), 2 large (~64 kB). */
export const payloadClass = i => (i % 100 === 99 ? 2 : i % 100 >= 90 ? 1 : 0)
export const derivedDepth = (i, max) => 1 + (i % max)

/** Static expectation of what the runtime should track (tagged nodes only). */
export function expected(o = DEFAULTS) {
  const groups = 2 ** (o.treeDepth + 1) - 1
  const cells = groups * o.nodesPerGroup
  let derived = 0
  const payload = [0, 0, 0]
  for (let i = 0; i < cells; i++) {
    derived += derivedDepth(i, o.maxDerivedDepth)
    payload[payloadClass(i)]++
  }
  const nodes = {
    state: groups /* shared */ + cells * o.primitives,
    proxy: cells /* object state */,
    derived,
    effect: cells * o.effects,
  }
  const total = Object.values(nodes).reduce((a, b) => a + b, 0)
  // dependency edges between tracked nodes (direct reads):
  //   shared → first derived (fan-out), each chain link → next, chain end → effects,
  //   first derived also reads primitive 0
  const edges = cells * 2 + (derived - cells) + cells * o.effects
  return {
    groups,
    cells,
    nodes,
    total,
    edges,
    payloadCells: { small: payload[0], medium: payload[1], large: payload[2] },
    fanoutPerShared: o.nodesPerGroup,
    probes: { moduleState: 1, classItems: o.classItems },
  }
}

// "Why did it change?" scenarios with the expected answer. Node names are
// file:stateName (component ids are assigned at runtime). `recordable` says
// what DevTools can actually know for each link; anything else must be shown
// as "not recorded", never inferred.
export const SCENARIOS = [
  {
    id: 'filter-click',
    trigger: { click: '#why-filter' },
    question: 'Why did the List rows change?',
    expected: {
      event: 'click #why-filter',
      write: 'Causal.svelte:filter',
      derived: ['List.svelte:visible'],
      render: ['List.svelte', 'Row.svelte (removed rows unmount)'],
    },
    recordable: {
      event: 'only with write interception (H) + window.event at write time',
      write: 'with H: exact; today: value change observed by the 200 ms poll',
      derived: 'structural (dependency edge filter → visible via props)',
      render: 'observed (render count / unmount)',
    },
  },
  {
    id: 'threshold-update',
    trigger: { click: '#why-threshold' },
    question: 'Why did the List rows change (update path, threshold++)?',
    expected: {
      event: 'click #why-threshold',
      write: 'Causal.svelte:threshold ($.update)',
      derived: ['List.svelte:visible'],
      render: ['List.svelte', 'Row.svelte'],
    },
    recordable: {
      event: 'only with H (update/update_pre must be wrapped as well as set)',
      write: 'with H: exact; today: poll',
      derived: 'structural',
      render: 'observed',
    },
  },
  {
    id: 'proxy-property',
    trigger: { click: '#why-proxy' },
    question: 'Why did Counter re-render?',
    expected: {
      event: 'click #why-proxy',
      write: 'Counter.svelte:box.n (proxy property write)',
      derived: [],
      render: ['Counter.svelte'],
    },
    recordable: {
      event: 'not recorded (proxy set trap calls Svelte-internal set, not the wrapper)',
      write: 'not recorded as a write; value change observed by the poll on box',
      derived: 'none',
      render: 'observed',
    },
  },
  {
    id: 'module-state',
    trigger: { click: '#why-module' },
    question: 'Why did moduleState change?',
    expected: {
      event: 'click #why-module',
      write: 'rt.svelte.js:moduleState.ticks',
      derived: [],
      render: [],
    },
    recordable: {
      event: 'not recorded',
      write: 'not recorded (module-level $state is not tracked: no component initialising)',
      derived: 'none',
      render: 'none',
    },
  },
]

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function cellSource(o) {
  const prims = Array.from({ length: o.primitives }, (_, p) =>
    p % 2 ? `  let p${p} = $state('s' + index)` : `  let p${p} = $state(index + ${p})`,
  ).join('\n')
  // A fixed-length chain cannot vary per instance in source, so each Cell
  // declares maxDerivedDepth links but only the first `depth` read upstream;
  // the rest are constants-free passthroughs gated off (not created) via a
  // per-depth child component would add components — instead we generate one
  // Cell variant per depth (CellD1..CellDn) and pick by index.
  return depth => {
    const chain = [`  const d0 = $derived(shared + p0)`]
    for (let k = 1; k < depth; k++) chain.push(`  const d${k} = $derived(d${k - 1} + 1)`)
    const effects = Array.from(
      { length: o.effects },
      (_, e) => `  $effect(() => {\n    sink[${e}] = d${depth - 1}\n  })`,
    ).join('\n')
    return `<script>
  import { register, payload } from './rt.svelte.js'
  let { index, shared } = $props()
${prims}
  let obj = $state(payload(index))
${chain.join('\n')}
  const sink = []
${effects}
  register(index, {
    setPrim: (k, v) => (k === 0 ? (p0 = v) : ${o.primitives > 1 ? '(p1 = v)' : '(p0 = v)'}),
    setObj: v => (obj = v),
    pushDeep: v => obj.list.push(v),
  })
</script>

<span class="c" data-i={index}>{d${depth - 1}}·{p${o.primitives > 1 ? 1 : 0}}·{obj.list.length}</span>
`
  }
}

export function generate(opts = DEFAULTS) {
  const o = { ...DEFAULTS, ...opts }
  // static part kept small: this fixture is about reactive state, not files
  generateBase({ components: 50, routes: 10, assets: 50, out: o.out })
  const r = path.join(o.out, 'src/routes/reactive')
  const exp = expected(o)

  write(
    path.join(r, 'rt.svelte.js'),
    `// Shared driver state for /reactive (module scope: NOT inside a component).
export const moduleState = $state({ ticks: 0 }) // probe: module-level $state
const cells = new Map()
export const register = (i, api) => cells.set(i, api)
export const unregister = i => cells.delete(i)
export const cellCount = () => cells.size
export const cell = i => cells.get(i)

const blob = n => 'x'.repeat(n)
export function payload(i) {
  const cls = ${payloadClass.toString().replace(/^i => /, 'i => ')}
  const c = cls(i)
  if (c === 2) return { id: i, list: Array.from({ length: 1000 }, (_, k) => ({ k, v: blob(50) })) }
  if (c === 1) return { id: i, list: Array.from({ length: 20 }, (_, k) => ({ k, v: blob(80) })) }
  return { id: i, list: [i], label: blob(60) }
}

export class Item {
  done = $state(false) // probe: class field $state, many instances in one component
  constructor(id) { this.id = id }
}
`,
  )

  const cellFor = cellSource(o)
  for (let d = 1; d <= o.maxDerivedDepth; d++) write(path.join(r, `CellD${d}.svelte`), cellFor(d))

  write(
    path.join(r, 'Group.svelte'),
    `<script>
  import Group from './Group.svelte'
${Array.from({ length: o.maxDerivedDepth }, (_, d) => `  import CellD${d + 1} from './CellD${d + 1}.svelte'`).join('\n')}
  import { groups } from './groups.js'
  let { id, depth } = $props()
  let shared = $state(0)
  groups.set(id, { bump: v => (shared = v) })
  const PER = ${o.nodesPerGroup}
  const MAXD = ${o.maxDerivedDepth}
  const Cells = [${Array.from({ length: o.maxDerivedDepth }, (_, d) => `CellD${d + 1}`).join(', ')}]
  const base = id * PER
</script>

<section data-g={id}>
  {#each { length: PER } as _, k (k)}
    {@const index = base + k}
    {@const C = Cells[index % MAXD]}
    <C {index} {shared} />
  {/each}
  {#if depth > 0}
    <Group id={id * 2 + 1} depth={depth - 1} />
    <Group id={id * 2 + 2} depth={depth - 1} />
  {/if}
</section>
`,
  )

  write(path.join(r, 'groups.js'), `export const groups = new Map()\n`)

  write(
    path.join(r, 'Items.svelte'),
    `<script>
  import { Item } from './rt.svelte.js'
  const items = Array.from({ length: ${o.classItems} }, (_, i) => new Item(i))
  globalThis.__reactiveItems = items
</script>
<p>items {items.filter(i => i.done).length}</p>
`,
  )

  // Known causal chains for the "why did it change?" scenarios (SCENARIOS).
  write(
    path.join(r, 'Causal.svelte'),
    `<script>
  import List from './List.svelte'
  import Counter from './Counter.svelte'
  import { moduleState } from './rt.svelte.js'
  let filter = $state('')
  let threshold = $state(0)
</script>

<div class="causal">
  <button id="why-filter" onclick={() => (filter = 'row-1')}>filter</button>
  <button id="why-threshold" onclick={() => threshold++}>threshold</button>
  <button id="why-module" onclick={() => moduleState.ticks++}>module</button>
  <List {filter} {threshold} />
  <Counter />
</div>
`,
  )
  write(
    path.join(r, 'List.svelte'),
    `<script>
  import Row from './Row.svelte'
  let { filter, threshold } = $props()
  const rows = Array.from({ length: ${o.causalRows} }, (_, i) => ({ id: i, label: 'row-' + i, n: i % 10 }))
  const visible = $derived(rows.filter(r => r.label.startsWith(filter) && r.n >= threshold))
</script>

<ul class="list">
  {#each visible as row (row.id)}
    <Row {row} />
  {/each}
</ul>
`,
  )
  write(
    path.join(r, 'Row.svelte'),
    `<script>
  let { row } = $props()
</script>

<li data-row={row.id}>{row.label}</li>
`,
  )
  write(
    path.join(r, 'Counter.svelte'),
    `<script>
  let box = $state({ n: 0 })
</script>

<button id="why-proxy" onclick={() => box.n++}>proxy {box.n}</button>
`,
  )

  write(
    path.join(r, '+page.svelte'),
    `<script>
  import { tick } from 'svelte'
  import Group from './Group.svelte'
  import Items from './Items.svelte'
  import Causal from './Causal.svelte'
  import { cell, cellCount, moduleState } from './rt.svelte.js'
  import { groups } from './groups.js'

  const EXPECTED = ${JSON.stringify(exp)}
  const SCENARIOS = ${JSON.stringify(SCENARIOS)}
  let mounted = $state(true)
  let seq = 0
  let streams = []
  const CELLS = EXPECTED.cells
  // deterministic cell choice: stride through indices
  let cursor = 0
  const nextCells = k => Array.from({ length: k }, () => (cursor = (cursor + 7919) % CELLS))

  const api = {
    ready: false,
    expected: () => EXPECTED,
    scenarios: () => SCENARIOS,
    counts: () => ({ cellsRegistered: cellCount(), groups: groups.size, seq }),
    writePrimitives(k) {
      for (const i of nextCells(k)) cell(i)?.setPrim(0, ++seq)
      return seq
    },
    burstSame(n) {
      for (let j = 0; j < n; j++) cell(0)?.setPrim(0, ++seq)
      return seq
    },
    cascade(g) {
      for (let j = 0; j < g; j++) groups.get(j % EXPECTED.groups)?.bump(++seq)
      return seq
    },
    mutateDeep(k) {
      for (const i of nextCells(k)) cell(i)?.pushDeep(++seq)
      return seq
    },
    writeObjects(k) {
      for (const i of nextCells(k)) cell(i)?.setObj({ id: i, list: [++seq], label: 'o' + seq })
      return seq
    },
    moduleTick() {
      moduleState.ticks = ++seq
      return seq
    },
    // Background noise: several timer-driven write streams at once, e.g.
    // [{ hz: 1, k: 250, kind: 'primitive' }, { hz: 10, k: 50, kind: 'primitive' },
    //  { hz: 1, k: 50, kind: 'deep' }]. Rates are inputs of a scenario, not targets.
    startNoise(list) {
      api.stopNoise()
      const fns = { primitive: api.writePrimitives, object: api.writeObjects, deep: api.mutateDeep, cascade: api.cascade }
      streams = list.map(({ hz, k, kind = 'primitive' }) => {
        const stat = { hz, k, kind, ticks: 0, writes: 0, firstSeq: seq + 1, lastSeq: seq }
        const fn = fns[kind]
        return { stat, timer: setInterval(() => { fn(k); stat.ticks++; stat.writes += k; stat.lastSeq = seq }, 1000 / hz) }
      })
      return streams.map(s => s.stat)
    },
    stopNoise() {
      for (const s of streams) clearInterval(s.timer)
      const stats = streams.map(s => s.stat)
      streams = []
      return stats
    },
    startRate(stream) {
      return api.startNoise([stream])[0]
    },
    stopRate() {
      return api.stopNoise()[0] ?? null
    },
    // Runs one scenario's trigger (a real click, so the browser event exists)
    // and returns when the DOM has updated.
    async trigger(id) {
      const sc = SCENARIOS.find(x => x.id === id)
      const t0 = performance.now()
      document.querySelector(sc.trigger.click).click()
      await tick()
      return { id, ms: performance.now() - t0 }
    },
    async flushTime(fnName, ...args) {
      const t0 = performance.now()
      api[fnName](...args)
      await tick()
      return performance.now() - t0
    },
    async mountTree(on) {
      mounted = on
      await tick()
      return cellCount()
    },
  }
  if (typeof window !== 'undefined') window.__reactive = api
  $effect(() => {
    api.ready = true
  })
</script>

<h1>reactive state fixture</h1>
<p>expected tracked nodes {EXPECTED.total} (cells {EXPECTED.cells}, groups {EXPECTED.groups})</p>
<Causal />
<Items />
{#if mounted}
  <Group id={0} depth={${o.treeDepth}} />
{/if}
`,
  )

  // unregister on unmount is not needed for the driver (cells map is rebuilt
  // on remount: register() overwrites by index).
  return { out: o.out, expected: exp }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = parseArgs(process.argv.slice(2))
  if (o.print) {
    console.log(JSON.stringify(expected(o), null, 2))
  } else {
    const t0 = performance.now()
    const res = generate(o)
    console.log(
      `reactive app → ${path.relative(repoRoot, res.out)} (${res.expected.total} tracked nodes expected) in ${Math.round(performance.now() - t0)} ms`,
    )
  }
}
