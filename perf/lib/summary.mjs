// Paired B/F summary (perf/run-paired.mjs, perf/resummarize.mjs).
// `median` is the mathematical median (mean of the two middle values for an
// even count). Verdict rule: a difference is claimed only when the B and F
// sample ranges do not overlap (>= 2 samples per side).

import { median, r1 } from './harness.mjs'

export const METRICS = [
  ['rows mount ms', r => r.rows?.mountMs],
  ['rows unmount ms', r => r.rows?.unmountMs],
  ['tree mount ms', r => r.tree?.mountMs],
  ['tree unmount ms', r => r.tree?.unmountMs],
  ['idle task ms / window', r => median(r.idle.map(i => i.taskMs))],
  ['idle long tasks', r => median(r.idle.map(i => i.longTasks))],
  ['idle HMR bytes sent', r => median(r.idle.map(i => i.ws?.sent.bytes ?? 0))],
  ['mount/unmount HMR bytes sent', r => r.rows?.ws?.sent.bytes],
  ['churn frame p95 ms', r => r.churn?.p95],
  ['churn frames > 50 ms', r => r.churn?.over50ms],
  ['heap mounted MB', r => r.heapMountedMB],
  ['heap growth after cycles MB', r => r.leak?.growthMB],
  // Plugin-only traffic for the whole scenario (svelte-devtools:* events from
  // the app page), separate from Vite's own frames (forward-console, pings).
  [
    'devtools HMR bytes / scenario',
    r =>
      r.wsSentByEvent
        ? Object.entries(r.wsSentByEvent)
            .filter(([k]) => k.includes(' svelte-devtools:'))
            .reduce((sum, [, v]) => sum + v.bytes, 0)
        : undefined,
  ],
]

export function compare(bVals, fVals) {
  const b = bVals.filter(v => typeof v === 'number' && !Number.isNaN(v))
  const f = fVals.filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (b.length === 0 || f.length === 0) return { verdict: 'insufficient samples', b, f }
  const range = xs => [Math.min(...xs), Math.max(...xs)]
  const [bMin, bMax] = range(b)
  const [fMin, fMax] = range(f)
  let verdict = 'no measurable difference at this load'
  if (b.length < 2 || f.length < 2) verdict = 'single sample — indicative only'
  else if (fMax < bMin) verdict = 'F lower'
  else if (fMin > bMax) verdict = 'F higher'
  return {
    verdict,
    b: { median: r1(median(b)), min: bMin, max: bMax, n: b.length },
    f: { median: r1(median(f)), min: fMin, max: fMax, n: f.length },
  }
}

export function summarize(items) {
  const groups = new Map()
  for (const item of items) {
    for (const run of item.app ?? []) {
      const key = `${run.scale} / ${run.scenario}`
      if (!groups.has(key))
        groups.set(key, { scale: run.scale, scenario: run.scenario, B: [], F: [] })
      groups.get(key)[item.side].push(run)
    }
  }
  const out = {}
  const md = [
    '| scale | scenario | metric | B median [min–max] (n) | F median [min–max] (n) | verdict |',
    '|---|---|---|---|---|---|',
  ]
  for (const [key, g] of groups) {
    out[key] = {}
    for (const [name, get] of METRICS) {
      const c = compare(g.B.map(get), g.F.map(get))
      out[key][name] = c
      const fmt = s =>
        s?.median === undefined ? '—' : `${s.median} [${r1(s.min)}–${r1(s.max)}] (${s.n})`
      md.push(`| ${g.scale} | ${g.scenario} | ${name} | ${fmt(c.b)} | ${fmt(c.f)} | ${c.verdict} |`)
    }
  }
  return { table: out, markdown: md.join('\n') }
}
