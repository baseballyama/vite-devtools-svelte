import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Session ids come from MCP clients and become file names (review C-7): only
 * the issued `s_<base36>_<hex6>` shape may reach the disk. No file outside the
 * temp persist dir is created; escaping ids must be rejected before any fs
 * access, which the fs spies check.
 */
import * as fc from 'fast-check'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import { SessionStore, isSessionId } from '../src/mcp/sessions.js'
import type { FpsSample, LoadProfile, RenderProfile } from '../src/types.js'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function store() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-sessions-'))
  dirs.push(base)
  const persistDir = path.join(base, 'sessions')
  const s = new SessionStore({
    persistDir,
    getters: { getRenderProfiles: () => [], getLoadProfiles: () => [], getFpsSamples: () => [] },
  })
  return { s, persistDir }
}

const MALFORMED = [
  '',
  '..',
  '../x',
  '../../etc/passwd',
  '..\\x',
  '/abs/path',
  'C:\\x',
  's_abc_123456/../../x',
  's_abc_12345',
  's_abc_1234567',
  's_ABC_123456',
  's__123456',
  's_abc_12345g',
  'x_abc_123456',
  's_abc_123456\0',
  's_abc_123456.json',
  ' s_abc_123456',
]

describe('session ids', () => {
  it('accepts exactly the shape start() issues', () => {
    const { s } = store()
    const rec = s.start('a', false)
    expect(isSessionId(rec.id)).toBe(true)
    for (const id of MALFORMED) expect({ id, valid: isSessionId(id) }).toEqual({ id, valid: false })
  })

  it('rejects malformed and escaping ids in get/delete/compare before touching the disk', () => {
    const { s } = store()
    const read = vi.spyOn(fs, 'readFileSync')
    const exists = vi.spyOn(fs, 'existsSync')
    const unlink = vi.spyOn(fs, 'unlinkSync')
    for (const id of MALFORMED) {
      expect({ id, got: s.get(id), deleted: s.delete(id) }).toEqual({
        id,
        got: undefined,
        deleted: false,
      })
      expect(() => s.compare(id, id)).toThrow(`Session not found: ${id}`)
    }
    expect(read).not.toHaveBeenCalled()
    expect(exists).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('keeps legitimate persistence working: end to disk, load from a new store, list, delete', () => {
    const { s, persistDir } = store()
    const rec = s.start('baseline', true)
    s.end('disk')
    expect(fs.readdirSync(persistDir)).toEqual([`${rec.id}.json`])

    const again = new SessionStore({
      persistDir,
      getters: { getRenderProfiles: () => [], getLoadProfiles: () => [], getFpsSamples: () => [] },
    })
    expect(again.get(rec.id)?.label).toBe('baseline')
    expect(again.list().map(r => r.id)).toEqual([rec.id])
    expect(again.delete(rec.id)).toBe(true)
    expect(fs.readdirSync(persistDir)).toEqual([])
  })

  it('does not list or load files whose name or content is not a valid id', () => {
    const { s, persistDir } = store()
    fs.mkdirSync(persistDir, { recursive: true })
    fs.writeFileSync(
      path.join(persistDir, 'notes.json'),
      JSON.stringify({ id: 'notes', startedAt: 1 }),
    )
    // valid file name, but the content claims another id
    fs.writeFileSync(
      path.join(persistDir, 's_abc_123456.json'),
      JSON.stringify({ id: '../escape', label: 'x', startedAt: 1 }),
    )
    expect(s.list()).toEqual([])
    expect(s.get('s_abc_123456')).toBeUndefined()
  })
})

// =====================================================================
// Lifecycle, delta / compare maths, persistence
// =====================================================================

interface Metrics {
  render: RenderProfile[]
  load: LoadProfile[]
  fps: FpsSample[]
}

function liveStore(persistDir?: string) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-sessions-'))
  dirs.push(base)
  const metrics: Metrics = { render: [], load: [], fps: [] }
  const dir = persistDir ?? path.join(base, 'sessions')
  const s = new SessionStore({
    persistDir: dir,
    getters: {
      getRenderProfiles: () => metrics.render,
      getLoadProfiles: () => metrics.load,
      getFpsSamples: () => metrics.fps,
    },
  })
  return { s, metrics, persistDir: dir }
}

const rp = (componentId: number, renderCount: number, totalRenderTime: number): RenderProfile => ({
  componentId,
  file: `/C${componentId}.svelte`,
  name: `C${componentId}`,
  initTime: 0,
  renderCount,
  totalRenderTime,
  lastRenderTime: 0,
  lastRenderAt: 0,
})
const lp = (duration: number): LoadProfile => ({
  route: '/',
  file: '/+page.ts',
  type: 'universal',
  duration,
  dataSize: 0,
  timestamp: 0,
})

/** Run one session: metrics before, `during` (records), metrics after. */
function session(
  st: ReturnType<typeof liveStore>,
  opts: {
    label?: string
    before?: RenderProfile[]
    after?: RenderProfile[]
    loads?: number[]
    fps?: number[]
    ms?: number
    keep?: 'memory' | 'disk' | 'discard'
    persist?: boolean
  } = {},
) {
  st.metrics.render = opts.before ?? []
  const rec = st.s.start(opts.label ?? 'x', opts.persist ?? false)
  for (const d of opts.loads ?? []) st.s.recordLoadProfile(lp(d))
  for (const f of opts.fps ?? []) st.s.recordFpsSample({ timestamp: 0, fps: f })
  vi.advanceTimersByTime(opts.ms ?? 1000)
  st.metrics.render = opts.after ?? []
  st.s.end(opts.keep ?? 'memory')
  return rec.id
}

describe('session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('start → end records times, snapshots and only samples recorded while active', () => {
    const st = liveStore()
    st.s.recordFpsSample({ timestamp: 1, fps: 1 }) // before start: dropped
    st.s.recordLoadProfile(lp(1))
    const rec = st.s.start('run', false)
    expect(rec).toMatchObject({ label: 'run', startedAt: 1_700_000_000_000, persist: false })
    expect(st.s.list()).toEqual([
      expect.objectContaining({ id: rec.id, active: true, persisted: false }),
    ])
    st.s.recordFpsSample({ timestamp: 2, fps: 50 })
    st.s.recordLoadProfile(lp(7))
    vi.advanceTimersByTime(250)
    const ended = st.s.end('memory')
    st.s.recordFpsSample({ timestamp: 3, fps: 1 }) // after end: dropped
    expect(ended.endedAt).toBe(1_700_000_000_250)
    expect(ended.fpsSamples).toEqual([{ timestamp: 2, fps: 50 }])
    expect(ended.loadProfiles).toEqual([lp(7)])
    expect(st.s.delta(rec.id).durationMs).toBe(250)
    expect(st.s.list()[0]).toMatchObject({ active: false })
  })

  it('refuses a second active session and an end without a session', () => {
    const st = liveStore()
    expect(() => st.s.end('memory')).toThrow('No active session')
    const rec = st.s.start('a', false)
    expect(() => st.s.start('b', false)).toThrow(`A session is already active: ${rec.id}`)
  })

  it('delta() refuses a session that has not ended', () => {
    const st = liveStore()
    const rec = st.s.start('a', false)
    expect(() => st.s.delta(rec.id)).toThrow(`Session ${rec.id} has not been ended yet`)
    expect(() => st.s.delta('s_zz_000000')).toThrow('Session not found: s_zz_000000')
  })

  it.each<[keep: 'memory' | 'disk' | 'discard', persist: boolean, kept: boolean, onDisk: boolean]>([
    ['memory', false, true, false],
    ['memory', true, true, true], // persist:true at start writes on end
    ['disk', false, true, true],
    ['disk', true, true, true],
    ['discard', false, false, false],
    ['discard', true, false, false], // discard wins over persist
  ])('end(%s) with persist=%s: kept %s, on disk %s', (keep, persist, kept, onDisk) => {
    const st = liveStore()
    const id = session(st, { keep, persist })
    expect(fs.existsSync(path.join(st.persistDir, `${id}.json`))).toBe(onDisk)
    expect(st.s.list().some(r => r.id === id)).toBe(kept)
    expect(st.s.get(id) !== undefined).toBe(kept)
  })

  it('a session file is readable by the owner only', () => {
    const st = liveStore()
    const id = session(st, { keep: 'disk' })
    expect(fs.statSync(path.join(st.persistDir, `${id}.json`)).mode & 0o777).toBe(0o600)
  })

  it('end() returns the record, whose delta stays available after discard', () => {
    const st = liveStore()
    st.s.start('gone', false)
    st.s.recordFpsSample({ timestamp: 0, fps: 20 })
    const rec = st.s.end('discard')
    expect(st.s.get(rec.id)).toBeUndefined()
    expect(st.s.deltaOf(rec).fps).toEqual({ samples: 1, avg: 20, min: 20, drops: 1 })
  })

  it('a disk write failure keeps the session in memory', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-sessions-'))
    dirs.push(base)
    const blocker = path.join(base, 'file')
    fs.writeFileSync(blocker, '') // persistDir below a regular file: mkdir fails
    const st = liveStore(path.join(blocker, 'sessions'))
    const id = session(st, { keep: 'disk' })
    expect(st.s.get(id)?.endedAt).toBeDefined()
    expect(st.s.list()).toEqual([expect.objectContaining({ id, persisted: false })])
  })

  it('delete() removes memory and disk copies and clears the active session', () => {
    const st = liveStore()
    const id = session(st, { keep: 'disk' })
    expect(st.s.delete(id)).toBe(true)
    expect(st.s.delete(id)).toBe(false)
    const active = st.s.start('a', false)
    expect(st.s.delete(active.id)).toBe(true)
    expect(() => st.s.end('memory')).toThrow('No active session')
    st.s.start('b', false) // a new session may start
  })

  it('list() is newest first, merging memory and disk without duplicates', () => {
    const st = liveStore()
    const a = session(st, { label: 'a', keep: 'disk' })
    vi.advanceTimersByTime(10)
    const b = session(st, { label: 'b' })
    vi.advanceTimersByTime(10)
    const c = session(st, { label: 'c', keep: 'disk' })
    // a fresh store sees only the persisted ones
    const fresh = new SessionStore({
      persistDir: st.persistDir,
      getters: { getRenderProfiles: () => [], getLoadProfiles: () => [], getFpsSamples: () => [] },
    })
    expect(st.s.list().map(r => [r.label, r.persisted])).toEqual([
      ['c', true],
      ['b', false],
      ['a', true],
    ])
    expect(fresh.list().map(r => r.id)).toEqual([c, a])
    expect(b).toBeTruthy()
  })

  it('list() skips a persist directory it cannot read', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-sessions-'))
    dirs.push(base)
    const notDir = path.join(base, 'sessions')
    fs.writeFileSync(notDir, '') // exists, but readdir fails
    const st = liveStore(notDir)
    expect(st.s.list()).toEqual([])
  })
})

function withFile(content: unknown) {
  const st = liveStore()
  fs.mkdirSync(st.persistDir, { recursive: true })
  fs.writeFileSync(
    path.join(st.persistDir, 's_abc_123456.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  )
  return st.s
}

describe('persisted session files', () => {
  const valid = {
    id: 's_abc_123456',
    label: 'disk',
    startedAt: 10,
    endedAt: 20,
    persist: true,
    startSnapshot: { renderProfiles: [], loadProfilesCount: 0, fpsCount: 0, takenAt: 10 },
    endSnapshot: {
      renderProfiles: [
        { componentId: 1, file: '/A.svelte', name: 'A', renderCount: 2, totalRenderTime: 6 },
      ],
      loadProfilesCount: 0,
      fpsCount: 0,
      takenAt: 20,
    },
    loadProfiles: [lp(10)],
    fpsSamples: [{ timestamp: 1, fps: 60 }],
  }
  it('a complete file loads, lists and diffs; extra fields are kept', () => {
    const s = withFile({ ...valid, extra: 'x' })
    expect(s.get('s_abc_123456')).toMatchObject({ label: 'disk', extra: 'x' })
    expect(s.list()).toEqual([
      {
        id: 's_abc_123456',
        label: 'disk',
        startedAt: 10,
        endedAt: 20,
        persisted: true,
        active: false,
      },
    ])
    expect(s.delta('s_abc_123456')).toMatchObject({
      durationMs: 10,
      components: [
        { componentId: 1, renderCountDelta: 2, totalRenderTimeDelta: 6, avgRenderTimeDelta: 3 },
      ],
    })
  })

  it('an unended persisted session loads without a delta', () => {
    const { endedAt: _e, endSnapshot: _s, ...open } = valid
    const s = withFile(open)
    expect(s.get('s_abc_123456')?.endedAt).toBeUndefined()
    expect(() => s.delta('s_abc_123456')).toThrow('has not been ended yet')
  })

  it.each<[label: string, content: unknown]>([
    ['corrupted JSON', '{"id": "s_abc_123456", '],
    ['JSON null', 'null'],
    ['missing label', { ...valid, label: undefined }],
    ['startedAt not a number', { ...valid, startedAt: '10' }],
    ['endedAt not a number', { ...valid, endedAt: null }],
    ['missing startSnapshot', { ...valid, startSnapshot: undefined }],
    [
      'malformed render profile',
      { ...valid, startSnapshot: { renderProfiles: [{ componentId: 1 }] } },
    ],
    ['endSnapshot without profiles', { ...valid, endSnapshot: {} }],
    ['missing loadProfiles', { ...valid, loadProfiles: undefined }],
    ['malformed load profile', { ...valid, loadProfiles: [{ duration: 'slow' }] }],
    ['malformed fps sample', { ...valid, fpsSamples: [null] }],
    ['other id', { ...valid, id: 's_def_123456' }],
  ])('a file with %s is neither loaded nor listed', (_label, content) => {
    const s = withFile(content)
    expect(s.get('s_abc_123456')).toBeUndefined()
    expect(s.list()).toEqual([])
    expect(() => s.delta('s_abc_123456')).toThrow('Session not found')
  })
})

describe('delta() maths', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('an empty session is all zeros', () => {
    const st = liveStore()
    const id = session(st, { ms: 0 })
    expect(st.s.delta(id)).toEqual({
      durationMs: 0,
      components: [],
      loadProfiles: { count: 0, avgDuration: 0, p95Duration: 0 },
      fps: { samples: 0, avg: 0, min: 0, drops: 0 },
    })
  })

  it('component deltas: increases only, new components counted in full, sorted by time', () => {
    const st = liveStore()
    const id = session(st, {
      before: [rp(1, 10, 100), rp(2, 5, 50), rp(3, 4, 40), rp(5, 9, 9)],
      after: [rp(1, 12, 110), rp(2, 5, 50), rp(3, 1, 4), rp(4, 3, 30)],
      // 1: +2 renders / +10 ms; 2: unchanged; 3: remounted (count dropped);
      // 4: new; 5: unmounted
    })
    expect(st.s.delta(id).components).toEqual([
      {
        componentId: 4,
        file: '/C4.svelte',
        name: 'C4',
        renderCountDelta: 3,
        totalRenderTimeDelta: 30,
        avgRenderTimeDelta: 10,
      },
      {
        componentId: 1,
        file: '/C1.svelte',
        name: 'C1',
        renderCountDelta: 2,
        totalRenderTimeDelta: 10,
        avgRenderTimeDelta: 5,
      },
    ])
  })

  it.each<[durations: number[], avg: number, p95: number]>([
    [[10], 10, 10],
    [[10, 20], 15, 20],
    [Array.from({ length: 20 }, (_, i) => i + 1), 10.5, 19], // nearest rank: 19th of 20
    [Array.from({ length: 100 }, (_, i) => 100 - i), 50.5, 95],
    [[5, 5, 5], 5, 5],
  ])('load durations %j → avg %f, p95 %f', (durations, avg, p95) => {
    const st = liveStore()
    const id = session(st, { loads: durations })
    expect(st.s.delta(id).loadProfiles).toEqual({
      count: durations.length,
      avgDuration: avg,
      p95Duration: p95,
    })
  })

  it('p95 is the nearest-rank percentile (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 60 }),
        xs => {
          const st = liveStore()
          const id = session(st, { loads: xs })
          const p95 = st.s.delta(id).loadProfiles.p95Duration
          const atOrBelow = xs.filter(x => x <= p95).length
          expect(atOrBelow / xs.length).toBeGreaterThanOrEqual(0.95)
          // smallest such value: fewer than 95% are strictly below it
          expect(xs.filter(x => x < p95).length / xs.length).toBeLessThan(0.95)
          expect(xs).toContain(p95)
        },
      ),
      { numRuns: 100 },
    )
  })

  it.each<[fps: number[], expected: { avg: number; min: number; drops: number }]>([
    [[60, 30, 29.9, 0], { avg: 29.975, min: 0, drops: 2 }], // drop = strictly below 30
    [[30], { avg: 30, min: 30, drops: 0 }],
  ])('fps %j', (values, expected) => {
    const st = liveStore()
    const id = session(st, { fps: values })
    expect(st.s.delta(id).fps).toEqual({ samples: values.length, ...expected })
  })

  it('handles more fps samples than fit in a call stack', () => {
    const st = liveStore()
    st.s.start('long', false)
    for (let i = 0; i < 300_000; i++) st.s.recordFpsSample({ timestamp: i, fps: 60 - (i % 3) })
    const rec = st.s.end('memory')
    expect(st.s.delta(rec.id).fps).toMatchObject({ samples: 300_000, min: 58 })
  })
})

/** Two sessions: render total time a / b, load avg a / b, fps avg a / b. */
function pair(a: [number, number, number], b: [number, number, number]) {
  const st = liveStore()
  const mk = (label: string, [render, loadMs, fpsAvg]: [number, number, number]) =>
    session(st, {
      label,
      before: [],
      after: render > 0 ? [rp(1, 1, render)] : [],
      loads: loadMs > 0 ? [loadMs] : [],
      fps: fpsAvg > 0 ? [fpsAvg] : [],
    })
  const idA = mk('A', a)
  const idB = mk('B', b)
  return st.s.compare(idA, idB)
}

describe('compare()', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each<
    [label: string, a: [number, number, number], b: [number, number, number], verdicts: string[]]
  >([
    ['identical', [10, 100, 60], [10, 100, 60], ['unchanged', 'unchanged', 'unchanged']],
    ['B faster everywhere', [10, 100, 30], [5, 50, 60], ['improved', 'improved', 'improved']],
    ['B slower everywhere', [5, 50, 60], [10, 100, 30], ['regressed', 'regressed', 'regressed']],
    // thresholds: render < 1 ms, load < 5 ms, fps < 1 are unchanged; exactly at the threshold counts
    [
      'just under thresholds',
      [10, 100, 60],
      [10.99, 104.99, 59.01],
      ['unchanged', 'unchanged', 'unchanged'],
    ],
    ['at thresholds', [10, 100, 60], [11, 105, 59], ['regressed', 'regressed', 'regressed']],
    ['at thresholds, better', [11, 105, 59], [10, 100, 60], ['improved', 'improved', 'improved']],
    // a metric in only one session compares against 0
    ['metrics only in A', [10, 100, 60], [0, 0, 0], ['improved', 'improved', 'regressed']],
    ['metrics only in B', [0, 0, 0], [10, 100, 60], ['regressed', 'regressed', 'improved']],
    ['both empty', [0, 0, 0], [0, 0, 0], ['unchanged', 'unchanged', 'unchanged']],
  ])('%s', (_label, a, b, verdicts) => {
    const diff = pair(a, b)
    expect([diff.render.verdict, diff.load.verdict, diff.fps.verdict]).toEqual(verdicts)
    expect(diff.render).toMatchObject({ totalRenderTimeDeltaA: a[0], totalRenderTimeDeltaB: b[0] })
    expect(diff.render.diff).toBeCloseTo(b[0] - a[0])
    expect(diff.load).toMatchObject({ avgA: a[1], avgB: b[1] })
    expect(diff.load.diff).toBeCloseTo(b[1] - a[1])
    expect(diff.fps).toMatchObject({ avgA: a[2], avgB: b[2] })
    expect(diff.fps.diff).toBeCloseTo(b[2] - a[2])
    expect([diff.a.label, diff.b.label]).toEqual(['A', 'B'])
  })

  it('refuses unknown or unended sessions', () => {
    const st = liveStore()
    const ended = session(st)
    expect(() => st.s.compare(ended, 's_zz_000000')).toThrow('Session not found: s_zz_000000')
    const open = st.s.start('open', false)
    expect(() => st.s.compare(ended, open.id)).toThrow('has not been ended yet')
  })
})
