import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { RenderProfile, LoadProfile, FpsSample } from '../types.js'

export interface SessionSnapshot {
  /** componentId -> { renderCount, totalRenderTime } at snapshot moment */
  renderProfiles: Array<{
    componentId: number
    file: string
    name: string
    renderCount: number
    totalRenderTime: number
  }>
  loadProfilesCount: number
  fpsCount: number
  takenAt: number
}

export interface SessionRecord {
  id: string
  label: string
  startedAt: number
  endedAt?: number
  persist: boolean
  startSnapshot: SessionSnapshot
  endSnapshot?: SessionSnapshot
  /** load profiles that arrived strictly between startedAt..endedAt */
  loadProfiles: LoadProfile[]
  /** fps samples that arrived strictly between startedAt..endedAt */
  fpsSamples: FpsSample[]
}

export interface SessionDelta {
  durationMs: number
  components: Array<{
    componentId: number
    file: string
    name: string
    renderCountDelta: number
    totalRenderTimeDelta: number
    avgRenderTimeDelta: number
  }>
  loadProfiles: {
    count: number
    avgDuration: number
    p95Duration: number
  }
  fps: {
    samples: number
    avg: number
    min: number
    drops: number
  }
}

export interface SessionDiff {
  a: { id: string; label: string }
  b: { id: string; label: string }
  render: {
    totalRenderTimeDeltaA: number
    totalRenderTimeDeltaB: number
    diff: number
    verdict: 'improved' | 'regressed' | 'unchanged'
  }
  load: {
    avgA: number
    avgB: number
    diff: number
    verdict: 'improved' | 'regressed' | 'unchanged'
  }
  fps: {
    avgA: number
    avgB: number
    diff: number
    verdict: 'improved' | 'regressed' | 'unchanged'
  }
}

export interface MetricGetters {
  getRenderProfiles: () => RenderProfile[]
  getLoadProfiles: () => LoadProfile[]
  getFpsSamples: () => FpsSample[]
}

const UNCHANGED_RENDER_THRESHOLD_MS = 1
const UNCHANGED_LOAD_THRESHOLD_MS = 5
const UNCHANGED_FPS_THRESHOLD = 1
const FPS_DROP_THRESHOLD = 30

function takeSnapshot(getters: MetricGetters): SessionSnapshot {
  const renderProfiles = getters.getRenderProfiles().map(p => ({
    componentId: p.componentId,
    file: p.file,
    name: p.name,
    renderCount: p.renderCount,
    totalRenderTime: p.totalRenderTime,
  }))
  return {
    renderProfiles,
    loadProfilesCount: getters.getLoadProfiles().length,
    fpsCount: getters.getFpsSamples().length,
    takenAt: Date.now(),
  }
}

function classify(
  diff: number,
  threshold: number,
  lowerIsBetter: boolean,
): 'improved' | 'regressed' | 'unchanged' {
  if (Math.abs(diff) < threshold) return 'unchanged'
  const negativeIsBetter = lowerIsBetter
  if (negativeIsBetter) return diff < 0 ? 'improved' : 'regressed'
  return diff > 0 ? 'improved' : 'regressed'
}

export interface SessionStoreOptions {
  persistDir: string
  getters: MetricGetters
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>()
  private active: string | null = null
  private readonly persistDir: string
  private readonly getters: MetricGetters

  constructor(opts: SessionStoreOptions) {
    this.persistDir = opts.persistDir
    this.getters = opts.getters
  }

  start(label: string, persist: boolean): SessionRecord {
    if (this.active) {
      throw new Error(
        `A session is already active: ${this.active}. Call end_session before starting a new one.`,
      )
    }
    const id = `s_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
    const record: SessionRecord = {
      id,
      label,
      startedAt: Date.now(),
      persist,
      startSnapshot: takeSnapshot(this.getters),
      loadProfiles: [],
      fpsSamples: [],
    }
    this.sessions.set(id, record)
    this.active = id
    return record
  }

  /** Called by the plugin whenever a new load profile arrives. */
  recordLoadProfile(p: LoadProfile): void {
    if (!this.active) return
    const rec = this.sessions.get(this.active)
    if (rec) rec.loadProfiles.push(p)
  }

  /** Called by the plugin whenever a new fps sample arrives. */
  recordFpsSample(s: FpsSample): void {
    if (!this.active) return
    const rec = this.sessions.get(this.active)
    if (rec) rec.fpsSamples.push(s)
  }

  end(keep: 'memory' | 'disk' | 'discard'): SessionRecord {
    if (!this.active) throw new Error('No active session')
    const rec = this.sessions.get(this.active)
    if (!rec) throw new Error('Active session missing from store')
    rec.endedAt = Date.now()
    rec.endSnapshot = takeSnapshot(this.getters)
    this.active = null

    if (keep === 'discard') {
      this.sessions.delete(rec.id)
    } else if (keep === 'disk' || rec.persist) {
      this.persistToDisk(rec)
    }
    return rec
  }

  get(id: string): SessionRecord | undefined {
    const inMem = this.sessions.get(id)
    if (inMem) return inMem
    return this.loadFromDisk(id)
  }

  list(): Array<{
    id: string
    label: string
    startedAt: number
    endedAt?: number
    persisted: boolean
    active: boolean
  }> {
    const seen = new Set<string>()
    const out: Array<{
      id: string
      label: string
      startedAt: number
      endedAt?: number
      persisted: boolean
      active: boolean
    }> = []
    for (const rec of this.sessions.values()) {
      seen.add(rec.id)
      out.push({
        id: rec.id,
        label: rec.label,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        persisted: fs.existsSync(this.pathFor(rec.id)),
        active: this.active === rec.id,
      })
    }
    try {
      if (fs.existsSync(this.persistDir)) {
        for (const name of fs.readdirSync(this.persistDir)) {
          if (!name.endsWith('.json')) continue
          const id = name.slice(0, -5)
          if (seen.has(id)) continue
          try {
            const rec = JSON.parse(fs.readFileSync(path.join(this.persistDir, name), 'utf-8'))
            out.push({
              id: rec.id,
              label: rec.label,
              startedAt: rec.startedAt,
              endedAt: rec.endedAt,
              persisted: true,
              active: false,
            })
          } catch {
            /* skip unreadable session file */
          }
        }
      }
    } catch {
      /* persist dir not accessible */
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }

  delete(id: string): boolean {
    const had = this.sessions.delete(id)
    let onDisk = false
    try {
      const p = this.pathFor(id)
      if (fs.existsSync(p)) {
        fs.unlinkSync(p)
        onDisk = true
      }
    } catch {
      /* ignore */
    }
    if (this.active === id) this.active = null
    return had || onDisk
  }

  delta(id: string): SessionDelta {
    const rec = this.get(id)
    if (!rec) throw new Error(`Session not found: ${id}`)
    if (!rec.endSnapshot || rec.endedAt === undefined) {
      throw new Error(`Session ${id} has not been ended yet`)
    }
    const startMap = new Map(rec.startSnapshot.renderProfiles.map(p => [p.componentId, p]))
    const components = rec.endSnapshot.renderProfiles
      .map(end => {
        const start = startMap.get(end.componentId)
        const startRenderCount = start?.renderCount ?? 0
        const startTotal = start?.totalRenderTime ?? 0
        const renderCountDelta = end.renderCount - startRenderCount
        const totalRenderTimeDelta = end.totalRenderTime - startTotal
        return {
          componentId: end.componentId,
          file: end.file,
          name: end.name,
          renderCountDelta,
          totalRenderTimeDelta,
          avgRenderTimeDelta: renderCountDelta > 0 ? totalRenderTimeDelta / renderCountDelta : 0,
        }
      })
      .filter(c => c.renderCountDelta > 0)
      .sort((a, b) => b.totalRenderTimeDelta - a.totalRenderTimeDelta)

    const loadDurations = rec.loadProfiles.map(l => l.duration)
    const loadAvg = avg(loadDurations)
    const loadP95 = percentile(loadDurations, 95)

    const fpsValues = rec.fpsSamples.map(s => s.fps)
    const fpsAvg = avg(fpsValues)
    const fpsMin = fpsValues.length ? Math.min(...fpsValues) : 0
    const fpsDrops = fpsValues.filter(f => f < FPS_DROP_THRESHOLD).length

    return {
      durationMs: rec.endedAt - rec.startedAt,
      components,
      loadProfiles: { count: rec.loadProfiles.length, avgDuration: loadAvg, p95Duration: loadP95 },
      fps: { samples: fpsValues.length, avg: fpsAvg, min: fpsMin, drops: fpsDrops },
    }
  }

  compare(idA: string, idB: string): SessionDiff {
    const a = this.delta(idA)
    const b = this.delta(idB)
    const recA = this.get(idA)!
    const recB = this.get(idB)!
    const totalA = a.components.reduce((s, c) => s + c.totalRenderTimeDelta, 0)
    const totalB = b.components.reduce((s, c) => s + c.totalRenderTimeDelta, 0)
    const renderDiff = totalB - totalA
    const loadDiff = b.loadProfiles.avgDuration - a.loadProfiles.avgDuration
    const fpsDiff = b.fps.avg - a.fps.avg
    return {
      a: { id: recA.id, label: recA.label },
      b: { id: recB.id, label: recB.label },
      render: {
        totalRenderTimeDeltaA: totalA,
        totalRenderTimeDeltaB: totalB,
        diff: renderDiff,
        verdict: classify(renderDiff, UNCHANGED_RENDER_THRESHOLD_MS, true),
      },
      load: {
        avgA: a.loadProfiles.avgDuration,
        avgB: b.loadProfiles.avgDuration,
        diff: loadDiff,
        verdict: classify(loadDiff, UNCHANGED_LOAD_THRESHOLD_MS, true),
      },
      fps: {
        avgA: a.fps.avg,
        avgB: b.fps.avg,
        diff: fpsDiff,
        verdict: classify(fpsDiff, UNCHANGED_FPS_THRESHOLD, false),
      },
    }
  }

  private pathFor(id: string): string {
    return path.join(this.persistDir, `${id}.json`)
  }

  private persistToDisk(rec: SessionRecord): void {
    try {
      fs.mkdirSync(this.persistDir, { recursive: true })
      fs.writeFileSync(this.pathFor(rec.id), JSON.stringify(rec, null, 2), { mode: 0o600 })
    } catch {
      /* persist failure is non-fatal; the in-memory record stays available */
    }
  }

  private loadFromDisk(id: string): SessionRecord | undefined {
    try {
      const raw = fs.readFileSync(this.pathFor(id), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
}

function avg(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}
