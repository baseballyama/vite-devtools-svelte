import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Collector,
  HOT_EVENTS,
  LEASE_TTL,
  LIMITS,
  RUNTIME_REQUEST_TIMEOUT,
  MAX_EPOCHS,
  PULL_FRESHNESS,
  STATE_TIMELINE_BYTES,
} from '../collector.js'
import type { HotChannel, HotClient } from '../collector.js'

function fakeHot() {
  const listeners = new Map<string, (payload: any, client: HotClient) => void>()
  const sent: Array<{ event: string; payload: unknown }> = []
  const hot: HotChannel = {
    send: (event, payload) => sent.push({ event, payload }),
    on: (event, listener) => listeners.set(event, listener),
    off: event => listeners.delete(event),
  }
  const emit = (event: string, payload: unknown, client?: HotClient) =>
    listeners.get(event)?.(payload, client ?? { send: () => {} })
  return { hot, sent, listeners, emit }
}

const change = (i: number, extra: object = {}) => ({
  id: `n${i}`,
  name: `s${i}`,
  componentFile: '/App.svelte',
  oldValue: i - 1,
  newValue: i,
  timestamp: 1000 + i,
  ...extra,
})

describe('Collector ingestion caps', () => {
  it('keeps the head of live components (parents first) and reports the total', () => {
    const c = new Collector()
    const total = LIMITS.liveComponents + 10
    c.ingestComponents({ components: Array.from({ length: total }, (_, i) => ({ id: i })) })
    expect(c.liveComponents).toHaveLength(LIMITS.liveComponents)
    expect((c.liveComponents[0] as any).id).toBe(0) // root survives
    expect(c.liveComponentsTotal).toBe(total)
  })

  it('accepts more than 5000 components (huge apps)', () => {
    const c = new Collector()
    c.ingestComponents({ components: Array.from({ length: 12_000 }, (_, i) => ({ id: i })) })
    expect(c.liveComponents).toHaveLength(12_000)
  })

  it('caps render profiles (tail), reactive graph (head), fps, errors, loads, warnings', () => {
    const c = new Collector()
    c.ingestProfiles({ profiles: Array.from({ length: 6000 }, (_, i) => ({ i })) })
    expect(c.renderProfiles).toHaveLength(LIMITS.renderProfiles)
    expect((c.renderProfiles.at(-1) as any).i).toBe(5999)

    // Edges are kept only between kept nodes, then capped (§6.7 A).
    c.ingestReactiveGraph({
      nodes: Array.from({ length: 6000 }, (_, i) => ({ id: String(i) })) as any,
      edges: Array.from({ length: 25000 }, (_, i) => ({
        from: String(i % 4000),
        to: String((i + 1) % 4000),
      })) as any,
    })
    expect(c.reactiveGraph.nodes).toHaveLength(LIMITS.reactiveNodes)
    expect(c.reactiveGraph.edges).toHaveLength(LIMITS.reactiveEdges)
    expect(c.getCaptureInfo().reactiveNodes).toMatchObject({
      captured: LIMITS.reactiveNodes,
      total: 6000,
      truncated: true,
    })
    expect(c.getCaptureInfo().reactiveEdges).toMatchObject({
      captured: LIMITS.reactiveEdges,
      total: 25000,
      truncated: true,
    })

    for (let i = 0; i < 1300; i++) c.ingestFps({ fps: i } as any)
    expect(c.fpsSamples).toHaveLength(LIMITS.fpsSamples)
    expect((c.fpsSamples.at(-1) as any).fps).toBe(1299)

    for (let i = 0; i < 250; i++) c.ingestRuntimeError({ message: String(i) } as any)
    expect(c.runtimeErrors).toHaveLength(LIMITS.runtimeErrors)
    expect(c.runtimeErrors.at(-1)!.message).toBe('249')

    for (let i = 0; i < 250; i++) c.recordLoadProfile({ route: String(i) } as any)
    expect(c.loadProfiles).toHaveLength(LIMITS.loadProfiles)

    for (let i = 0; i < 600; i++) c.recordCompilerWarning({ code: String(i) } as any)
    expect(c.compilerWarnings).toHaveLength(LIMITS.compilerWarnings)
  })

  it('treats non-array payloads as empty without throwing', () => {
    const c = new Collector()
    c.ingestComponents({ components: 'nope' })
    c.ingestProfiles(undefined)
    c.ingestStateTimeline({ changes: 42 })
    c.ingestReactiveGraph({ nodes: null as any, edges: {} as any })
    expect(c.liveComponents).toEqual([])
    expect(c.renderProfiles).toEqual([])
    expect(c.stateTimeline).toEqual([])
    expect(c.reactiveGraph).toEqual({ nodes: [], edges: [] })
  })

  it('bumps per-dataset versions on ingest and clear', () => {
    const c = new Collector()
    const before = { ...c.versions }
    c.ingestComponents({ components: [] })
    c.ingestRuntimeError({ message: 'x' } as any)
    c.clearFps()
    // versions are opaque change tokens: they move on change, stay put otherwise
    expect(c.versions.components).not.toBe(before.components)
    expect(c.versions.errors).not.toBe(before.errors)
    expect(c.versions.fps).not.toBe(before.fps)
    expect(c.versions.renderProfiles).toBe(before.renderProfiles)
  })

  it('B1: a new collector (restarted server) never reports a version a client already saw', () => {
    const old = new Collector()
    for (let i = 0; i < 5; i++) old.ingestComponents({ epoch: 'a', components: [] })
    const seen = new Set(Object.values(old.versions))
    const fresh = new Collector()
    for (let i = 0; i < 5; i++) fresh.ingestComponents({ epoch: 'b', components: [] })
    for (const v of Object.values(fresh.versions)) expect(seen.has(v)).toBe(false)
  })

  it('another app tab takes over only with a component snapshot; then both versions move', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'tab1', components: [] })
    const before = { ...c.versions }
    c.ingestStateTimeline({ epoch: 'tab2', changes: [change(1)] })
    c.ingestProfiles({ epoch: 'tab2', profiles: [] })
    expect(c.epochInfo.epoch).toBe('tab1') // B1: no base yet → not served
    expect(c.versions.components).toBe(before.components)
    c.ingestComponents({ epoch: 'tab2', components: [] })
    expect(c.epochInfo.epoch).toBe('tab2')
    expect(c.versions.components).not.toBe(before.components)
    expect(c.versions.renderProfiles).not.toBe(before.renderProfiles)
  })

  it('forwards fps samples and load profiles to hooks (measurement sessions)', () => {
    const onFpsSample = vi.fn()
    const onLoadProfile = vi.fn()
    const c = new Collector({ onFpsSample, onLoadProfile })
    c.ingestFps({ fps: 60 } as any)
    c.recordLoadProfile({ route: '/' } as any)
    expect(onFpsSample).toHaveBeenCalledOnce()
    expect(onLoadProfile).toHaveBeenCalledOnce()
  })
})

describe('Collector component deltas + per-epoch state (§6.5)', () => {
  const comp = (id: number, parentId: number | null = null) => ({
    id,
    file: '/C.svelte',
    name: `C${id}`,
    parentId,
    mounted: true,
  })

  it('applies the delta form: removed first, then added, parents-first order kept', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'a', components: [comp(1), comp(2, 1), comp(3, 1)] })
    c.ingestComponents({ epoch: 'a', added: [comp(4, 2)], removed: [3] })
    expect(c.liveComponents.map(x => x.id)).toEqual([1, 2, 4])
    expect(c.liveComponentsTotal).toBe(3)
    // a full form replaces the epoch's tree
    c.ingestComponents({ epoch: 'a', reset: true, components: [comp(9)] })
    expect(c.liveComponents.map(x => x.id)).toEqual([9])
  })

  it('stays bounded under deltas: ids beyond the cap are only counted', () => {
    const c = new Collector()
    const n = LIMITS.liveComponents
    c.ingestComponents({ epoch: 'a', components: Array.from({ length: n }, (_, i) => comp(i)) })
    c.ingestComponents({ epoch: 'a', added: [comp(n), comp(n + 1)], removed: [] })
    expect(c.liveComponents).toHaveLength(n)
    expect(c.liveComponentsTotal).toBe(n + 2)
    expect(c.liveComponents[0].id).toBe(0) // root-first prefix kept
    c.ingestComponents({ epoch: 'a', added: [], removed: [n + 1] }) // an uncounted id
    expect(c.liveComponentsTotal).toBe(n + 1)
    c.ingestComponents({ epoch: 'a', added: [], removed: [5] })
    expect(c.liveComponents).toHaveLength(n - 1)
  })

  it('serves the most recently pushing epoch and keeps other tabs intact', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'tab1', components: [comp(1)] })
    c.ingestProfiles({ epoch: 'tab1', profiles: [{ componentId: 1 }] })
    c.ingestComponents({ epoch: 'tab2', components: [comp(2), comp(3)] })
    expect(c.liveComponents.map(x => x.id)).toEqual([2, 3])
    expect(c.renderProfiles).toEqual([])
    expect(c.epochInfo).toEqual({ epoch: 'tab2', epochs: 2 })
    c.ingestComponents({ epoch: 'tab1', added: [comp(4, 1)], removed: [] })
    expect(c.liveComponents.map(x => x.id)).toEqual([1, 4])
    expect(c.renderProfiles).toEqual([{ componentId: 1 }])
  })

  it('keeps at most MAX_EPOCHS page loads (LRU) and drops the evicted epoch timeline too', () => {
    const c = new Collector()
    for (let i = 0; i < MAX_EPOCHS + 2; i++) {
      c.ingestComponents({ epoch: `e${i}`, components: [comp(i)] })
      c.ingestStateTimeline({ epoch: `e${i}`, changes: [change(i)] })
    }
    expect(c.epochInfo.epochs).toBe(MAX_EPOCHS)
    expect(c.stateTimeline.map(e => e.id)).toEqual(['n2', 'n3', 'n4', 'n5'])
  })

  it('treats epoch-less payloads (older runtimes) as one legacy epoch, full form', () => {
    const c = new Collector()
    c.ingestComponents({ components: [comp(1)] })
    c.ingestComponents({ components: [comp(2)] })
    expect(c.liveComponents.map(x => x.id)).toEqual([2])
  })

  it('C1: a delta without a full base (unknown/evicted epoch) is not served; sender asked to resync once', () => {
    const c = new Collector()
    const client = { send: vi.fn() }
    c.ingestComponents({ epoch: 'a', components: [comp(1)] })
    c.ingestProfiles({ epoch: 'b', profiles: [] }) // epoch known, but no components base
    c.ingestComponents({ epoch: 'b', added: [comp(7)], removed: [] }, client)
    c.ingestComponents({ epoch: 'b', added: [comp(8)], removed: [] }, client)
    expect(client.send).toHaveBeenCalledOnce()
    expect(client.send).toHaveBeenCalledWith(HOT_EVENTS.subscription, {
      active: false,
      componentDeltas: true,
      resync: true,
    })
    c.ingestComponents({ epoch: 'zzz', added: [comp(9)], removed: [] }, client)
    // neither the base-less epoch 'b' nor the unknown 'zzz' is served (B1): the
    // complete tree of 'a' stays visible instead of an empty one
    expect(c.epochInfo.epoch).toBe('a')
    expect(c.liveComponents.map(x => x.id)).toEqual([1])
    // the resync full snapshot makes the epoch servable; later deltas apply
    c.ingestComponents({ epoch: 'b', reset: true, components: [comp(7), comp(8)] })
    c.ingestComponents({ epoch: 'b', added: [comp(10, 7)], removed: [8] }, client)
    expect(c.liveComponents.map(x => x.id)).toEqual([7, 10])
    expect(client.send).toHaveBeenCalledTimes(2)
  })

  it('C2: under the cap a child whose parent was not stored is never admitted (no orphans)', () => {
    const c = new Collector()
    const n = LIMITS.liveComponents
    c.ingestComponents({ epoch: 'a', components: Array.from({ length: n }, (_, i) => comp(i)) })
    c.ingestComponents({ epoch: 'a', added: [comp(n), comp(n + 1, n)], removed: [] }) // parent n overflows
    c.ingestComponents({ epoch: 'a', added: [], removed: [0, 1] }) // room again
    c.ingestComponents({ epoch: 'a', added: [comp(n + 2, n)], removed: [] }) // child of uncaptured parent
    const ids = new Set(c.liveComponents.map(x => x.id))
    expect(ids.has(n + 2)).toBe(false)
    const orphans = c.liveComponents.filter(x => x.parentId != null && !ids.has(x.parentId))
    expect(orphans).toEqual([])
    expect(c.liveComponentsTotal).toBe(n - 2 + 3)
    // the same gate applies within a full snapshot
    c.ingestComponents({ epoch: 'a', components: [comp(1, 99), comp(2)] })
    expect(c.liveComponents.map(x => x.id)).toEqual([2])
    expect(c.liveComponentsTotal).toBe(2)
  })

  it('C3: removals of stored, overflowed and unknown ids keep the total exact', () => {
    const c = new Collector()
    const n = LIMITS.liveComponents
    c.ingestComponents({ epoch: 'a', components: Array.from({ length: n + 3 }, (_, i) => comp(i)) })
    expect(c.liveComponentsTotal).toBe(n + 3)
    c.ingestComponents({ epoch: 'a', added: [], removed: [-5, -6] }) // never seen
    expect(c.liveComponentsTotal).toBe(n + 3)
    c.ingestComponents({ epoch: 'a', added: [], removed: [n + 1, n + 1] }) // overflowed, twice
    expect(c.liveComponentsTotal).toBe(n + 2)
    c.ingestComponents({ epoch: 'a', added: [], removed: [0] }) // stored
    expect(c.liveComponentsTotal).toBe(n + 1)
    expect(c.liveComponents).toHaveLength(n - 1)
  })

  it('componentTracking: false (no component snapshots ever): profiles of the newest pusher are served', () => {
    const c = new Collector()
    c.ingestProfiles({ epoch: 'tab1', profiles: [{ componentId: 1 }] })
    c.ingestStateTimeline({ epoch: 'tab1', changes: [change(1)] })
    c.ingestProfiles({ epoch: 'tab2', profiles: [{ componentId: 2 }] })
    expect(c.renderProfiles).toEqual([{ componentId: 2 }])
    expect(c.epochInfo).toEqual({ epoch: 'tab2', epochs: 2 })
    expect(c.liveComponents).toEqual([])
    expect(c.liveComponentsTotal).toBe(0)
    // once any tab sends a component snapshot, base-less tabs no longer take over
    c.ingestComponents({ epoch: 'tab1', components: [comp(1)] })
    c.ingestProfiles({ epoch: 'tab2', profiles: [{ componentId: 3 }] })
    expect(c.epochInfo.epoch).toBe('tab1')
    expect(c.renderProfiles).toEqual([{ componentId: 1 }])
  })

  it('advertises the delta form to runtimes', () => {
    expect(new Collector().subscription.componentDeltas).toBe(true)
  })
})

describe('Collector hot channel', () => {
  it('routes runtime events and detaches listeners on re-attach (restart)', () => {
    const c = new Collector()
    const a = fakeHot()
    c.attach(a.hot)
    a.emit(HOT_EVENTS.components, { components: [{ id: 1 }] })
    expect(c.liveComponents).toHaveLength(1)

    const b = fakeHot()
    c.attach(b.hot)
    expect(a.listeners.size).toBe(0)
    b.emit(HOT_EVENTS.runtimeError, { message: 'boom' })
    expect(c.runtimeErrors).toHaveLength(1)
  })

  it('clearStateTimeline tells the runtime to clear too', () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    c.ingestStateTimeline({ changes: [change(1)] })
    c.clearStateTimeline()
    expect(c.stateTimeline).toEqual([])
    expect(h.sent.at(-1)?.event).toBe(HOT_EVENTS.clearStateTimeline)
  })
})

describe('Collector pulls', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('answers without a hot channel with an empty graph marked stale', async () => {
    const c = new Collector()
    await expect(c.requestReactiveGraph()).resolves.toEqual({
      nodes: [],
      edges: [],
      scope: null,
      epoch: null,
      total: null,
      truncated: false,
      edgesOmitted: 0,
      policy: 'global-head',
      stale: true,
      staleReason: 'no-runtime',
    })
  })

  it('resolves with the runtime reply', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const p = c.requestReactiveGraph()
    expect(h.sent.at(-1)?.event).toBe(HOT_EVENTS.requestReactiveGraph)
    // an older runtime: no requestId echo → whole-app graph
    h.emit(HOT_EVENTS.reactiveGraph, { nodes: [{ id: 'a' }], edges: [] })
    await expect(p).resolves.toEqual({
      nodes: [{ id: 'a' }],
      edges: [],
      scope: null,
      epoch: null,
      total: { nodes: 1, nodesKind: 'sent', edges: 0 },
      truncated: false,
      edgesOmitted: 0,
      policy: 'global-head',
    })
  })

  it('falls back to cache after the timeout and removes the resolver', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const p = c.requestStateTimeline()
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(p).resolves.toEqual([])
    expect((c as any).stateTimelineResolvers).toHaveLength(0)
  })

  it('shares one in-flight pull between concurrent callers and reuses fresh results', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const p1 = c.requestReactiveGraph()
    const p2 = c.requestReactiveGraph()
    expect(h.sent.filter(s => s.event === HOT_EVENTS.requestReactiveGraph)).toHaveLength(1)
    h.emit(HOT_EVENTS.reactiveGraph, { nodes: [], edges: [] })
    await Promise.all([p1, p2])
    await c.requestReactiveGraph() // fresh (< 1 s): no new request
    expect(h.sent.filter(s => s.event === HOT_EVENTS.requestReactiveGraph)).toHaveLength(1)
    vi.advanceTimersByTime(1500)
    void c.requestReactiveGraph()
    expect(h.sent.filter(s => s.event === HOT_EVENTS.requestReactiveGraph)).toHaveLength(2)
  })

  it('detach answers pending pulls from cache', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const p = c.requestReactiveGraph()
    c.detach()
    await expect(p).resolves.toMatchObject({
      nodes: [],
      edges: [],
      stale: true,
      staleReason: 'no-runtime',
    })
    expect((c as any).pulls.size).toBe(0)
  })
})

describe('Collector state timeline deltas', () => {
  it('serves a full reset first, then only new entries by cursor (legacy full payloads)', () => {
    const c = new Collector()
    c.ingestStateTimeline({ changes: [change(1), change(2)] })
    const first = c.getStateTimelineDelta()
    expect(first.reset).toBe(true)
    expect(first.changes.map(e => e.id)).toEqual(['n1', 'n2'])

    // runtime re-sends its whole buffer plus one new entry
    c.ingestStateTimeline({ changes: [change(1), change(2), change(3)] })
    const next = c.getStateTimelineDelta(first.cursor)
    expect(next.reset).toBe(false)
    expect(next.changes.map(e => e.id)).toEqual(['n3'])
    expect(c.stateTimeline).toHaveLength(3)

    expect(c.getStateTimelineDelta(next.cursor).changes).toEqual([])
  })

  it('accepts delta payloads; reset replaces only that epoch', () => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [change(1)] })
    c.ingestStateTimeline({ epoch: 'a', changes: [change(2)] })
    const d = c.getStateTimelineDelta()
    expect(d.changes.map(e => e.id)).toEqual(['n1', 'n2'])

    // a reload (new epoch) appends instead of wiping
    c.ingestStateTimeline({ epoch: 'b', changes: [change(3)] })
    const after = c.getStateTimelineDelta(d.cursor)
    expect(after.reset).toBe(false)
    expect(after.changes.map(e => e.id)).toEqual(['n3'])

    c.ingestStateTimeline({ epoch: 'a', changes: [change(9)], reset: true })
    expect(c.stateTimeline.map(e => e.id)).toEqual(['n3', 'n9'])
  })

  it('D1: a caught-up cursor gets reset after a server-side reset (no stale/duplicate rows)', () => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [change(1)] })
    const cursor = c.getStateTimelineDelta().cursor
    // runtime re-activation re-sends its full buffer with reset
    c.ingestStateTimeline({ epoch: 'a', reset: true, changes: [change(1), change(2)] })
    const d = c.getStateTimelineDelta(cursor)
    expect(d.reset).toBe(true)
    expect(d.changes.map(e => e.id)).toEqual(['n1', 'n2'])
    // clearing (from another tab / MCP) too
    const c2 = c.getStateTimelineDelta(d.cursor).cursor
    c.clearStateTimeline()
    expect(c.getStateTimelineDelta(c2).reset).toBe(true)
  })

  it('D2: a cursor from another collector (previous dev-server process) gets reset', () => {
    const first = new Collector()
    for (let i = 0; i < 5; i++) first.ingestStateTimeline({ epoch: 'a', changes: [change(i)] })
    const staleCursor = first.getStateTimelineDelta().cursor
    const second = new Collector()
    for (let i = 0; i < 10; i++) second.ingestStateTimeline({ epoch: 'b', changes: [change(i)] })
    expect(second.getStateTimelineDelta(staleCursor).reset).toBe(true)
  })

  it('D3: two app tabs (epochs) interleave without thrashing resets', () => {
    const c = new Collector()
    const start = c.getStateTimelineDelta().cursor
    let cursor = start
    for (let i = 0; i < 6; i++) {
      c.ingestStateTimeline({ epoch: i % 2 ? 'tab1' : 'tab2', changes: [change(i)] })
      const d = c.getStateTimelineDelta(cursor)
      expect(d.reset).toBe(false)
      cursor = d.cursor
    }
    expect(c.stateTimeline).toHaveLength(6)
  })

  it('a cursor that fell out of the buffer gets a reset', () => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [change(1)] })
    const old = c.getStateTimelineDelta().cursor
    for (let i = 2; i < 2 + LIMITS.stateTimeline + 5; i++) {
      c.ingestStateTimeline({ epoch: 'a', changes: [change(i)] })
    }
    expect(c.stateTimeline).toHaveLength(LIMITS.stateTimeline)
    expect(c.getStateTimelineDelta(old).reset).toBe(true)
  })

  it('enforces the byte budget, keeping the newest entries', () => {
    const c = new Collector()
    const big = 'x'.repeat(64 * 1024)
    const changes = Array.from({ length: 200 }, (_, i) => change(i, { newValue: big }))
    c.ingestStateTimeline({ epoch: 'a', changes })
    const bytes = c.stateTimeline.reduce((s, e) => s + JSON.stringify(e).length, 0)
    expect(bytes).toBeLessThanOrEqual(STATE_TIMELINE_BYTES + 64 * 1024)
    expect(c.stateTimeline.length).toBeLessThan(200)
    expect(c.stateTimeline.at(-1)!.id).toBe('n199')
  })
})

describe('Collector activity leases (runtime subscription)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('activates on the first lease and deactivates on release / expiry', () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const subs = () => h.sent.filter(s => s.event === HOT_EVENTS.subscription).map(s => s.payload)

    c.lease('ui:a')
    c.lease('ui:b')
    expect(subs()).toEqual([{ active: true, componentDeltas: true }])
    c.release('ui:a')
    expect(subs()).toEqual([{ active: true, componentDeltas: true }])
    vi.advanceTimersByTime(LEASE_TTL + 10) // ui:b never renewed
    expect(subs()).toEqual([
      { active: true, componentDeltas: true },
      { active: false, componentDeltas: true },
    ])
  })

  it('D4: reports whether a lease activated the runtime and waits for its whole snapshot', async () => {
    const c = new Collector()
    c.attach(fakeHot().hot)
    expect(c.lease('mcp', 60_000)).toBe(true)
    expect(c.lease('mcp', 60_000)).toBe(false)
    let resolved = false
    const waiting = c.waitForSnapshot(1000).then(() => (resolved = true))
    // activation snapshot order: components → profiles → timeline(reset)
    c.ingestComponents({ epoch: 'a', components: [{ id: 1 }] })
    c.ingestProfiles({ epoch: 'a', profiles: [] })
    await Promise.resolve()
    expect(resolved).toBe(false)
    c.ingestStateTimeline({ epoch: 'a', reset: true, changes: [change(1)] })
    await waiting
    expect(resolved).toBe(true)
    expect(c.liveComponents).toHaveLength(1)
    expect(c.stateTimeline).toHaveLength(1)
    const timedOut = c.waitForSnapshot(1000)
    vi.advanceTimersByTime(1001)
    await expect(timedOut).resolves.toBeUndefined()
  })

  it('answers runtime-ready with the current state to that client only', () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const client = { send: vi.fn() }
    h.emit(HOT_EVENTS.runtimeReady, {}, client)
    expect(client.send).toHaveBeenCalledWith(HOT_EVENTS.subscription, {
      active: false,
      componentDeltas: true,
    })
    c.lease('mcp', 60_000)
    h.emit(HOT_EVENTS.runtimeReady, {}, client)
    expect(client.send).toHaveBeenLastCalledWith(HOT_EVENTS.subscription, {
      active: true,
      componentDeltas: true,
    })
  })
})

describe('Collector scoped graph pulls (§6.7 A, review G5/M1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** A collector with a served epoch 'e1' (a full component snapshot). */
  function served() {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    c.ingestComponents({ epoch: 'e1', components: [{ id: 1, parentId: null } as any] })
    return { c, h }
  }
  const requests = (h: ReturnType<typeof fakeHot>) =>
    h.sent.filter(s => s.event === HOT_EVENTS.requestReactiveGraph).map(s => s.payload as any)

  it('forwards componentId, caps, epoch and a requestId to the runtime', () => {
    const { c, h } = served()
    void c.requestReactiveGraph({ componentId: 7, maxNodes: 100, maxEdges: 200 })
    expect(requests(h)).toEqual([
      { requestId: expect.any(String), epoch: 'e1', componentId: 7, maxNodes: 100, maxEdges: 200 },
    ])
  })

  it('clamps caps to the collector limits and ignores invalid component ids', () => {
    const { c, h } = served()
    void c.requestReactiveGraph({ componentId: -1, maxNodes: 1e9, maxEdges: 0 })
    expect(requests(h)[0]).toEqual({
      requestId: expect.any(String),
      epoch: 'e1',
      maxNodes: LIMITS.reactiveNodes,
      maxEdges: 1,
    })
  })

  it('keeps separate in-flight pulls per scope and resolves each only with its own reply', async () => {
    const { c, h } = served()
    const a = c.requestReactiveGraph({ componentId: 1 })
    const b = c.requestReactiveGraph({ componentId: 2 })
    const [ra, rb] = requests(h)
    expect(ra.requestId).not.toBe(rb.requestId)
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: rb.requestId,
      epoch: 'e1',
      scope: 2,
      nodes: [{ id: '2:x', componentId: 2 }],
      edges: [],
      total: { nodes: 10, nodesKind: 'registered', edges: null },
      policy: 'scoped',
    })
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: ra.requestId,
      epoch: 'e1',
      scope: 1,
      nodes: [{ id: '1:y', componentId: 1 }],
      edges: [],
      total: { nodes: 10, nodesKind: 'registered', edges: null },
      policy: 'scoped',
    })
    expect((await a).nodes.map(n => n.id)).toEqual(['1:y'])
    expect((await b).nodes.map(n => n.id)).toEqual(['2:x'])
    expect((await a).total).toEqual({ nodes: 10, nodesKind: 'registered', edges: null })
  })

  it('ignores a reply from another page load (epoch mismatch) and an unknown requestId', async () => {
    const { c, h } = served()
    const p = c.requestReactiveGraph({ componentId: 1 })
    const [r] = requests(h)
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: r.requestId,
      epoch: 'other',
      nodes: [{ id: 'z' }],
      edges: [],
    })
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: 'nobody',
      epoch: 'e1',
      nodes: [{ id: 'z' }],
      edges: [],
    })
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(p).resolves.toMatchObject({
      nodes: [],
      stale: true,
      staleReason: 'timeout',
      scope: 1,
    })
  })

  it("falls back to the same scope's last result, marked stale, on timeout", async () => {
    const { c, h } = served()
    const first = c.requestReactiveGraph({ componentId: 1 })
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: requests(h)[0].requestId,
      epoch: 'e1',
      nodes: [{ id: '1:a', componentId: 1 }],
      edges: [],
    })
    await first
    vi.advanceTimersByTime(PULL_FRESHNESS + 1)
    const second = c.requestReactiveGraph({ componentId: 1 })
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(second).resolves.toMatchObject({
      nodes: [{ id: '1:a' }],
      stale: true,
      staleReason: 'timeout',
    })
    // another scope never sees it
    const other = c.requestReactiveGraph({ componentId: 2 })
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(other).resolves.toMatchObject({ nodes: [], stale: true })
  })

  it('keeps the app computedAt on a cache hit and a stale fallback; null when empty or unreported', async () => {
    const { c, h } = served()
    const first = c.requestReactiveGraph({ componentId: 1 })
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: requests(h)[0].requestId,
      epoch: 'e1',
      computedAt: 1234,
      nodes: [{ id: '1:a', componentId: 1 }],
      edges: [],
    })
    await expect(first).resolves.toMatchObject({ computedAt: 1234 })
    // cache hit within the freshness window: same answer, same time, not stale
    const cached = await c.requestReactiveGraph({ componentId: 1 })
    expect(requests(h)).toHaveLength(1)
    expect(cached).toMatchObject({ computedAt: 1234 })
    expect(cached.stale).toBeUndefined()
    // after the window the app does not answer: earlier answer, its own time, stale
    vi.advanceTimersByTime(PULL_FRESHNESS + 1)
    const late = c.requestReactiveGraph({ componentId: 1 })
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(late).resolves.toMatchObject({
      computedAt: 1234,
      stale: true,
      staleReason: 'timeout',
    })
    // nothing cached for this scope: empty fallback has no time
    const empty = c.requestReactiveGraph({ componentId: 2 })
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(empty).resolves.toMatchObject({ nodes: [], computedAt: null, stale: true })
    // a runtime that does not report it
    const unreported = c.requestReactiveGraph({ componentId: 3 })
    h.emit(HOT_EVENTS.reactiveGraph, {
      requestId: requests(h).at(-1)!.requestId,
      epoch: 'e1',
      nodes: [],
      edges: [],
    })
    await expect(unreported).resolves.toMatchObject({ computedAt: null })
  })

  it("scopes an older runtime's whole-app reply on the server and does not claim totals", async () => {
    const { c, h } = served()
    const p = c.requestReactiveGraph({ componentId: 1 })
    h.emit(HOT_EVENTS.reactiveGraph, {
      nodes: [
        { id: '1:a', componentId: 1 },
        { id: '2:b', componentId: 2 },
        { id: '3:c', componentId: 3 },
      ],
      edges: [
        { from: '2:b', to: '1:a' },
        { from: '3:c', to: '2:b' },
      ],
    })
    const r = await p
    expect(r.nodes.map(n => n.id).sort()).toEqual(['1:a', '2:b'])
    expect(r.edges).toEqual([{ from: '2:b', to: '1:a' }])
    expect(r).toMatchObject({ policy: 'server-filter', total: null, scope: 1 })
  })
})

describe('Collector capture info (§6.7 B)', () => {
  it('reports runtime and server timeline losses by reason, monotonic until clear', () => {
    const c = new Collector()
    c.ingestStateTimeline({
      epoch: 'e1',
      changes: [change(1)],
      dropped: [
        { reason: 'runtime-count', count: 3 },
        { reason: 'server-count', count: 99 }, // server reasons are not accepted from the runtime
      ],
      valueTooLarge: 2,
    })
    c.ingestStateTimeline({
      epoch: 'e1',
      changes: [],
      dropped: [{ reason: 'runtime-bytes', count: 1 }],
    })
    expect(c.getCaptureInfo().stateTimeline).toEqual({
      captured: 1,
      total: null,
      truncated: true,
      policy: 'sampled-200ms',
      dropped: [
        { reason: 'runtime-count', count: 3 },
        { reason: 'runtime-bytes', count: 1 },
      ],
      valueTooLarge: 2,
    })
    c.clearStateTimeline()
    expect(c.getCaptureInfo().stateTimeline).toEqual({
      captured: 0,
      total: null,
      truncated: false,
      policy: 'sampled-200ms',
    })
  })

  it('counts entries the server trims by count', () => {
    const c = new Collector()
    c.ingestStateTimeline({
      epoch: 'e1',
      changes: Array.from({ length: LIMITS.stateTimeline }, (_, i) => change(i)),
    })
    c.ingestStateTimeline({ epoch: 'e1', changes: [change(9000), change(9001)] })
    expect(c.getCaptureInfo().stateTimeline?.dropped).toEqual([
      { reason: 'server-count', count: 2 },
    ])
  })

  it('reports render profiles as newest-mounted with the runtime total, unknown without it', () => {
    const c = new Collector()
    c.ingestProfiles({ epoch: 'e1', profiles: [{ i: 1 }, { i: 2 }] })
    expect(c.getCaptureInfo().renderProfiles).toMatchObject({
      captured: 2,
      total: null,
      truncated: false,
      policy: 'newest-mounted',
    })
    c.ingestProfiles({ epoch: 'e1', profiles: [{ i: 1 }, { i: 2 }], total: 7000 })
    expect(c.getCaptureInfo().renderProfiles).toMatchObject({
      captured: 2,
      total: 7000,
      truncated: true,
    })
  })

  it('reports ring datasets as received versus held, reset by clear', () => {
    const c = new Collector()
    for (let i = 0; i < LIMITS.fpsSamples + 5; i++) c.ingestFps({ fps: i } as any)
    expect(c.getCaptureInfo().fpsSamples).toEqual({
      captured: LIMITS.fpsSamples,
      total: LIMITS.fpsSamples + 5,
      truncated: true,
      policy: 'tail',
    })
    c.clearFps()
    expect(c.getCaptureInfo().fpsSamples).toMatchObject({ captured: 0, total: 0, truncated: false })
  })
})

describe('Collector reactive summary pulls (§6.7 I)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('clamps topK/windowMs, correlates by requestId and never assumes capabilities', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const p = c.requestReactiveSummary({ topK: 9999, windowMs: 1 })
    const req = h.sent.find(s => s.event === HOT_EVENTS.requestReactiveSummary)!.payload as any
    expect(req).toEqual({ requestId: expect.any(String), topK: 200, windowMs: 1000 })
    h.emit(HOT_EVENTS.reactiveSummary, { requestId: 'nobody', rows: [] })
    h.emit(HOT_EVENTS.reactiveSummary, {
      requestId: req.requestId,
      window: { ms: 1000, since: 1, until: 1001, sampledActiveMs: 800 },
      components: { total: 50000, withActivity: 3 },
      rows: [
        {
          componentId: 4,
          file: '/A.svelte',
          nodes: { state: 2, derived: 1, effect: 0 },
          changes: 5,
          renders: 2,
          renderMs: 1.5,
        },
      ],
      other: { components: 49999, nodes: 120000 },
      truncated: true,
      capabilities: { valueInspection: 'yes' },
    })
    await expect(p).resolves.toMatchObject({
      components: { total: 50000, withActivity: 3 },
      rows: [{ componentId: 4, changes: 5, renders: 2 }],
      other: { components: 49999, nodes: 120000 },
      truncated: true,
      policy: 'sampled-200ms',
      coverage: 'component-init',
      capabilities: { valueInspection: false, signalHistory: false, writeCause: false },
    })
  })

  it('answers stale and empty when the runtime does not reply', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    const p = c.requestReactiveSummary()
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT + 1)
    await expect(p).resolves.toMatchObject({
      rows: [],
      components: { total: null },
      stale: true,
      staleReason: 'timeout',
    })
  })
})

describe('Collector live snapshot epoch (two app tabs, review M1)', () => {
  it("pairs the served page load's components with that page load's epoch, never merged", () => {
    const c = new Collector()
    c.ingestComponents({
      epoch: 'tab-a',
      components: [{ id: 1, parentId: null, file: '/A.svelte' } as any],
    })
    c.ingestComponents({
      epoch: 'tab-b',
      components: [{ id: 1, parentId: null, file: '/B.svelte' } as any],
    })
    let snap = c.liveSnapshot
    expect(snap.epoch).toBe('tab-b')
    expect(snap.components.map(x => x.file)).toEqual(['/B.svelte'])
    // tab A pushes again: it becomes the served one, with only its own tree
    c.ingestComponents({
      epoch: 'tab-a',
      components: [{ id: 1, parentId: null, file: '/A.svelte' } as any],
    })
    snap = c.liveSnapshot
    expect(snap.epoch).toBe('tab-a')
    expect(snap.components.map(x => x.file)).toEqual(['/A.svelte'])
  })

  it('reports no epoch before any page load sent a tree', () => {
    expect(new Collector().liveSnapshot).toEqual({ epoch: null, total: 0, components: [] })
  })

  it('a scoped graph for an id taken from the other tab is answered epoch-changed', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    c.ingestComponents({ epoch: 'tab-a', components: [{ id: 1, parentId: null } as any] })
    const fromA = c.liveSnapshot
    c.ingestComponents({ epoch: 'tab-b', components: [{ id: 1, parentId: null } as any] })
    await expect(
      c.requestReactiveGraph({ componentId: fromA.components[0].id, epoch: fromA.epoch! }),
    ).resolves.toMatchObject({ stale: true, staleReason: 'epoch-changed', epoch: 'tab-b' })
    expect(h.sent.filter(s => s.event === HOT_EVENTS.requestReactiveGraph)).toHaveLength(0)
  })
})

describe('Collector scoped graph before any page load (review MUST-1)', () => {
  it('fails closed without asking the runtime, with or without a caller epoch', async () => {
    const c = new Collector()
    const h = fakeHot()
    c.attach(h.hot)
    await expect(c.requestReactiveGraph({ componentId: 1 })).resolves.toMatchObject({
      nodes: [],
      scope: 1,
      epoch: null,
      stale: true,
      staleReason: 'no-runtime',
    })
    await expect(c.requestReactiveGraph({ componentId: 1, epoch: 'old' })).resolves.toMatchObject({
      stale: true,
      staleReason: 'no-runtime',
    })
    expect(h.sent.filter(s => s.event === HOT_EVENTS.requestReactiveGraph)).toHaveLength(0)
  })
})

describe('Collector state timeline baseline disclosure (review B1/B2)', () => {
  it('exposes the served page load baseline in capture info, validated', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'e1', components: [{ id: 1, parentId: null } as any] })
    c.ingestStateTimeline({
      epoch: 'e1',
      reset: true,
      changes: [],
      baseline: { complete: false, pendingNodes: 7 },
    } as any)
    expect(c.getCaptureInfo().stateTimeline?.baseline).toEqual({ complete: false, pendingNodes: 7 })
    expect(c.getCaptureInfo().stateTimeline?.captured).toBe(0)
    c.ingestStateTimeline({
      epoch: 'e1',
      changes: [],
      baseline: { complete: true, pendingNodes: 0 },
    } as any)
    expect(c.getCaptureInfo().stateTimeline?.baseline).toEqual({ complete: true, pendingNodes: 0 })
    // malformed values are ignored, the last valid one is kept
    c.ingestStateTimeline({
      epoch: 'e1',
      changes: [],
      baseline: { complete: 'yes', pendingNodes: -1 },
    } as any)
    expect(c.getCaptureInfo().stateTimeline?.baseline).toEqual({ complete: true, pendingNodes: 0 })
  })

  it('omits baseline when the runtime never sent one (older runtime)', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'e1', components: [{ id: 1, parentId: null } as any] })
    c.ingestStateTimeline({ epoch: 'e1', reset: true, changes: [] } as any)
    expect(c.getCaptureInfo().stateTimeline).not.toHaveProperty('baseline')
  })

  it('passes a valid summary baseline through, drops a malformed one', () => {
    const c = new Collector() as any
    expect(
      c.normalizeSummary({ baseline: { complete: false, pendingNodes: 3 } }, 'e').baseline,
    ).toEqual({
      complete: false,
      pendingNodes: 3,
    })
    expect(
      c.normalizeSummary({ baseline: { complete: 1, pendingNodes: 3 } }, 'e'),
    ).not.toHaveProperty('baseline')
  })
})
