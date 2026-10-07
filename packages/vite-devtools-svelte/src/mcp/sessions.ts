import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { RenderProfile, LoadProfile, FpsSample } from '../types.js'
import { avg, min } from './stats.js'

interface SessionSnapshot {
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

type Verdict = 'improved' | 'regressed' | 'unchanged'

export interface SessionDiff {
  a: { id: string; label: string }
  b: { id: string; label: string }
  render: {
    totalRenderTimeDeltaA: number
    totalRenderTimeDeltaB: number
    diff: number
    verdict: Verdict
  }
  load: { avgA: number; avgB: number; diff: number; verdict: Verdict }
  fps: { avgA: number; avgB: number; diff: number; verdict: Verdict }
}

interface SessionSummary {
  id: string
  label: string
  startedAt: number
  endedAt?: number
  persisted: boolean
  active: boolean
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

/** How `b` compares to `a` given `diff = b - a`. */
function classify(diff: number, threshold: number, lowerIsBetter: boolean): Verdict {
  if (Math.abs(diff) < threshold) return 'unchanged'
  return diff < 0 === lowerIsBetter ? 'improved' : 'regressed'
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'
const HEX = '0123456789abcdef'
function consistsOf(s: string, chars: string): boolean {
  for (const c of s) if (!chars.includes(c)) return false
  return true
}

/**
 * Whether `id` has the only shape `start()` issues: `s_<Date.now() base36>_<6
 * hex>`. Ids reach the store from MCP clients and become file names, so
 * anything else (path separators, `..`, absolute paths) is rejected before
 * touching disk (review C-7).
 */
export function isSessionId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  const parts = id.split('_')
  if (parts.length !== 3 || parts[0] !== 's') return false
  const [, time = '', random = ''] = parts
  return (
    time.length > 0 &&
    time.length <= 16 &&
    consistsOf(time, BASE36) &&
    random.length === 6 &&
    consistsOf(random, HEX)
  )
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
    this.persistDir = path.resolve(opts.persistDir)
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

  private get activeRecord(): SessionRecord | undefined {
    return this.active === null ? undefined : this.sessions.get(this.active)
  }

  /** Called by the plugin whenever a new load profile arrives. */
  recordLoadProfile(p: LoadProfile): void {
    this.activeRecord?.loadProfiles.push(p)
  }

  /** Called by the plugin whenever a new fps sample arrives. */
  recordFpsSample(s: FpsSample): void {
    this.activeRecord?.fpsSamples.push(s)
  }

  end(keep: 'memory' | 'disk' | 'discard'): SessionRecord {
    if (!this.active) throw new Error('No active session')
    const rec = this.activeRecord
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
    if (!isSessionId(id)) return undefined
    return this.sessions.get(id) ?? this.loadFromDisk(id)
  }

  list(): SessionSummary[] {
    const summary = (rec: SessionRecord, persisted: boolean): SessionSummary => ({
      id: rec.id,
      label: rec.label,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      persisted,
      active: this.active === rec.id,
    })
    const out = [...this.sessions.values()].map(rec =>
      summary(rec, fs.existsSync(this.pathFor(rec.id))),
    )
    try {
      for (const name of fs.readdirSync(this.persistDir)) {
        if (!name.endsWith('.json')) continue
        const id = name.slice(0, -'.json'.length)
        if (!isSessionId(id) || this.sessions.has(id)) continue
        // Unreadable files, and files whose content claims another id, are skipped.
        const rec = this.loadFromDisk(id)
        if (rec) out.push(summary(rec, true))
      }
    } catch {
      /* persist dir missing or not accessible */
    }
    return out.toSorted((a, b) => b.startedAt - a.startedAt)
  }

  delete(id: string): boolean {
    if (!isSessionId(id)) return false
    const had = this.sessions.delete(id)
    let onDisk = false
    try {
      fs.unlinkSync(this.pathFor(id))
      onDisk = true
    } catch {
      /* not on disk */
    }
    if (this.active === id) this.active = null
    return had || onDisk
  }

  /**
   * The delta of a record in hand. `end('discard')` removes the record from
   * the store, so end_session must not look it up again by id (it used to,
   * and failed with "Session not found" for every discarded session).
   */
  deltaOf(rec: SessionRecord): SessionDelta {
    if (!rec.endSnapshot || rec.endedAt === undefined) {
      throw new Error(`Session ${rec.id} has not been ended yet`)
    }
    const startMap = new Map(rec.startSnapshot.renderProfiles.map(p => [p.componentId, p]))
    const components = rec.endSnapshot.renderProfiles
      .map(end => {
        const start = startMap.get(end.componentId)
        const renderCountDelta = end.renderCount - (start?.renderCount ?? 0)
        const totalRenderTimeDelta = end.totalRenderTime - (start?.totalRenderTime ?? 0)
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
      .toSorted((a, b) => b.totalRenderTimeDelta - a.totalRenderTimeDelta)

    const loadDurations = rec.loadProfiles.map(l => l.duration)
    const fpsValues = rec.fpsSamples.map(s => s.fps)
    return {
      durationMs: rec.endedAt - rec.startedAt,
      components,
      loadProfiles: {
        count: rec.loadProfiles.length,
        avgDuration: avg(loadDurations),
        p95Duration: percentile(loadDurations, 95),
      },
      fps: {
        samples: fpsValues.length,
        avg: avg(fpsValues),
        min: min(fpsValues, 0),
        drops: fpsValues.filter(f => f < FPS_DROP_THRESHOLD).length,
      },
    }
  }

  delta(id: string): SessionDelta {
    return this.deltaOf(this.found(id))
  }

  private found(id: string): SessionRecord {
    const rec = this.get(id)
    if (!rec) throw new Error(`Session not found: ${id}`)
    return rec
  }

  compare(idA: string, idB: string): SessionDiff {
    const recA = this.found(idA)
    const recB = this.found(idB)
    const a = this.deltaOf(recA)
    const b = this.deltaOf(recB)
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

  /** The session's file, guaranteed to be a direct child of `persistDir`. */
  private pathFor(id: string): string {
    if (!isSessionId(id)) throw new Error('Invalid session id')
    const file = path.resolve(this.persistDir, `${id}.json`)
    if (path.dirname(file) !== this.persistDir) throw new Error('Invalid session id')
    return file
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
      const rec: unknown = JSON.parse(raw)
      // A file whose content claims another id is not served under this one;
      // one missing fields deltaOf()/list() read is not served at all (it used
      // to crash them with a TypeError).
      return isRecordShape(rec) && rec.id === id ? rec : undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Nearest-rank percentile: the smallest value with at least `p`% of the
 * values at or below it. (`floor(p/100 * n)` used before was one rank too
 * high: the p95 of 20 values was the maximum.)
 */
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = xs.toSorted((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]!
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isSnapshot(v: unknown): v is SessionSnapshot {
  return (
    isObject(v) &&
    Array.isArray(v.renderProfiles) &&
    v.renderProfiles.every(
      p =>
        isObject(p) &&
        isNum(p.componentId) &&
        typeof p.file === 'string' &&
        typeof p.name === 'string' &&
        isNum(p.renderCount) &&
        isNum(p.totalRenderTime),
    )
  )
}

/** The fields a persisted session must carry to be listed, loaded and diffed. */
function isRecordShape(v: unknown): v is SessionRecord {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    isNum(v.startedAt) &&
    (v.endedAt === undefined || isNum(v.endedAt)) &&
    isSnapshot(v.startSnapshot) &&
    (v.endSnapshot === undefined || isSnapshot(v.endSnapshot)) &&
    Array.isArray(v.loadProfiles) &&
    v.loadProfiles.every(l => isObject(l) && isNum(l.duration)) &&
    Array.isArray(v.fpsSamples) &&
    v.fpsSamples.every(s => isObject(s) && isNum(s.fps))
  )
}
