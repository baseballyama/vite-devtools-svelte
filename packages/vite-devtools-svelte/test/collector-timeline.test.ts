// Collector boundaries: lease expiry to the millisecond, the state timeline
// byte budget (exact sizes, multibyte values), and a model-based check of the
// timeline cursor protocol under random pushes, trims, resets and clears.
import assert from 'node:assert/strict'

import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import {
  Collector,
  HOT_EVENTS,
  LEASE_TTL,
  LIMITS,
  MAX_EPOCHS,
  STATE_TIMELINE_BYTES,
} from '../src/server/collector.js'
import type { HotChannel } from '../src/server/collector.js'
import type { StateChange, StateTimelineEntry } from '../src/types.js'

function attached() {
  const sent: Array<{ event: string; payload: unknown }> = []
  const hot: HotChannel = {
    send: (event, payload) => {
      sent.push({ event, payload })
    },
    on: () => {},
    off: () => {},
  }
  const c = new Collector()
  c.attach(hot)
  const subs = () =>
    sent
      .filter(s => s.event === HOT_EVENTS.subscription)
      .map(s => (s.payload as { active: boolean }).active)
  return { c, subs }
}

describe('Collector lease expiry boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a lease is live through its last millisecond and swept 1 ms after', () => {
    const { c, subs } = attached()
    expect(c.lease('ui', 1000)).toBe(true)
    vi.advanceTimersByTime(1000) // now === expiresAt: no sweep has run yet
    expect(subs()).toEqual([true])
    vi.advanceTimersByTime(1)
    expect(subs()).toEqual([true, false])
    expect(c.subscription.active).toBe(false)
  })

  it('a lease expiring exactly now is dead at the next update', () => {
    const { c, subs } = attached()
    c.lease('ui', 1000)
    vi.setSystemTime(Date.now() + 1000) // clock moves, timers do not fire
    // another consumer's update prunes 'ui' (expiresAt <= now) but stays active
    expect(c.lease('mcp', 10)).toBe(false)
    c.release('mcp')
    expect(subs()).toEqual([true, false])
  })

  it('a zero-TTL lease never activates the runtime', () => {
    const { c, subs } = attached()
    expect(c.lease('ui', 0)).toBe(false)
    expect(subs()).toEqual([])
  })

  it('renewing before expiry moves the deadline; the default TTL is LEASE_TTL', () => {
    const { c, subs } = attached()
    c.lease('ui')
    vi.advanceTimersByTime(LEASE_TTL - 1)
    c.lease('ui') // heartbeat
    vi.advanceTimersByTime(LEASE_TTL)
    expect(subs()).toEqual([true])
    vi.advanceTimersByTime(1)
    expect(subs()).toEqual([true, false])
  })

  it('the sweep re-arms for the next-earliest lease', () => {
    const { c, subs } = attached()
    c.lease('a', 100)
    c.lease('b', 300)
    vi.advanceTimersByTime(101)
    expect(subs()).toEqual([true]) // 'a' swept, 'b' still live
    vi.advanceTimersByTime(199) // b's last millisecond
    expect(subs()).toEqual([true])
    vi.advanceTimersByTime(1)
    expect(subs()).toEqual([true, false])
  })

  it('releasing an unknown consumer sends nothing; detach stops the sweep', () => {
    const { c, subs } = attached()
    c.release('nobody')
    c.lease('ui', 100)
    c.detach()
    vi.advanceTimersByTime(1000)
    expect(subs()).toEqual([true])
    expect(vi.getTimerCount()).toBe(0)
  })
})

/** A change whose stored JSON is exactly `size` UTF-16 code units, padded with `pad`. */
function sized(id: string, size: number, pad = 'x'): StateChange {
  const base: StateChange = {
    id,
    name: 's',
    componentFile: '/A.svelte',
    oldValue: null,
    newValue: '',
    timestamp: 0,
  }
  const room = size - JSON.stringify(base).length
  if (room < 0) throw new Error(`cannot pad ${id} to ${size}`)
  const fill = Math.floor(room / pad.length)
  const change = { ...base, newValue: pad.repeat(fill) + 'x'.repeat(room - fill * pad.length) }
  expect(JSON.stringify(change).length).toBe(size)
  return change
}

const serverBytesDrops = (c: Collector) =>
  c.getCaptureInfo().stateTimeline?.dropped?.find(d => d.reason === 'server-bytes')?.count ?? 0
const ids = (c: Collector) => c.stateTimeline.map(e => e.id)

describe('Collector state timeline byte budget', () => {
  const half = STATE_TIMELINE_BYTES / 2

  it.each([
    ['ASCII', 'x'],
    // 1 code unit, 3 UTF-8 bytes: the budget counts JSON length (code units)
    ['CJK', '日'],
    // a surrogate pair: 2 code units
    ['emoji', '😀'],
  ])('%s values: exactly the budget is kept; one unit over drops the oldest', (_, pad) => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [sized('a', half, pad), sized('b', half, pad)] })
    expect(ids(c)).toEqual(['a', 'b'])
    expect(serverBytesDrops(c)).toBe(0)

    const over = new Collector()
    over.ingestStateTimeline({
      epoch: 'a',
      changes: [sized('a', half, pad), sized('b', half + pad.length, pad)],
    })
    expect(ids(over)).toEqual(['b'])
    expect(serverBytesDrops(over)).toBe(1)
  })

  it('a single entry larger than the budget is kept while newest', () => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [sized('huge', STATE_TIMELINE_BYTES + 100)] })
    expect(ids(c)).toEqual(['huge'])
    c.ingestStateTimeline({ epoch: 'a', changes: [sized('next', 200)] })
    expect(ids(c)).toEqual(['next'])
    expect(serverBytesDrops(c)).toBe(1)
  })

  it('accounting does not drift across trims, resets and evictions', () => {
    const c = new Collector()
    const quarter = STATE_TIMELINE_BYTES / 4
    const round = (r: number) => {
      for (const epoch of ['a', 'b']) {
        c.ingestStateTimeline({ epoch, changes: [sized(`${epoch}${r}`, quarter, '日')] })
      }
    }
    for (const r of [0, 1, 2, 3]) round(r)
    c.ingestStateTimeline({ epoch: 'a', reset: true, changes: [] })
    for (const r of [4, 5]) round(r)
    // exactly the newest four quarters fit: no drift in the running total
    expect(ids(c)).toEqual(['a4', 'b4', 'a5', 'b5'])
    c.ingestStateTimeline({ epoch: 'b', changes: [sized('b6', quarter)] })
    expect(ids(c)).toEqual(['b4', 'a5', 'b5', 'b6'])
  })

  it('a value JSON cannot encode is skipped, not counted', () => {
    const c = new Collector()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    c.ingestStateTimeline({
      epoch: 'a',
      changes: [sized('ok', 200), { ...sized('bad', 200), newValue: cyclic }, sized('ok2', 200)],
    })
    expect(ids(c)).toEqual(['ok', 'ok2'])
  })
})

// =====================================================================
// Model-based: the cursor protocol never loses or duplicates an entry
// =====================================================================

type Op =
  | { kind: 'push'; epoch: string; reset: boolean; sizes: number[] }
  | { kind: 'legacy'; added: number }
  | { kind: 'legacy-restart' }
  | { kind: 'clear' }
  | { kind: 'pull'; client: number }

const EPOCHS = ['a', 'b', 'c', 'd', 'e'] // one more than MAX_EPOCHS: evictions happen
const SMALL = fc.integer({ min: 0, max: 40 })
// 1/10 to 1/6 of the budget each: a handful trims by bytes
const HUGE = fc.integer({
  min: Math.floor(STATE_TIMELINE_BYTES / 10),
  max: Math.floor(STATE_TIMELINE_BYTES / 6),
})

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('push' as const),
      epoch: fc.constantFrom(...EPOCHS),
      reset: fc.boolean(),
      sizes: fc.oneof(
        { weight: 5, arbitrary: fc.array(SMALL, { maxLength: 320 }) },
        { weight: 1, arbitrary: fc.array(HUGE, { minLength: 1, maxLength: 3 }) },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('legacy' as const),
      added: fc.integer({ min: 0, max: 300 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'legacy-restart' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'clear' as const }) },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('pull' as const),
      client: fc.integer({ min: 0, max: 1 }),
    }),
  },
)

const serverDrops = (c: Collector) =>
  (c.getCaptureInfo().stateTimeline?.dropped ?? [])
    .filter(d => d.reason.startsWith('server-'))
    .reduce((n, d) => n + d.count, 0)

interface ModelClient {
  cursor: number | undefined
  view: StateTimelineEntry[]
  /** something was removed from the server timeline since the last pull */
  removedSincePull: boolean
  /** ids the server appended since the last pull, in order */
  pending: string[]
}

/**
 * Apply `ops` to a collector while two clients pull deltas, checking the
 * protocol after every step (node:assert: this runs inside fast-check).
 */
function checkTimelineModel(ops: Op[]): { pulls: number; resets: number } {
  const stats = { pulls: 0, resets: 0 }
  const c = new Collector()
  let uid = 0
  const change = (size: number): StateChange => ({
    id: `u${uid++}`,
    name: 's',
    componentFile: '/A.svelte',
    oldValue: null,
    newValue: 'x'.repeat(size),
    timestamp: uid,
  })
  // the legacy runtime's own ring (full snapshots, matched by id + timestamp)
  let legacyBuffer: StateChange[] = []
  const legacyIds = new Set<string>()
  /** What the server appends for a legacy full snapshot (§6.4): after the newest entry it holds. */
  const legacyAppends = (buffer: StateChange[]) => {
    const last = c.stateTimeline.findLast(e => legacyIds.has(e.id))
    const at = last ? buffer.findIndex(e => e.id === last.id) : -1
    for (const e of buffer) legacyIds.add(e.id)
    return (at === -1 ? buffer : buffer.slice(at + 1)).map(e => e.id)
  }
  const clients: ModelClient[] = [0, 1].map(() => ({
    cursor: undefined,
    view: [],
    removedSincePull: false,
    pending: [],
  }))

  const pull = (client: ModelClient) => {
    const d = c.getStateTimelineDelta(client.cursor)
    stats.pulls++
    if (d.reset && client.cursor !== undefined) stats.resets++
    if (client.cursor !== undefined) {
      // nothing was removed: a plain delta, never a needless reset
      if (!client.removedSincePull) assert.equal(d.reset, false, 'needless reset')
      assert.ok(d.cursor >= client.cursor, 'cursor moved backwards')
    }
    if (d.reset) client.view = [...d.changes]
    else {
      // exactly what was appended since the last pull: an entry trimmed
      // before this client saw it forces a reset instead
      assert.deepEqual(
        d.changes.map(e => e.id),
        client.pending,
      )
      for (const e of d.changes) assert.ok(e.seq > client.cursor!, 'entry not after cursor')
      client.view = [...client.view, ...d.changes]
    }
    // No gap, no duplicate, nothing stale in between: the server's timeline
    // is exactly the newest part of the client's. Entries the caps trimmed
    // after the client received them may stay ahead of it (the client caps
    // its own copy); after a reset both are equal.
    const server = c.stateTimeline.map(e => e.seq)
    const held = client.view.map(e => e.seq)
    assert.deepEqual(d.reset ? held : held.slice(held.length - server.length), server)
    client.cursor = d.cursor
    client.pending = []
    client.removedSincePull = false
  }

  for (const op of ops) {
    const before = new Set(c.stateTimeline.map(e => e.seq))
    const dropsBefore = serverDrops(c)
    let appended: string[] = []
    switch (op.kind) {
      case 'push': {
        const changes = op.sizes.map(change)
        appended = changes.slice(-LIMITS.stateTimeline).map(e => e.id)
        c.ingestStateTimeline({ epoch: op.epoch, reset: op.reset, changes })
        break
      }
      case 'legacy':
        legacyBuffer = [
          ...legacyBuffer,
          ...Array.from({ length: op.added }, () => change(5)),
        ].slice(-LIMITS.stateTimeline)
        appended = legacyAppends(legacyBuffer)
        c.ingestStateTimeline({ changes: legacyBuffer })
        break
      case 'legacy-restart':
        legacyBuffer = [change(5)]
        appended = legacyAppends(legacyBuffer)
        c.ingestStateTimeline({ changes: legacyBuffer })
        break
      case 'clear':
        c.clearStateTimeline()
        break
      case 'pull':
        pull(clients[op.client]!)
        break
    }
    const seqs = c.stateTimeline.map(e => e.seq)
    // strictly increasing: no duplicates, server order = seq order
    for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i]! > seqs[i - 1]!, 'seq order')
    assert.ok(seqs.length <= LIMITS.stateTimeline, 'count cap')
    const removed =
      op.kind === 'clear' ||
      [...before].some(seq => !seqs.includes(seq)) ||
      serverDrops(c) !== dropsBefore
    for (const client of clients) {
      client.pending.push(...appended)
      client.removedSincePull ||= removed
    }
  }
  assert.ok(c.epochInfo.epochs <= MAX_EPOCHS, 'epoch cap')
  return stats
}

describe('Collector state timeline cursor protocol (model-based)', () => {
  it('a client applying deltas never misses, duplicates or keeps a removed entry', () => {
    const total = { pulls: 0, resets: 0 }
    // fixed seed: deterministic in CI (vary it locally to explore further)
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), ops => {
        const { pulls, resets } = checkTimelineModel(ops)
        total.pulls += pulls
        total.resets += resets
      }),
      { numRuns: 300, seed: 20_261_007 },
    )
    // the generated runs exercised both plain deltas and resets of a cursor
    expect(total.resets).toBeGreaterThan(0)
    expect(total.pulls).toBeGreaterThan(total.resets)
  })

  it('a cursor from the future (another process) is answered with a reset', () => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [sized('a', 200)] })
    const { cursor } = c.getStateTimelineDelta()
    expect(c.getStateTimelineDelta(cursor + 1_000_000).reset).toBe(true)
    expect(c.getStateTimelineDelta(cursor)).toEqual({ cursor, reset: false, changes: [] })
  })
})
