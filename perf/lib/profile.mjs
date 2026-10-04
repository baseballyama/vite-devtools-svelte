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

/**
 * Origin of a profiled function. Rules look at the package that owns the file
 * (the segment after the last `/node_modules/`) or at a path relative to the
 * workspace, never at the absolute URL: the runner checkout itself lives in a
 * directory named `vite-devtools-svelte`, which must not mark everything as
 * plugin code (review M1), and B/F sides in other directories must bucket alike.
 */
export function bucketOf(name, url) {
  if (!url) return name.startsWith('(') ? name : '(native)'
  // Node internals: `node:…` or bare internal module ids (`modules/esm/utils`)
  if (!/^(file|https?):\/\//.test(url)) return 'node'
  const u = url.replace(/[?#].*$/, '')
  if (u.includes('virtual:svelte-devtools-runtime') || u.includes('svelte-devtools-runtime'))
    return 'plugin-runtime'
  if (u.includes('/.svelte-devtools/')) return 'devtools-ui'
  const nm = u.lastIndexOf('/node_modules/')
  if (nm >= 0) {
    const rest = u.slice(nm + '/node_modules/'.length)
    // Vite's prebundled deps of the app page (svelte's client runtime chunks)
    if (rest.startsWith('.vite/deps/')) return 'svelte-prebundled'
    const parts = rest.split('/')
    const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
    if (pkg === 'vite-devtools-svelte') return 'plugin'
    if (pkg === 'svelte') return 'svelte'
    if (pkg === '@sveltejs/kit') return 'kit'
    if (pkg === '@sveltejs/vite-plugin-svelte') return 'vite-plugin-svelte'
    if (pkg === '@vitejs/devtools' || pkg.includes('devframe')) return 'devframe'
    if (pkg === 'vite' || pkg === 'rolldown' || pkg.startsWith('@rolldown/')) return 'vite'
    return 'deps'
  }
  // workspace file (realpath of the linked plugin, the fixture, Vite's /@fs/)
  if (u.includes('/packages/vite-devtools-svelte/client/')) return 'devtools-ui'
  if (u.includes('/packages/vite-devtools-svelte/')) return 'plugin'
  if (u.includes('/.temp/large-app/') || u.includes('/.temp/reactive-app/')) return 'app'
  // the fixture is the dev server root: /src/… is app code, /@vite/… Vite's client
  if (/^https?:\/\/[^/]+\/src\//.test(u)) return 'app'
  if (/^https?:\/\/[^/]+\/@vite\//.test(u)) return 'vite'
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
