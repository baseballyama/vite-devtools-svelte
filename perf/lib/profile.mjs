// Self-time summary of a V8 CPU profile (CDP `Profiler.stop` or
// `node --cpu-prof`), bucketed by origin so runtime / collector / UI cost can
// be ranked without opening the profile. URLs are reduced to a short
// workspace-relative form; absolute paths never reach the summary.

const shortUrl = url => {
  if (!url) return ''
  const s = url.replace(/^https?:\/\/[^/]+/, '').replace(/^file:\/\//, '')
  const nm = s.lastIndexOf('/node_modules/')
  if (nm >= 0) return s.slice(nm + 1).replace(/\?.*$/, '')
  const pkg = s.indexOf('/packages/')
  if (pkg >= 0) return s.slice(pkg + 1).replace(/\?.*$/, '')
  const pg = s.indexOf('/playground/')
  if (pg >= 0) return s.slice(pg + 1).replace(/\?.*$/, '')
  return s.replace(/\?.*$/, '').split('/').slice(-3).join('/')
}

export function bucketOf(name, url) {
  if (!url) return name.startsWith('(') ? name : '(native)'
  if (url.includes('/.svelte-devtools/')) return 'devtools-ui'
  if (url.includes('vite-devtools-svelte')) return 'plugin'
  if (url.includes('@vitejs/devtools') || url.includes('devframe')) return 'devframe'
  if (/\/svelte\/src\/|\/node_modules\/svelte\//.test(url)) return 'svelte'
  if (url.includes('@sveltejs/kit')) return 'kit'
  if (/\/node_modules\/vite\/|\/@vite\/client/.test(url)) return 'vite'
  if (url.includes('large-app') || url.includes('reactive-app')) return 'app'
  if (url.startsWith('node:')) return 'node'
  return 'other'
}

export function summarizeProfile(profile, top = 25) {
  const { nodes, samples = [], timeDeltas = [], startTime, endTime } = profile
  const byId = new Map(nodes.map(n => [n.id, n]))
  const self = new Map()
  for (let i = 0; i < samples.length; i++) {
    const dt = (timeDeltas[i + 1] ?? timeDeltas[i] ?? 0) / 1000
    self.set(samples[i], (self.get(samples[i]) ?? 0) + dt)
  }
  const fn = new Map()
  const buckets = {}
  for (const [id, ms] of self) {
    const cf = byId.get(id)?.callFrame
    if (!cf) continue
    const name = cf.functionName || '(anonymous)'
    const url = shortUrl(cf.url)
    const key = `${name} ${url}:${cf.lineNumber + 1}`
    const b = bucketOf(name, cf.url)
    buckets[b] = (buckets[b] ?? 0) + ms
    const e = fn.get(key) ?? { fn: name, at: `${url}:${cf.lineNumber + 1}`, bucket: b, selfMs: 0 }
    e.selfMs += ms
    fn.set(key, e)
  }
  const round = x => Math.round(x * 10) / 10
  return {
    wallMs: round((endTime - startTime) / 1000),
    buckets: Object.fromEntries(
      Object.entries(buckets)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, round(v)]),
    ),
    top: [...fn.values()]
      .filter(e => e.fn !== '(idle)' && e.fn !== '(program)')
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, top)
      .map(e => ({ ...e, selfMs: round(e.selfMs) })),
  }
}
