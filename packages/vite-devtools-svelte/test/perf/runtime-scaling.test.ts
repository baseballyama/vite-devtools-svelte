// Scaling and memory-bound tests for the browser runtime injected into the
// user's app. They drive `window.__SVELTE_DEVTOOLS__` the same way the
// svelte/internal/client wrapper does (register → registered → trackState →
// unmount) with huge-app sized inputs.
//
// No `it.fails`: every known defect found so far is fixed and asserted here.
import { describe, it, expect } from 'vitest'

import {
  createRuntime,
  mountList,
  pollFn,
  settlePolling,
  unmountList,
  type Harness,
} from './harness.js'

// Fake clock + deterministic JSON.stringify cost model (see P2 tests).
/** One churn tick: every numeric signal changes. */
function bumpNumbers(signals: Array<{ v: unknown }>) {
  for (const s of signals) if (typeof s.v === 'number') s.v++
}

/**
 * What the poller will do with this tick's slice (read before it runs):
 * object values whose ref / write version moved are dirty; unchanged ones
 * past their re-check time are overdue. Primitives are not counted.
 */
function classifySlice(dt: any, slice: readonly unknown[], now: number) {
  let dirty: number = dt._pollDirty.size
  let overdue = 0
  for (const nodeId of slice) {
    const signal = dt._reactiveNodes.get(nodeId).signal.deref()
    const value = dt._readStateValue(nodeId, signal)
    if (value === null || typeof value !== 'object') continue
    const meta = dt._pollMeta.get(nodeId)
    if (meta.ref !== value || meta.wv !== signal.wv) dirty++
    else if (now >= meta.nextCheckAt) overdue++
  }
  return { dirty, overdue }
}

function simulatedClock(nsPerChar = 10) {
  let now = 0
  return {
    nsPerChar,
    now: () => now,
    // Runs `count` ticks `gapMs` apart; returns simulated ms spent per tick.
    run(tick: () => void, count: number, gapMs = 200) {
      const orig = JSON.stringify
      let calls = 0
      ;(JSON as any).stringify = (...args: any[]) => {
        const out = (orig as any)(...args)
        calls++
        if (typeof out === 'string') now += out.length * nsPerChar * 1e-6
        return out
      }
      const per: number[] = []
      try {
        for (let t = 0; t < count; t++) {
          now += gapMs
          const t0 = now
          tick()
          per.push(now - t0)
        }
      } finally {
        JSON.stringify = orig
      }
      return { calls, mean: per.reduce((a, b) => a + b, 0) / per.length, max: Math.max(...per) }
    },
  }
}

describe('runtime memory bounds', () => {
  // 2 000 rows: large enough to catch per-component leaks while staying fast
  // on the quadratic baseline unmount path (P1).
  it('releases every per-component structure after a 2 000-row list unmounts', () => {
    const h = createRuntime()
    const list = mountList(h, 2000)
    expect(h.dt._instances.size).toBe(2001)
    // poll once so snapshots exist for every state
    for (const i of h.intervals) i.fn()
    unmountList(h, list)
    h.flushTimers()
    expect(h.dt._instances.size).toBe(0)
    expect(h.dt._reactiveNodes.size).toBe(0)
    expect(h.dt._reactiveProxies.size).toBe(0)
    expect(h.dt._profiles.size).toBe(0)
    expect(h.dt._initStartTimes.size).toBe(0)
    expect(h.dt._stateSnapshots.size).toBe(0)
  }, 60_000)

  it('keeps the state timeline bounded under sustained churn', () => {
    const h = createRuntime()
    const { signals } = mountList(h, 200, 1)
    const poll = h.intervals.find(i => i.ms === 200)
    expect(poll).toBeDefined()
    for (let tick = 0; tick < 50; tick++) {
      bumpNumbers(signals)
      poll!.fn()
    }
    // raw array: bulk-trimmed, at most 2 x the cap between trims
    expect(h.dt._stateTimeline.length).toBeLessThanOrEqual(1000)
    // what any read sees: the 500-entry ring
    expect(h.dt.getStateTimeline().length).toBeLessThanOrEqual(500)
  })

  it('keeps the FPS frame buffer bounded', () => {
    const h = createRuntime()
    for (let i = 0; i < 10_000; i++) h.dt._fpsFrameTimes.push(performance.now() - 5000)
    h.dt._sampleFps()
    expect(h.dt._fpsFrameTimes.length).toBe(0)
  })
})

describe('runtime scaling (huge app)', () => {
  // P3: a single component mount must not resend the whole component list.
  // P3 full-form protection (used without the §6.5 gate, and for full
  // checkpoints): full-list pushes are throttled with an interval adapted to
  // the cost of the previous push. Send cost is simulated
  // deterministically (fake clock, 10 ns per byte).
  it('P3: a ≥ 1 MB component push spaces the next one ≥ 1 s apart; churn keeps one timer', () => {
    let now = 0
    const h = createRuntime({
      clock: () => now,
      deltas: false, // the full-push fallback is what the throttle protects
      onSend: bytes => {
        now += bytes * 1e-5
      },
    })
    // §6.3: activation (inside createRuntime) already sent one full snapshot
    // of the then-empty tree. Assert it explicitly, then measure from here.
    // (An earlier version counted it as a throttled push: "expected 1, got 2".)
    const activation = h.sent.filter(m => m.event === 'svelte-devtools:components')
    expect(activation.map(m => (m.data as any).components.length)).toEqual([0])
    h.sent.length = 0
    const list = mountList(h, 12_000, 0)
    h.flushTimers() // first throttled push: ≈ 1.3 MB
    const first = h.sent.filter(m => m.event === 'svelte-devtools:components')
    expect(first.length).toBe(1)
    expect(first[0]!.bytes).toBeGreaterThan(1_000_000)
    // churn: 1 000 mounts/unmounts must not reset or multiply the timer
    for (let i = 0; i < 1000; i++) {
      const id = h.dt.register('/app/src/lib/X.svelte')
      h.dt.registered(id)
      h.dt.unmount(list.ids[i])
    }
    // churn keeps at most one components + one profiles timer, both ≥ 1 s
    // (profiles: capped to the collector's 5 000 ≈ 0.85 MB > 250 kB → 1 s floor)
    const delays = h.pendingDelays()
    expect(delays.length).toBeLessThanOrEqual(2)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1000)
    h.flushTimers()
    expect(h.sent.filter(m => m.event === 'svelte-devtools:components').length).toBe(2)
  }, 60_000)

  it('P3: small apps keep the 100 ms update latency', () => {
    const h = createRuntime()
    mountList(h, 20)
    expect(h.pendingDelays()).toContain(100)
  })

  // P3 (§6.5 component deltas): one mount in a 5 000-instance app sends a
  // delta, not the tree.
  it('P3: one mount with 5 000 live components sends < 50 kB to the server', () => {
    const h = createRuntime()
    mountList(h, 5000, 1)
    h.flushTimers()
    h.sent.length = 0
    const id = h.dt.register('/app/src/lib/Extra.svelte')
    h.dt.registered(id)
    h.flushTimers()
    const bytes = h.sent.reduce((s, m) => s + m.bytes, 0)
    expect(bytes).toBeLessThan(50_000)
  })

  // P2: background polling must stay cheap however much state the app holds.
  // Wall-clock timing is unreliable on loaded machines, so serialization cost
  // is simulated deterministically: a fake clock advances 10 ns per JSON char
  // inside JSON.stringify (≈ V8's real throughput), 200 ms between ticks.
  it('P2: amortized and worst-tick serialization with 20 large states stay bounded', () => {
    const sim = simulatedClock()
    const h = createRuntime({ clock: sim.now })
    const root = h.dt.register('/app/src/routes/+page.svelte')
    for (let c = 0; c < 20; c++) {
      const id = h.dt.register('/app/src/lib/Big.svelte')
      const big = Array.from({ length: 10_000 }, (_, i) => ({ i, label: 'item ' + i }))
      h.dt.trackState({ v: big, wv: 1 }, 'items', id)
      h.dt.registered(id)
    }
    h.dt.registered(root)
    const poll = pollFn(h)
    const ticks = sim.run(poll, 50) // includes the initial snapshots
    const steady = sim.run(poll, 100) // 20 s of steady state
    const maxOp = 10_000 * 25 * sim.nsPerChar * 1e-6 // one array ≈ 2.5 ms
    // amortized: deep re-checks are paid from a 0.5 ms/tick credit
    expect(steady.mean).toBeLessThan(1)
    // worst tick: budget (2 ms) + at most one unsplittable serialization
    expect(steady.max).toBeLessThanOrEqual(2 + maxOp + 0.01)
    expect(ticks.max).toBeLessThanOrEqual(2 + maxOp + 0.01)
  })

  // An idle tick must not serialize unchanged states because of the hint pass
  // (O(1) per node), so latency is independent of app size. Since the hint pass
  // is time-sliced (§6.7 D: ≤ 4096 nodes per tick), a node is visited only
  // every few ticks, and an object whose 1 s deep re-check came due between two
  // visits is re-checked on its next visit even when no time passed since the
  // previous tick. Those re-checks are the designed deep pass (paid from the
  // DEEP_MS credit), so the idle tick is accounted exactly: nothing dirty, and
  // every serialization is an overdue deep re-check in this tick's slice.
  it('P2: an idle tick over 10 000 unchanged states serializes only due deep re-checks', () => {
    const sim = simulatedClock()
    const h = createRuntime({ clock: sim.now })
    const root = h.dt.register('/app/src/routes/+page.svelte')
    for (let c = 0; c < 2500; c++) {
      const id = h.dt.register('/app/src/lib/Row.svelte')
      h.dt.trackState({ v: c, wv: 1 }, 'n', id)
      h.dt.trackState({ v: 'label ' + c, wv: 1 }, 's', id)
      h.dt.trackState({ v: { c }, wv: 1 }, 'o', id)
      h.dt.trackProxy({ c }, 'p', id)
      h.dt.registered(id)
    }
    h.dt.registered(root)
    const poll = pollFn(h)
    sim.run(poll, 20) // initial snapshots
    // this tick's slice, read before it runs (no serialization here)
    const dt = h.dt
    const ids: number[] = dt._pollIds
    const slice = Array.from(
      { length: Math.min(4096, ids.length) },
      (_, i) => ids[(dt._pollCursor + i) % ids.length],
    )
    const { dirty, overdue } = classifySlice(dt, slice, sim.now())
    const idle = sim.run(poll, 1, 0) // same instant: nothing changed
    expect(dirty).toBe(0)
    expect(idle.calls).toBe(overdue)
  })

  // P4 / RT4: with no DevTools client attached the runtime must not run a
  // perpetual rAF loop, interval polling or payload sends in the user's app.
  it('P4: no periodic work or payload sends before a DevTools client subscribes', () => {
    const h = createRuntime({ active: false })
    mountList(h, 200)
    h.flushTimers()
    expect(h.intervals.length).toBe(0)
    expect(h.rafCallbacks).toBe(0)
    expect(h.sent.map(m => m.event)).toEqual(['svelte-devtools:runtime-ready'])
  })
})

// Fake clock: time-based re-checks are tested without real waiting.
function single(value: unknown, opts: { proxy?: boolean } = {}) {
  let now = 0
  const h = createRuntime({ clock: () => now })
  const id = h.dt.register('/app/src/lib/S.svelte')
  const signal: any = { v: value, wv: 1 }
  if (opts.proxy) h.dt.trackProxy(value, 'x', id)
  else h.dt.trackState(signal, 'x', id)
  h.dt.registered(id)
  return {
    h,
    signal,
    poll: pollFn(h),
    nodeId: id + ':x',
    advance: (ms: number) => (now += ms),
  }
}

const changesFor = (h: Harness, nodeId: string) =>
  h.dt._stateTimeline.filter((c: any) => c.id === nodeId)

describe('state polling correctness under budgets', () => {
  it('records primitive changes on the next tick', () => {
    const { h, signal, poll, nodeId } = single(1)
    poll()
    signal.v = 2
    poll()
    expect(changesFor(h, nodeId).at(-1)).toMatchObject({ oldValue: 1, newValue: 2 })
  })

  it('RT5: records transitions to and from undefined', () => {
    const { h, signal, poll, nodeId } = single(1)
    poll()
    signal.v = undefined
    poll()
    signal.v = 3
    poll()
    const changes = changesFor(h, nodeId)
    expect(changes.length).toBe(2) // the first observation is a seed
    expect(changes[0]).toMatchObject({ oldValue: 1 })
    expect(changes[0].newValue).toBeUndefined()
    expect(changes[1]).toMatchObject({ newValue: 3 })
    expect(changes[1].oldValue).toBeUndefined()
  })

  it('records an object reassignment on the next tick even for expensive objects', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => ({ i }))
    const { h, signal, poll, nodeId } = single(big)
    poll()
    signal.v = [1, 2, 3]
    poll()
    expect(changesFor(h, nodeId).at(-1)?.newValue).toEqual([1, 2, 3])
  })

  it('records object -> primitive -> identical object transitions', () => {
    const { h, signal, poll, nodeId } = single({ a: 1 })
    poll()
    signal.v = 0
    signal.wv++
    poll()
    signal.v = { a: 1 }
    signal.wv++
    poll()
    expect(changesFor(h, nodeId).map((c: any) => [c.oldValue, c.newValue])).toEqual([
      [{ a: 1 }, 0],
      [0, { a: 1 }],
    ])
  })

  it('records a write-version bump on the next tick', () => {
    const obj = { a: 1 }
    const { h, signal, poll, nodeId } = single(obj)
    poll()
    obj.a = 2
    signal.wv = 2
    poll()
    expect(changesFor(h, nodeId).at(-1)?.newValue).toEqual({ a: 2 })
  })

  it('RT2: records an in-place deep mutation after the time-based re-check', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ i, label: 'item ' + i }))
    const { h, poll, nodeId, advance } = single(big)
    poll()
    big[5]!.label = 'changed'
    poll()
    expect(changesFor(h, nodeId).length).toBe(0) // not yet: within RECHECK_MS (seed only)
    advance(1001)
    poll()
    const changes = changesFor(h, nodeId)
    expect(changes.length).toBe(1)
    expect(changes[0].newValue[5].label).toBe('changed')
    expect(changes[0].oldValue[5].label).toBe('item 5')
  })

  it('RT2: deep-mutation latency does not grow with the number of other nodes', () => {
    let now = 0
    const h = createRuntime({ clock: () => now })
    mountList(h, 2500, 2) // 5 000 primitive states
    const id = h.dt.register('/app/src/lib/Obj.svelte')
    const obj = { items: [1, 2, 3] }
    h.dt.trackState({ v: obj, wv: 1 }, 'obj', id)
    h.dt.registered(id)
    const poll = pollFn(h)
    // seed every node first (5 001 nodes = 2 slices): a write before a node's
    // first sample is not observable by design (seed only, review B-1)
    poll()
    poll()
    expect(h.dt.getReactiveSummary({}).baseline).toEqual({ complete: true, pendingNodes: 0 })
    obj.items.push(4)
    now += 1001
    poll()
    const hit = h.dt._stateTimeline.filter((c: any) => c.id === id + ':obj')
    expect(hit.map((c: any) => [c.oldValue, c.newValue])).toEqual([
      [{ items: [1, 2, 3] }, { items: [1, 2, 3, 4] }],
    ])
  })

  it('RT1: polls the live value of tag_proxy (non-reassigned) object state', () => {
    const list: number[] = []
    const { h, poll, nodeId, advance } = single(list, { proxy: true })
    poll()
    list.push(1)
    advance(1001)
    poll()
    const changes = changesFor(h, nodeId)
    expect(changes.at(-1)?.newValue).toEqual([1])
    expect(changes.at(-1)?.oldValue).toEqual([])
  })

  it('RT1: keeps tag_proxy nodes in the reactive graph while the component lives', () => {
    const { h, nodeId } = single([1, 2], { proxy: true })
    const entry = h.dt._reactiveNodes.get(nodeId)
    // marker must be strongly reachable (not a WeakRef to a throwaway object)
    expect(entry.signal).not.toBeInstanceOf(WeakRef)
    expect(h.dt.getReactiveGraph().nodes.map((n: any) => n.id)).toContain(nodeId)
  })

  it('RT3: stores a summary and a short key (not the full JSON) for huge values', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => ({ i }))
    const { h, poll, nodeId, advance } = single(big)
    poll()
    expect(changesFor(h, nodeId)).toHaveLength(0) // seed
    expect(h.dt._stateSnapshotStrs.get(nodeId).length).toBeLessThan(64)
    big[10]!.i = -1
    advance(60_000)
    poll()
    const changes = changesFor(h, nodeId)
    expect(changes).toHaveLength(1) // hash detected the change
    expect(changes[0].oldValue).toMatch(/^\(object: \d+ chars/)
    expect(changes[0].newValue).toMatch(/^\(object: \d+ chars/)
  })

  // §6.7 D: the hint pass is time-sliced (4 096 nodes per tick), so 5 000
  // nodes take 2 ticks — no starvation within a bounded number of ticks.
  it('does not starve: 400 changed primitives among 5 000 are recorded within 2 ticks', () => {
    const h = createRuntime()
    const { signals } = mountList(h, 2500, 2)
    const poll = pollFn(h)
    settlePolling(h, poll)
    h.dt._stateTimeline.length = 0
    const states = signals.filter((s: any) => s.deps === null).slice(0, 400)
    for (const s of states) s.v = -1
    poll()
    poll()
    const seen = new Set(
      h.dt._stateTimeline.filter((c: any) => c.newValue === -1).map((c: any) => c.id),
    )
    expect(seen.size).toBe(400)
  }, 60_000)
})

const events = (h: Harness) => h.sent.map(m => m.event)

describe('activity subscription (devframe-migration §6.3)', () => {
  it('announces itself with runtime-ready on boot and on HMR reconnect', () => {
    const h = createRuntime({ active: false })
    expect(events(h)).toEqual(['svelte-devtools:runtime-ready'])
    h.emit('vite:ws:connect')
    expect(events(h)).toEqual(['svelte-devtools:runtime-ready', 'svelte-devtools:runtime-ready'])
  })

  it('on activation sends a full snapshot once, then samples', () => {
    const h = createRuntime({ active: false })
    mountList(h, 50)
    h.emit('svelte-devtools:subscription', { active: true })
    const comp = h.sent.find(m => m.event === 'svelte-devtools:components')
    expect((comp!.data as any).components.length).toBe(51)
    expect(events(h)).toContain('svelte-devtools:profiles')
    expect(events(h)).toContain('svelte-devtools:state-timeline')
    expect(h.intervals.map(i => i.ms).toSorted((x, y) => x - y)).toEqual([200, 500])
    expect(h.rafCallbacks).toBe(1)
    // a repeated active:true is not a new activation
    const before = h.sent.length
    h.emit('svelte-devtools:subscription', { active: true })
    expect(h.sent.length).toBe(before)
    expect(h.intervals.length).toBe(2)
  })

  it('stops all sampling on deactivation and while the app tab is hidden', () => {
    const h = createRuntime()
    expect(h.intervals.length).toBe(2)
    h.document.visibilityState = 'hidden'
    h.document.dispatch()
    expect(h.intervals.length).toBe(0)
    h.document.visibilityState = 'visible'
    h.document.dispatch()
    expect(h.intervals.length).toBe(2)
    h.emit('svelte-devtools:subscription', { active: false })
    expect(h.intervals.length).toBe(0)
    // the stale rAF chain of the first generation must end
    expect(h.dt._fpsGen).toBeGreaterThan(1)
  })

  it('keeps answering pull requests while inactive', () => {
    const h = createRuntime({ active: false })
    mountList(h, 3)
    h.emit('svelte-devtools:request-reactive-graph', {})
    h.emit('svelte-devtools:request-state-timeline', {})
    expect(events(h)).toEqual([
      'svelte-devtools:runtime-ready',
      'svelte-devtools:reactive-graph',
      'svelte-devtools:state-timeline',
    ])
  })
})

function setup() {
  const h = createRuntime()
  const id = h.dt.register('/app/src/lib/T.svelte')
  h.dt.registered(id)
  const add = (n: number, big = 0) => {
    const sigs = Array.from({ length: n }, (_, i) => {
      const sig: any = { v: big ? Array.from({ length: big }, (_unused, k) => k + i) : i, wv: 1 }
      h.dt.trackState(sig, 's' + h.dt._reactiveNodes.size, id)
      return sig
    })
    return sigs
  }
  const timelineMsgs = () =>
    h.sent.filter(m => m.event === 'svelte-devtools:state-timeline').map(m => m.data as any)
  return { h, add, poll: () => pollFn(h)(), timelineMsgs }
}

describe('state timeline transfer (devframe-migration §6.4)', () => {
  it('pushes only new entries since the previous push, tagged with a stable epoch', () => {
    const { h, add, poll, timelineMsgs } = setup()
    const sigs = add(3)
    poll()
    h.flushTimers()
    sigs[0].v = 100
    poll()
    h.flushTimers()
    const msgs = timelineMsgs()
    const last = msgs.at(-1)
    expect(last.changes.map((c: any) => c.newValue)).toEqual([100])
    expect(last.reset).toBeUndefined()
    expect(typeof last.epoch).toBe('string')
    expect(new Set(msgs.map((m: any) => m.epoch)).size).toBe(1)
    // runtime-internal seq must not collide with the server's seq field
    expect('seq' in last.changes[0]).toBe(false)
  })

  it('splits large deltas into messages of ≤ 200 entries', () => {
    const { h, add, poll, timelineMsgs } = setup()
    const sigs = add(450)
    poll() // seeds
    h.flushTimers()
    h.sent.length = 0
    for (const sig of sigs) sig.v += 1000
    poll()
    h.flushTimers()
    const sizes = timelineMsgs().map((m: any) => m.changes.length)
    expect(sizes).toEqual([200, 200, 50])
  })

  it('sends reset: true after clearStateTimeline()', () => {
    const { h, add, poll, timelineMsgs } = setup()
    const sigs = add(2)
    poll() // seeds
    for (const sig of sigs) sig.v += 1
    poll()
    h.flushTimers()
    expect(h.dt._stateTimeline).toHaveLength(2)
    h.emit('svelte-devtools:clear-state-timeline')
    h.flushTimers()
    const last = timelineMsgs().at(-1)
    expect(last.reset).toBe(true)
    expect(last.changes).toEqual([])
  })

  it('replies to request-state-timeline with the full buffer and reset: true, within 4 MB', () => {
    const { h, add, poll } = setup()
    const sigs = add(300, 1500) // 300 objects of ≈ 7 kB
    for (let t = 0; t < 400; t++) poll() // seeds
    for (const sig of sigs) {
      sig.v = sig.v.map((k: number) => -k)
      sig.wv++
    }
    for (let t = 0; t < 400; t++) poll() // 300 changes of ≈ 14 kB (old + new): over 4 MB
    expect(h.dt._stateTimeline.length).toBeGreaterThan(0)
    h.sent.length = 0
    h.emit('svelte-devtools:request-state-timeline', {})
    const reply = h.sent.at(-1)!
    const data = reply.data as any
    expect(data.reset).toBe(true)
    expect(data.changes.length).toBe(h.dt._stateTimeline.length)
    expect(reply.bytes).toBeLessThan(4 * 1024 * 1024)
  })
})

describe('scoped reactive graph (review U1)', () => {
  it('returns only the requested component and its direct neighbours', () => {
    const h = createRuntime()
    const a = h.dt.register('/app/src/lib/A.svelte')
    const sa: any = { v: 1, deps: null, reactions: [] }
    h.dt.trackState(sa, 'count', a)
    h.dt.registered(a)
    const b = h.dt.register('/app/src/lib/B.svelte')
    const mid: any = { v: 2, deps: [sa], reactions: [] } // untracked intermediate
    const db: any = { v: 2, deps: [mid], reactions: [] }
    mid.reactions.push(db)
    sa.reactions.push(mid)
    h.dt.trackDerived(db, 'double', b)
    h.dt.registered(b)
    const c = h.dt.register('/app/src/lib/C.svelte')
    h.dt.trackState({ v: 3, deps: null }, 'other', c)
    h.dt.registered(c)

    h.emit('svelte-devtools:request-reactive-graph', { componentId: a })
    const g = h.sent.at(-1)!.data as any
    expect(g.nodes.map((n: any) => n.id).toSorted()).toEqual(
      [`${a}:count`, `${b}:double`].toSorted(),
    )
    expect(g.edges).toEqual([{ from: `${a}:count`, to: `${b}:double` }])

    h.emit('svelte-devtools:request-reactive-graph', {})
    const full = h.sent.at(-1)!.data as any
    expect(full.nodes.length).toBe(3)
  })
})

const compMsgs = (h: Harness) =>
  h.sent.filter(m => m.event === 'svelte-devtools:components').map(m => m.data as any)

describe('component deltas (devframe-migration §6.5)', () => {
  it('sends only the full form without the componentDeltas gate', () => {
    const h = createRuntime({ deltas: false })
    mountList(h, 10)
    h.flushTimers()
    const id = h.dt.register('/app/src/lib/X.svelte')
    h.dt.registered(id)
    h.flushTimers()
    for (const m of compMsgs(h)) {
      expect(Array.isArray(m.components)).toBe(true)
      expect(m.added).toBeUndefined()
    }
  })

  it('activation sends a full form with epoch + reset, then deltas', () => {
    const h = createRuntime({ active: false })
    mountList(h, 3)
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true })
    const [first] = compMsgs(h)
    expect(first).toMatchObject({ reset: true })
    expect(typeof first.epoch).toBe('string')
    expect(first.components.length).toBe(4)
    const id = h.dt.register('/app/src/lib/New.svelte')
    h.dt.registered(id)
    h.flushTimers()
    const last = compMsgs(h).at(-1)
    expect(last.epoch).toBe(first.epoch)
    expect(last.removed).toEqual([])
    expect(last.added.map((c: any) => c.id)).toEqual([id])
  })

  it('cancels ids added and removed between two pushes; reports real removals', () => {
    const h = createRuntime()
    const list = mountList(h, 5)
    h.flushTimers()
    h.sent.length = 0
    const tmp = h.dt.register('/app/src/lib/Tmp.svelte')
    h.dt.registered(tmp)
    h.dt.unmount(tmp)
    h.dt.unmount(list.ids[0])
    h.flushTimers()
    const msgs = compMsgs(h)
    expect(msgs.flatMap((m: any) => m.added)).toEqual([])
    expect(msgs.flatMap((m: any) => m.removed)).toEqual([list.ids[0]])
  })

  it('splits bursts into ≤ 2 000 entries per message, removals first, parents first', () => {
    const h = createRuntime()
    // stays below the "delta larger than the tree → full" threshold
    const old = mountList(h, 10_000, 0)
    h.flushTimers()
    h.sent.length = 0
    for (const id of old.ids.slice(0, 3000)) h.dt.unmount(id) // 3 000 removals
    const fresh = mountList(h, 2500, 0) // 2 501 additions (root + rows)
    h.flushTimers()
    const msgs = compMsgs(h)
    for (const m of msgs) expect(m.added.length + m.removed.length).toBeLessThanOrEqual(2000)
    const firstAdd = msgs.findIndex((m: any) => m.added.length > 0)
    const lastRemove = msgs.map((m: any) => m.removed.length > 0).lastIndexOf(true)
    expect(lastRemove).toBeLessThan(firstAdd)
    const added = msgs.flatMap((m: any) => m.added)
    expect(added.length).toBe(2501)
    expect(added[0].id).toBe(fresh.root) // parent before its children
    expect(msgs.flatMap((m: any) => m.removed).length).toBe(3000)
  })

  it('sends a full checkpoint after 30 s of deltas', () => {
    let now = 0
    const h = createRuntime({ clock: () => now })
    mountList(h, 3)
    h.flushTimers()
    now += 31_000
    const id = h.dt.register('/app/src/lib/Late.svelte')
    h.dt.registered(id)
    h.flushTimers()
    const last = compMsgs(h).at(-1)
    expect(last.reset).toBe(true)
    expect(last.components.length).toBe(5)
  })

  it('resends components -> profiles -> timeline(reset) after an HMR reconnect', () => {
    const h = createRuntime()
    mountList(h, 2)
    h.flushTimers()
    h.sent.length = 0
    h.emit('vite:ws:connect')
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true })
    const order = h.sent.map(m => m.event)
    expect(order).toEqual([
      'svelte-devtools:runtime-ready',
      'svelte-devtools:components',
      'svelte-devtools:profiles',
      'svelte-devtools:state-timeline',
    ])
    expect((h.sent[1]!.data as any).reset).toBe(true)
    expect((h.sent[3]!.data as any).reset).toBe(true)
  })
})

describe('resync (§6.5, review C1)', () => {
  it('resends components(reset) -> profiles -> timeline(reset) on resync while active', () => {
    const h = createRuntime()
    mountList(h, 3)
    h.flushTimers()
    h.sent.length = 0
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true, resync: true })
    expect(h.sent.map(m => m.event)).toEqual([
      'svelte-devtools:components',
      'svelte-devtools:profiles',
      'svelte-devtools:state-timeline',
    ])
    expect(h.sent[0]!.data as any).toMatchObject({ reset: true })
    expect((h.sent[0]!.data as any).components.length).toBe(4)
    expect((h.sent[2]!.data as any).reset).toBe(true)
    // then deltas continue
    h.sent.length = 0
    const id = h.dt.register('/app/src/lib/After.svelte')
    h.dt.registered(id)
    h.flushTimers()
    const comp = h.sent.find(m => m.event === 'svelte-devtools:components')!.data as any
    expect(comp.added.map((c: any) => c.id)).toEqual([id])
  })

  it('drops pending deltas: the full form already contains them', () => {
    const h = createRuntime()
    mountList(h, 2)
    h.flushTimers()
    const id = h.dt.register('/app/src/lib/Pending.svelte')
    h.dt.registered(id)
    h.sent.length = 0
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true, resync: true })
    h.flushTimers()
    const comps = h.sent
      .filter(m => m.event === 'svelte-devtools:components')
      .map(m => m.data as any)
    expect(comps.length).toBe(1)
    expect(comps[0].components.map((c: any) => c.id)).toContain(id)
  })

  it('ignores resync while inactive', () => {
    const h = createRuntime({ active: false })
    mountList(h, 2)
    h.emit('svelte-devtools:subscription', { active: false, componentDeltas: true, resync: true })
    expect(h.sent.map(m => m.event)).toEqual(['svelte-devtools:runtime-ready'])
  })
})
