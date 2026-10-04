// Paired B/F summary (perf/run-paired.mjs, perf/resummarize.mjs).
// `median` is the mathematical median (mean of the two middle values for an
// even count). Verdict rule: a difference is claimed only when the B and F
// sample ranges do not overlap (>= 2 samples per side).

import { median, r1 } from './harness.mjs'

export const METRICS = [
  ['rows mount ms (steady, reps >= 2)', r => r.rows?.mountMs],
  ['rows warm-up mount ms (rep 1)', r => r.rows?.warmupMountMs],
  ['rows unmount ms', r => r.rows?.unmountMs],
  ['tree mount ms', r => r.tree?.mountMs],
  ['tree unmount ms', r => r.tree?.unmountMs],
  ['idle task ms / window', r => median(r.idle.map(i => i.taskMs))],
  ['idle long tasks', r => median(r.idle.map(i => i.longTasks))],
  ['idle HMR bytes sent', r => median(r.idle.map(i => i.ws?.sent.bytes ?? 0))],
  ['mount/unmount HMR bytes sent', r => r.rows?.ws?.sent.bytes],
  ['churn frame p95 ms', r => r.churn?.p95],
  ['churn window task ms', r => r.churn?.taskMs],
  ['input click -> frame median ms', r => r.input?.clickToFrameMs?.median],
  ['input window task ms', r => r.input?.taskMs],
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

export const UI_METRICS = [
  ['Components select ms', u => u.interactions?.selectMs],
  ['Components search ms', u => u.interactions?.searchMs],
  ['Components expand ms', u => u.interactions?.expandMs],
  ['panel switch Components ms', u => u.panels?.Components?.switchMs],
  ['panel switch Reactive ms', u => u.panels?.Reactive?.switchMs],
  ['panel switch Timeline ms', u => u.panels?.Timeline?.switchMs],
  ['Components idle task ms', u => u.componentsIdle?.taskMs],
]

/**
 * Only valid, latency-mode samples are aggregated: skipped/failed items, runs
 * whose `validity.valid` is false, and profiled runs are excluded and counted.
 */
export function summarize(items) {
  const groups = new Map()
  const excluded = []
  const ui = { B: [], F: [] }
  for (const item of items) {
    if (item.ui) {
      if (item.ui.profiled || item.ui.validity?.valid === false || item.error)
        excluded.push(
          `${item.n}-${item.side} ui: ${item.ui.profiled ? 'profiled' : (item.ui.validity?.reasons ?? ['item error']).join('; ')}`,
        )
      else ui[item.side].push(item.ui)
    }
    for (const run of item.app ?? []) {
      if (run.profiled || run.validity?.valid === false || item.error) {
        excluded.push(
          `${item.n}-${item.side} ${run.scale} ${run.scenario}: ${run.profiled ? 'profiled' : (run.validity?.reasons ?? ['item error']).join('; ')}`,
        )
        continue
      }
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
  if (ui.B.length || ui.F.length) {
    out.ui = {}
    md.push(
      '',
      '| DevTools UI | B median [min–max] (n) | F median [min–max] (n) | verdict |',
      '|---|---|---|---|',
    )
    for (const [name, get] of UI_METRICS) {
      const c = compare(ui.B.map(get), ui.F.map(get))
      out.ui[name] = c
      const fmt = s =>
        s?.median === undefined ? '—' : `${s.median} [${r1(s.min)}–${r1(s.max)}] (${s.n})`
      md.push(`| ${name} | ${fmt(c.b)} | ${fmt(c.f)} | ${c.verdict} |`)
    }
  }
  // Observed runtime state per side and scenario (labels the comparison: a
  // CLOSED side that is still active would not be a same-state comparison).
  const states = new Map()
  for (const item of items)
    for (const run of item.app ?? []) {
      const rt = run.runtime
      const label = rt ? `active ${rt.active}, sampling ${rt.sampling}` : 'no runtime'
      const key = `${item.side} ${run.scenario}`
      states.set(key, new Set([...(states.get(key) ?? []), label]))
    }
  out.observedStates = Object.fromEntries([...states].map(([k, v]) => [k, [...v]]))
  md.push(
    '',
    'Observed runtime state:',
    ...[...states].map(([k, v]) => `- ${k}: ${[...v].join(' | ')}`),
  )
  if (excluded.length)
    md.push('', `Excluded samples (${excluded.length}):`, ...excluded.map(e => `- ${e}`))
  return { table: out, excluded, markdown: md.join('\n') }
}
